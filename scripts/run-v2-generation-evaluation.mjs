import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEvaluationWorkbook, root, writeReport } from './evaluation/evaluation-utils.mjs';

const source = process.env.EVALUATION_FILE || path.join(root, 'evaluation-source', 'V2评测集.local.xlsx');
const baseUrl = process.env.EVALUATION_BASE_URL || 'http://127.0.0.1:3000';
const concurrency = Math.max(1, Math.min(5, Number(process.env.EVALUATION_CONCURRENCY) || 3));
const parsed = await parseEvaluationWorkbook(source);
if (parsed.errors.length) throw new Error(parsed.errors.map((item) => `${item.file}/${item.sheet}/${item.row}/${item.column}: ${item.message}`).join('\n'));
const cases = parsed.cases.filter((item) => item.enabled);

function includesAll(answer, expected) { const value = answer.toLocaleLowerCase(); return expected.every((item) => item.split('|').some((alternative) => value.includes(alternative.trim().toLocaleLowerCase()))); }
function excludesAll(answer, forbidden) { const value = answer.toLocaleLowerCase(); return forbidden.every((item) => !value.includes(item.toLocaleLowerCase())); }
function includesAny(answer, expected) { const value = answer.toLocaleLowerCase(); return !expected.length || expected.some((item) => value.includes(item.toLocaleLowerCase())); }
function knowledgeIdMatches(actual, expected) { return actual === expected || actual.startsWith(`${expected}:`); }
function parseEvents(text) { return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }

async function execute(item) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/v2/chat`, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: item.question, history: item.history ? [{ role: 'user', content: item.history }] : [], product: item.product, aiEngine: 'v2', aiEngineVersion: '2.0-phase-6' }) });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  const events = parseEvents(body); const error = events.find((event) => event.type === 'error');
  if (error) throw new Error(error.message || 'V2 stream error');
  const final = events.findLast((event) => event.type === 'final');
  const meta = events.filter((event) => event.type === 'meta').at(-1)?.data ?? {};
  if (!final || typeof final.content !== 'string') throw new Error('没有 final 事件');
  const answer = final.content;
  const actualKnowledgeIds = meta.knowledgeIds ?? [];
  const knowledgeMatch = item.knowledgeType === '无知识' ? actualKnowledgeIds.length === 0 : item.knowledgeIds.length === 0 ? true : item.knowledgeIds.some((expected) => actualKnowledgeIds.some((actual) => knowledgeIdMatches(actual, expected)));
  const mustIncludePass = includesAll(answer, item.mustInclude);
  const mustNotIncludePass = excludesAll(answer, item.mustNotInclude);
  const preserveExactPass = includesAll(answer, item.preserveExact);
  const anyExpressionPass = includesAny(answer, item.anyExpression ?? []);
  const askPass = item.shouldAsk ? /[?？]/.test(answer) : true;
  return { caseId: item.caseId, product: item.product, language: item.language, knowledgeType: item.knowledgeType, answer, knowledgeIds: actualKnowledgeIds, evidenceConfidence: meta.evidenceConfidence, responseStrategy: meta.responseStrategy, knowledgeMatch, mustIncludePass, anyExpressionPass, mustNotIncludePass, preserveExactPass, askPass, passed: knowledgeMatch && mustIncludePass && anyExpressionPass && mustNotIncludePass && preserveExactPass && askPass, firstTokenMs: meta.firstTokenMs, totalMs: meta.totalMs ?? Math.round(performance.now() - startedAt), token: meta.usage?.total_tokens ?? 0, modelCalls: meta.modelCalls ?? 0, retry: Boolean(meta.retry), error: null };
}

const results = new Array(cases.length); let cursor = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
  while (cursor < cases.length) {
    const index = cursor++; const item = cases[index];
    try { results[index] = await execute(item); }
    catch (error) { results[index] = { caseId: item.caseId, product: item.product, language: item.language, passed: false, error: error instanceof Error ? error.message : String(error), firstTokenMs: null, totalMs: null, token: 0, modelCalls: 0, retry: false }; }
  }
}));

const numeric = (field) => results.map((item) => item[field]).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
const percentile = (values, ratio) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] : null;
const first = numeric('firstTokenMs'); const total = numeric('totalMs');
const summary = { mode: '真实 V2 主模型评测（不是 Mock）', cases: results.length, passed: results.filter((item) => item.passed).length, failed: results.filter((item) => !item.passed).length, automatedPassRate: results.length ? `${(results.filter((item) => item.passed).length / results.length * 100).toFixed(1)}%` : '0.0%', firstTokenP50Ms: percentile(first, .5), firstTokenP95Ms: percentile(first, .95), totalP50Ms: percentile(total, .5), totalP95Ms: percentile(total, .95), totalToken: results.reduce((sum, item) => sum + item.token, 0), normalSingleCallRate: `${(results.filter((item) => item.modelCalls === 1).length / Math.max(results.length, 1) * 100).toFixed(1)}%`, retries: results.filter((item) => item.retry).length };
const report = { generatedAt: new Date().toISOString(), source: path.basename(source), privacy: '报告包含评测问题和真实模型回复，默认由 .gitignore 排除，不提交 Git。', limitations: '自动通过率只检查知识 ID、必须/禁止/原样字段和追问形态；事实正确率仍需人工审核，不能把它直接称为最终准确率。', summary, results };
const rows = results.map((item) => ({ 案例ID: item.caseId, 通过: item.passed ? '是' : '否', 产品: item.product, 语言: item.language, 策略: item.responseStrategy ?? '-', 知识命中: item.knowledgeMatch ?? false, 首字毫秒: item.firstTokenMs ?? '-', 完整毫秒: item.totalMs ?? '-', Token: item.token, 调用: item.modelCalls, 重试: item.retry ? '是' : '否', 错误: item.error ?? '', 回复: item.answer ?? '' }));
await writeReport(path.join(root, 'reports', 'evaluation'), 'v2-generation-latest', report, rows, 'V2 真实主模型回复评测');
await fs.writeFile(path.join(root, 'evaluation-source', 'examples', 'v2-generation-summary.json'), `${JSON.stringify({ generatedAt: report.generatedAt, privacy: report.privacy, limitations: report.limitations, summary }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
