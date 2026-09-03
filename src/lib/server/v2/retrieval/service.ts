import { Pool, type QueryResultRow } from "pg";
import { performance } from "node:perf_hooks";
import { retrievalConfig } from "./config.ts";
import { extractSearchTerms, parseQuery } from "./query-parser.ts";
import { calculateConfidence, reciprocalRankFusion, rerankCandidates } from "./ranking.ts";
import { decideRetrieval } from "./decision.ts";
import type { QueryIntent, RetrievalCandidate, RetrievalTrace } from "./types.ts";
import type { V2TermDefinition } from "../terminology/types.ts";

let pool: Pool | null = null;
const getPool = () => pool ??= new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED !== "false" }, max: 5 });
const elapsed = (started: number) => Math.round((performance.now() - started) * 10) / 10;

export async function loadV2Terms(termIds: string[]): Promise<V2TermDefinition[]> {
  const ids = [...new Set(termIds)].filter(Boolean).sort();
  if (!ids.length) return [];
  const result = await getPool().query(`select distinct on (c.knowledge_id) c.knowledge_id,c.metadata from v2_search.chunks c join v2_search.index_versions v on v.id=c.index_version_id where v.status='published' and c.knowledge_type='terminology' and c.knowledge_id=any($1::text[]) order by c.knowledge_id,c.ordinal`, [ids]);
  return result.rows.map((row) => ({ termId: row.knowledge_id, translations: row.metadata?.translations ?? {}, isUiVisible: row.metadata?.isUiVisible !== false }));
}

export async function runTimedOperation<T>(name: string, operation: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal, timeoutMs: number = retrievalConfig.timeoutMs): Promise<{ name: string; value?: T; error?: string; ms: number }> {
  const started = performance.now(); const controller = new AbortController();
  const abort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(`${name} 超时`)), timeoutMs);
  try { return { name, value: await operation(controller.signal), ms: elapsed(started) }; }
  catch (error) { return { name, error: error instanceof Error ? error.message : String(error), ms: elapsed(started) }; }
  finally { clearTimeout(timeout); parentSignal?.removeEventListener("abort", abort); }
}

export async function runParallelRecall<T>(fulltext: () => Promise<T>, vector: () => Promise<T>): Promise<{ values: T[]; errors: string[] }> {
  const results = await Promise.allSettled([fulltext(), vector()]);
  return { values: results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []), errors: results.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []) };
}

export function dedupeKnowledgeCandidates(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const key = (candidate: RetrievalCandidate) => candidate.knowledgeType === "pricing" ? candidate.knowledgeId.replace(/:[^:]+$/, "") : candidate.knowledgeId;
  return candidates.filter((candidate, index, items) => items.findIndex((item) => key(item) === key(candidate)) === index);
}

function filters(intent: QueryIntent, alias = "c"): { sql: string; params: unknown[]; debug: Record<string, unknown> } {
  const conditions = ["v.status='published'", `${alias}.enabled`, `${alias}.knowledge_type <> 'terminology'`, "$1 = any(c.products)"];
  const params: unknown[] = [intent.product];
  const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace("?", `$${params.length}`)); };
  if (intent.knowledgeTypes.length) add(`${alias}.knowledge_type = any(?::text[])`, intent.knowledgeTypes);
  else conditions.push(`${alias}.knowledge_type not in ('http_api','local_api','pricing')`);
  // A stateless query may enter a troubleshooting flow only at its entry node.
  // Terminal/branch nodes require flow state that this retrieval call does not have.
  conditions.push(`(${alias}.knowledge_type <> 'troubleshooting_flow' or ${alias}.metadata->>'nodeId' = 'start')`);
  if (intent.apiType) add(`${alias}.api_type = ?`, intent.apiType);
  if (intent.apiVersion) add(`${alias}.api_version = ?`, intent.apiVersion);
  if (intent.method) add(`${alias}.exact_terms @> array[?]::text[]`, intent.method);
  if (intent.object) add(`lower(${alias}.metadata->>'object') = lower(?)`, intent.object);
  if (intent.action) add(`lower(${alias}.metadata->>'action') = lower(?)`, intent.action);
  return { sql: conditions.join(" and "), params, debug: { product: intent.product, published: true, enabled: true, excludedKnowledgeTypes: ["terminology"], knowledgeVersion: "current-published", knowledgeTypes: intent.knowledgeTypes, apiType: intent.apiType, apiVersion: intent.apiVersion, method: intent.method, object: intent.object, action: intent.action } };
}

function candidate(row: QueryResultRow, source: "fulltext" | "vector", rank: number): RetrievalCandidate {
  const metadata = row.metadata ?? {};
  return { chunkId: row.chunk_id, knowledgeId: row.knowledge_id, title: row.title, text: row.full_text, metadata, termIds: Array.isArray(metadata.termIds) ? metadata.termIds.filter((value: unknown): value is string => typeof value === "string") : [], protectedFields: Array.isArray(row.protected_fields) ? row.protected_fields : [], sourceLanguage: row.source_language ?? "", knowledgeType: row.knowledge_type, apiType: row.api_type, apiVersion: row.api_version, products: row.products, source, sourceRank: rank, textScore: Number(row.text_score ?? 0), vectorScore: Number(row.vector_score ?? 0), rrfScore: 0, rerankScore: 0, matchedBy: [source] };
}

const pricingFamily = (knowledgeId: string): string => knowledgeId.replace(/:[^:]+$/, "");

const PRICING_DIMENSIONS = {
  api: ["PRICING:Open API"],
  members: ["PRICING:included members", "PRICING:additional members", "PRICING:actual users/devices supported by each member seat", "PRICING:multi-device login"],
  profiles: ["PRICING:included profiles", "PRICING:additional profiles", "PRICING:Number of profiles that can be created per day"],
} as const;

export function pricingFamiliesForQuestion(question: string): string[] {
  const families: string[] = [];
  if (/\b(?:open\s*)?api\b|接口/i.test(question)) families.push(...PRICING_DIMENSIONS.api);
  if (/成员|席位|用户|账号|设备|member|seat|user|account|device/i.test(question)) families.push(...PRICING_DIMENSIONS.members);
  if (/环境|配置文件|profile|environment/i.test(question)) families.push(...PRICING_DIMENSIONS.profiles);
  return [...new Set(families)];
}

export async function expandPricingKnowledge(candidates: RetrievalCandidate[], question = ""): Promise<RetrievalCandidate[]> {
  const pricing = candidates.filter((item) => item.knowledgeType === "pricing");
  if (!pricing.length) return candidates;
  const families = [...new Set([...pricingFamiliesForQuestion(question), ...pricing.map((item) => pricingFamily(item.knowledgeId))])].slice(0, 8);
  const result = await getPool().query(`select distinct on (regexp_replace(c.knowledge_id, ':[^:]+$', ''),c.metadata->>'planKey') c.chunk_id,c.knowledge_id,c.title,c.full_text,c.metadata,c.protected_fields,c.source_language,c.knowledge_type,c.api_type,c.api_version,c.products from v2_search.chunks c where c.index_version_id=(select id from v2_search.index_versions where status='published' order by published_at desc nulls last,created_at desc limit 1) and c.enabled and c.knowledge_type='pricing' and regexp_replace(c.knowledge_id, ':[^:]+$', '')=any($1::text[]) order by regexp_replace(c.knowledge_id, ':[^:]+$', ''),c.metadata->>'planKey',c.ordinal`, [families]);
  const expanded = result.rows.map((row, index) => ({ ...candidate(row, "fulltext", index + 1), source: "fused" as const, rerankScore: pricing.find((item) => pricingFamily(item.knowledgeId) === pricingFamily(row.knowledge_id))?.rerankScore ?? 0 }));
  const nonPricing = candidates.filter((item) => item.knowledgeType !== "pricing");
  expanded.sort((left, right) => families.indexOf(pricingFamily(left.knowledgeId)) - families.indexOf(pricingFamily(right.knowledgeId)) || ["free", "base", "plus", "share-plus"].indexOf(String(left.metadata.planKey)) - ["free", "base", "plus", "share-plus"].indexOf(String(right.metadata.planKey)));
  return [...nonPricing, ...expanded];
}

async function embedQuery(question: string, signal: AbortSignal): Promise<{ vector: string; tokens: number }> {
  const baseUrl = process.env.V2_EMBEDDING_BASE_URL?.replace(/\/$/, ""); const apiKey = process.env.V2_EMBEDDING_API_KEY; const model = process.env.V2_EMBEDDING_MODEL;
  if (!baseUrl || !apiKey || !model) throw new Error("Embedding 配置不完整");
  const response = await fetch(`${baseUrl}/embeddings`, { method: "POST", signal, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: question, dimensions: 1536 }) });
  if (!response.ok) throw new Error(`Embedding HTTP ${response.status}`);
  const payload = await response.json() as { data?: Array<{ embedding?: number[] }>; usage?: { total_tokens?: number } };
  const vector = payload.data?.[0]?.embedding;
  if (!vector || vector.length !== 1536) throw new Error("Embedding 维度不正确");
  return { vector: `[${vector.join(",")}]`, tokens: payload.usage?.total_tokens ?? 0 };
}

async function fulltextRecall(question: string, intent: QueryIntent): Promise<RetrievalCandidate[]> {
  const scoped = filters(intent); const queryParam = scoped.params.length + 1; const termsParam = queryParam + 1; const deterministicFallbackParam = termsParam + 1;
  const searchTerms = extractSearchTerms(question);
  const deterministicFallback = intent.knowledgeTypes.length === 1 && intent.knowledgeTypes[0] === "out_of_scope";
  const result = await getPool().query(`select c.chunk_id,c.knowledge_id,c.title,c.full_text,c.metadata,c.protected_fields,c.source_language,c.knowledge_type,c.api_type,c.api_version,c.products, greatest(ts_rank_cd(c.search_document,websearch_to_tsquery('simple',$${queryParam})),similarity(c.title,$${queryParam}),similarity(c.full_text,$${queryParam}),case when $${queryParam}=any(c.exact_terms) then 1 else 0 end,lexical.score) text_score from v2_search.chunks c join v2_search.index_versions v on v.id=c.index_version_id cross join lateral (select coalesce(count(*) filter (where lower(c.full_text) like '%' || lower(term) || '%'),0)::float / greatest(cardinality($${termsParam}::text[]),1) score from unnest($${termsParam}::text[]) term) lexical where ${scoped.sql} and ($${deterministicFallbackParam} or c.search_document @@ websearch_to_tsquery('simple',$${queryParam}) or similarity(c.title,$${queryParam})>0.08 or similarity(c.full_text,$${queryParam})>0.08 or $${queryParam}=any(c.exact_terms) or lexical.score>0) order by text_score desc limit ${retrievalConfig.fulltextTopK}`, [...scoped.params, question, searchTerms, deterministicFallback]);
  return result.rows.map((row, index) => candidate(row, "fulltext", index + 1));
}

async function vectorRecall(vector: string, intent: QueryIntent): Promise<RetrievalCandidate[]> {
  const scoped = filters(intent); const vectorParam = scoped.params.length + 1;
  const result = await getPool().query(`select c.chunk_id,c.knowledge_id,c.title,c.full_text,c.metadata,c.protected_fields,c.source_language,c.knowledge_type,c.api_type,c.api_version,c.products,1-(c.embedding <=> $${vectorParam}::vector) vector_score from v2_search.chunks c join v2_search.index_versions v on v.id=c.index_version_id where ${scoped.sql} order by c.embedding <=> $${vectorParam}::vector limit ${retrievalConfig.vectorTopK}`, [...scoped.params, vector]);
  return result.rows.map((row, index) => candidate(row, "vector", index + 1));
}

export async function retrieveV2(question: string, product: "dicloak" | "paraturbo" = "dicloak", signal?: AbortSignal): Promise<RetrievalTrace> {
  const totalStarted = performance.now(); const timings: Record<string, number> = {}; const degradedRoutes: string[] = [];
  const intent = parseQuery(question, product); const scoped = filters(intent);
  const textTask = runTimedOperation("全文召回", () => fulltextRecall(question, intent), signal);
  const embeddingTask = runTimedOperation("查询 embedding", (taskSignal) => embedQuery(question, taskSignal), signal, retrievalConfig.embeddingTimeoutMs);
  const [textResult, embeddingResult] = await Promise.all([textTask, embeddingTask]);
  timings.fulltext = textResult.ms; timings.embedding = embeddingResult.ms;
  if (textResult.error) degradedRoutes.push(textResult.error);
  if (embeddingResult.error) degradedRoutes.push(embeddingResult.error);
  let vectorResult: { name: string; value?: RetrievalCandidate[]; error?: string; ms: number } = { name: "向量召回", value: [], ms: 0 };
  if (embeddingResult.value) vectorResult = await runTimedOperation("向量召回", () => vectorRecall(embeddingResult.value!.vector, intent), signal);
  timings.vector = vectorResult.ms; if (vectorResult.error) degradedRoutes.push(vectorResult.error);
  const fulltext = textResult.value ?? []; const vector = vectorResult.value ?? [];
  const fusionStarted = performance.now(); const fused = reciprocalRankFusion([fulltext, vector]); timings.fusion = elapsed(fusionStarted);
  const rerankStarted = performance.now(); const reranked = rerankCandidates(question, intent, fused); timings.rerank = elapsed(rerankStarted);
  const uniqueKnowledge = dedupeKnowledgeCandidates(reranked);
  const confidenceResult = calculateConfidence(intent, uniqueKnowledge);
  const decision = decideRetrieval(question, intent, uniqueKnowledge, confidenceResult.confidence, confidenceResult.reasons);
  const top = decision.selectedKnowledge;
  timings.total = elapsed(totalStarted);
  return { question, intent, filters: scoped.debug, fulltext, vector, fused, reranked: uniqueKnowledge, ...decision, top, filteredReasons: Object.entries(scoped.debug).filter(([, value]) => value !== null && (!Array.isArray(value) || value.length)).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`), confidence: confidenceResult.confidence, confidenceReasons: confidenceResult.reasons, degradedRoutes, timings };
}
