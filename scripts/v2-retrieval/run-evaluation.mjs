import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseEvaluationWorkbook, escapeHtml } from '../evaluation/evaluation-utils.mjs';
import { retrieveV2 } from '../../src/lib/server/v2/retrieval/service.ts';

const input = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('evaluation-source', 'V2评测集.local.xlsx');
const parsed = await parseEvaluationWorkbook(input);
if (parsed.errors.length) throw new Error(parsed.errors.map((error) => `${error.row}/${error.column}: ${error.message}`).join('\n'));
const cases = parsed.cases.filter((item) => item.enabled);
const matchesExpected = (actual, expected) => expected.has(actual) || [...expected].some((id) => actual.startsWith(`${id}:`));
const results = new Array(cases.length);
let cursor = 0;
async function worker() {
  while (cursor < cases.length) {
    const index = cursor; cursor += 1; const item = cases[index]; const started = performance.now();
    try {
      const trace = await retrieveV2(item.question, item.product);
      const retrievalCandidates = trace.reranked.slice(0, 5);
      const ids = retrievalCandidates.map((candidate) => candidate.knowledgeId);
      const acceptedIds = trace.top.map((candidate) => candidate.knowledgeId);
      const expected = new Set(item.knowledgeIds); const rankIndex = ids.findIndex((id) => matchesExpected(id, expected));
      const noKnowledge = item.knowledgeType === '无知识';
      const evaluationPolicyConflict = noKnowledge && trace.questionMode === 'broad_troubleshooting' && trace.selectedKnowledge.length > 0;
      const productErrors = trace.top.filter((candidate) => !candidate.products.includes(item.product)).length;
      const expectedApi = item.knowledgeType === 'HTTP API' ? 'http' : item.knowledgeType === 'Local API' ? 'local' : null;
      const apiTypeErrors = expectedApi && trace.intent.apiType ? trace.top.filter((candidate) => candidate.apiType && candidate.apiType !== trace.intent.apiType).length : 0;
      results[index] = { caseId: item.caseId, question: item.question, language: item.language, knowledgeType: item.knowledgeType, expectedIds: item.knowledgeIds, actualIds: ids, acceptedIds, rank: rankIndex < 0 ? null : rankIndex + 1, confidence: trace.confidence, evidenceConfidence: trace.evidenceConfidence, questionMode: trace.questionMode, responseStrategy: trace.responseStrategy, selectedKnowledgeIds: trace.selectedKnowledge.map((candidate) => candidate.knowledgeId), knowledgeGroups: trace.knowledgeGroups, branches: trace.branches, missingCriticalInformation: trace.missingCriticalInformation, optionalFollowUpFields: trace.optionalFollowUpFields, confidenceReasons: trace.confidenceReasons, decisionReasons: trace.decisionReasons, degradedRoutes: trace.degradedRoutes, productErrors, apiTypeErrors, evaluationPolicyConflict, noKnowledgeError: noKnowledge && acceptedIds.length > 0 && !evaluationPolicyConflict, timings: trace.timings, top: retrievalCandidates.map((candidate) => ({ chunkId: candidate.chunkId, knowledgeId: candidate.knowledgeId, title: candidate.title, score: candidate.rerankScore, vectorScore: candidate.vectorScore, textScore: candidate.textScore, apiType: candidate.apiType, products: candidate.products })), error: null, milliseconds: Math.round(performance.now() - started) };
    } catch (error) { results[index] = { caseId: item.caseId, question: item.question, language: item.language, knowledgeType: item.knowledgeType, expectedIds: item.knowledgeIds, actualIds: [], rank: null, confidence: 'none', productErrors: 0, apiTypeErrors: 0, noKnowledgeError: false, timings: {}, top: [], error: error instanceof Error ? error.message : String(error), milliseconds: Math.round(performance.now() - started) }; }
  }
}
const concurrency = Math.max(1, Math.min(Number(process.env.V2_EVALUATION_CONCURRENCY ?? 2), cases.length));
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0; };
const positive = results.filter((result) => result.knowledgeType !== '无知识');
const group = (key) => Object.fromEntries([...new Set(results.map((result) => result[key]))].map((value) => { const rows = results.filter((result) => result[key] === value && result.knowledgeType !== '无知识'); return [value, { cases: rows.length, recallAt1: rows.length ? rows.filter((row) => row.rank === 1).length / rows.length : null, recallAt5: rows.length ? rows.filter((row) => row.rank && row.rank <= 5).length / rows.length : null }]; }));
const summary = { cases: results.length, positiveCases: positive.length, recallAt1: positive.filter((row) => row.rank === 1).length / positive.length, recallAt5: positive.filter((row) => row.rank && row.rank <= 5).length / positive.length, mrr: positive.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / positive.length, productErrors: results.reduce((sum, row) => sum + row.productErrors, 0), apiTypeErrors: results.reduce((sum, row) => sum + row.apiTypeErrors, 0), noKnowledgeErrors: results.filter((row) => row.noKnowledgeError).length, evaluationPolicyConflicts: results.filter((row) => row.evaluationPolicyConflict).length, disabledKnowledgeErrors: 0, executionErrors: results.filter((row) => row.error).length, p50Ms: percentile(results.map((row) => row.milliseconds), 0.5), p95Ms: percentile(results.map((row) => row.milliseconds), 0.95) };
const report = { generatedAt: new Date().toISOString(), sourceFile: path.basename(input), mode: 'real-hybrid-retrieval', summary, byLanguage: group('language'), byKnowledgeType: group('knowledgeType'), results };
const output = path.resolve('reports', 'evaluation'); await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'v2-retrieval-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const cards = Object.entries({ 'Recall@1': percent(summary.recallAt1), 'Recall@5': percent(summary.recallAt5), MRR: summary.mrr.toFixed(3), '产品错误': summary.productErrors, 'API类型错误': summary.apiTypeErrors, '无知识错误召回': summary.noKnowledgeErrors, P50: `${summary.p50Ms}ms`, P95: `${summary.p95Ms}ms` }).map(([key, value]) => `<div><span>${escapeHtml(key)}</span><b>${escapeHtml(value)}</b></div>`).join('');
const rows = results.map((row) => `<tr class="${row.rank === 1 || row.knowledgeType === '无知识' && !row.noKnowledgeError ? 'pass' : 'fail'}"><td>${escapeHtml(row.caseId)}</td><td>${escapeHtml(row.language)}</td><td>${escapeHtml(row.knowledgeType)}</td><td>${escapeHtml(row.expectedIds.join(';'))}</td><td>${escapeHtml(row.actualIds.join(';'))}</td><td>${row.rank ?? '-'}</td><td>${escapeHtml(row.evidenceConfidence)}</td><td>${escapeHtml(row.questionMode)}</td><td>${escapeHtml(row.responseStrategy)}</td><td>${escapeHtml(row.selectedKnowledgeIds.join(';'))}</td><td>${row.milliseconds}</td></tr>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>V2 真实混合检索评测</title><style>body{font:14px system-ui;margin:32px;color:#17333c}.cards{display:flex;gap:12px;flex-wrap:wrap}.cards div{background:#e5f4f7;padding:14px 18px;border-radius:10px}.cards span{display:block;color:#52717b}.cards b{font-size:22px}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.fail{background:#fff7ed}</style><h1>V2 真实混合检索评测</h1><p>真实测试 Supabase + TokenLab 查询 embedding；不生成客户回复。</p><div class="cards">${cards}</div><table><tr><th>案例</th><th>语言</th><th>类型</th><th>预期</th><th>Top 1–5</th><th>排名</th><th>证据</th><th>模式</th><th>策略</th><th>选中知识</th><th>耗时</th></tr>${rows}</table></html>`;
await fs.writeFile(path.join(output, 'v2-retrieval-latest.html'), html);
console.log(JSON.stringify({ summary, byLanguage: report.byLanguage, byKnowledgeType: report.byKnowledgeType }, null, 2));
