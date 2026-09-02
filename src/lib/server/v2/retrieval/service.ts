import { Pool, type QueryResultRow } from "pg";
import { performance } from "node:perf_hooks";
import { retrievalConfig } from "./config.ts";
import { parseQuery } from "./query-parser.ts";
import { calculateConfidence, reciprocalRankFusion, rerankCandidates } from "./ranking.ts";
import type { QueryIntent, RetrievalCandidate, RetrievalTrace } from "./types.ts";

let pool: Pool | null = null;
const getPool = () => pool ??= new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: process.env.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED !== "false" }, max: 5 });
const elapsed = (started: number) => Math.round((performance.now() - started) * 10) / 10;

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

function filters(intent: QueryIntent, alias = "c"): { sql: string; params: unknown[]; debug: Record<string, unknown> } {
  const conditions = ["v.status='published'", `${alias}.enabled`, "$1 = any(c.products)"];
  const params: unknown[] = [intent.product];
  const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace("?", `$${params.length}`)); };
  if (intent.knowledgeTypes.length) add(`${alias}.knowledge_type = any(?::text[])`, intent.knowledgeTypes);
  if (intent.apiType) add(`${alias}.api_type = ?`, intent.apiType);
  if (intent.apiVersion) add(`${alias}.api_version = ?`, intent.apiVersion);
  if (intent.method) add(`${alias}.exact_terms @> array[?]::text[]`, intent.method);
  if (intent.object) add(`lower(${alias}.metadata->>'object') = lower(?)`, intent.object);
  if (intent.action) add(`lower(${alias}.metadata->>'action') = lower(?)`, intent.action);
  return { sql: conditions.join(" and "), params, debug: { product: intent.product, published: true, enabled: true, knowledgeVersion: "current-published", knowledgeTypes: intent.knowledgeTypes, apiType: intent.apiType, apiVersion: intent.apiVersion, method: intent.method, object: intent.object, action: intent.action } };
}

function candidate(row: QueryResultRow, source: "fulltext" | "vector", rank: number): RetrievalCandidate {
  return { chunkId: row.chunk_id, knowledgeId: row.knowledge_id, title: row.title, text: row.full_text, metadata: row.metadata ?? {}, knowledgeType: row.knowledge_type, apiType: row.api_type, apiVersion: row.api_version, products: row.products, source, sourceRank: rank, textScore: Number(row.text_score ?? 0), vectorScore: Number(row.vector_score ?? 0), rrfScore: 0, rerankScore: 0, matchedBy: [source] };
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
  const scoped = filters(intent); const queryParam = scoped.params.length + 1;
  const result = await getPool().query(`select c.chunk_id,c.knowledge_id,c.title,c.full_text,c.metadata,c.knowledge_type,c.api_type,c.api_version,c.products, greatest(ts_rank_cd(c.search_document,websearch_to_tsquery('simple',$${queryParam})),similarity(c.title,$${queryParam}),similarity(c.full_text,$${queryParam}),case when $${queryParam}=any(c.exact_terms) then 1 else 0 end) text_score from v2_search.chunks c join v2_search.index_versions v on v.id=c.index_version_id where ${scoped.sql} and (c.search_document @@ websearch_to_tsquery('simple',$${queryParam}) or similarity(c.title,$${queryParam})>0.08 or similarity(c.full_text,$${queryParam})>0.08 or $${queryParam}=any(c.exact_terms)) order by text_score desc limit ${retrievalConfig.fulltextTopK}`, [...scoped.params, question]);
  return result.rows.map((row, index) => candidate(row, "fulltext", index + 1));
}

async function vectorRecall(vector: string, intent: QueryIntent): Promise<RetrievalCandidate[]> {
  const scoped = filters(intent); const vectorParam = scoped.params.length + 1;
  const result = await getPool().query(`select c.chunk_id,c.knowledge_id,c.title,c.full_text,c.metadata,c.knowledge_type,c.api_type,c.api_version,c.products,1-(c.embedding <=> $${vectorParam}::vector) vector_score from v2_search.chunks c join v2_search.index_versions v on v.id=c.index_version_id where ${scoped.sql} order by c.embedding <=> $${vectorParam}::vector limit ${retrievalConfig.vectorTopK}`, [...scoped.params, vector]);
  return result.rows.map((row, index) => candidate(row, "vector", index + 1));
}

export async function retrieveV2(question: string, product: "dicloak" | "paraturbo" = "dicloak", signal?: AbortSignal): Promise<RetrievalTrace> {
  const totalStarted = performance.now(); const timings: Record<string, number> = {}; const degradedRoutes: string[] = [];
  const intent = parseQuery(question, product); const scoped = filters(intent);
  const textTask = runTimedOperation("全文召回", () => fulltextRecall(question, intent), signal);
  const embeddingTask = runTimedOperation("查询 embedding", (taskSignal) => embedQuery(question, taskSignal), signal);
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
  const uniqueKnowledge = reranked.filter((candidate, index, items) => items.findIndex((item) => item.knowledgeId === candidate.knowledgeId) === index);
  const confidenceResult = calculateConfidence(intent, uniqueKnowledge); const top = confidenceResult.confidence === "none" ? [] : uniqueKnowledge.slice(0, retrievalConfig.outputTopK);
  timings.total = elapsed(totalStarted);
  return { question, intent, filters: scoped.debug, fulltext, vector, fused, reranked: uniqueKnowledge, top, filteredReasons: Object.entries(scoped.debug).filter(([, value]) => value !== null && (!Array.isArray(value) || value.length)).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`), confidence: confidenceResult.confidence, confidenceReasons: confidenceResult.reasons, degradedRoutes, timings };
}
