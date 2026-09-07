import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareTerminologyPipeline, restoreProtectedResponse } from '../../src/lib/server/v2/terminology/pipeline.ts';

const root = process.cwd();
const knowledgePath = path.join(root, 'reports', 'v2-knowledge', 'knowledge-latest.json');
const outputDirectory = path.join(root, 'reports', 'v2-terminology');
const payload = JSON.parse(await fs.readFile(knowledgePath, 'utf8'));
const records = payload.records;
const termRecords = records.filter((record) => record.type === 'terminology');
const terms = termRecords.map((record) => ({ termId: record.id, translations: record.metadata.translations, isUiVisible: record.metadata.isUiVisible, source: record.source }));
const knowledge = records.filter((record) => record.type !== 'terminology').map((record) => ({
  id: record.id, type: record.type, sourceLanguage: record.sourceLanguage, body: record.body,
  termIds: record.termIds, metadata: record.metadata, protectedFields: record.protectedFields, source: record.source,
}));
const languages = ['zh', 'en', 'ru', 'pt', 'es', 'vi'];
const knownTermIds = new Set(terms.map((term) => term.termId));
const referencedIds = [...new Set(knowledge.flatMap((record) => record.termIds))].sort();
const placeholders = knowledge.flatMap((record) => [...record.body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => ({ knowledgeId: record.id, value: match[1], source: record.source })));
const invalidTermIds = knowledge.flatMap((record) => record.termIds.filter((termId) => !knownTermIds.has(termId)).map((termId) => ({ knowledgeId: record.id, termId, source: record.source })));
const outputTermIds = referencedIds.filter((termId) => terms.find((term) => term.termId === termId)?.isUiVisible !== false);
const missingTranslations = Object.fromEntries(languages.map((language) => [language, outputTermIds.filter((termId) => !terms.find((term) => term.termId === termId)?.translations?.[language]).length]));

const languageResults = [];
for (const language of languages) {
  const prepared = prepareTerminologyPipeline({ knowledge, terms, targetLanguage: language });
  const protectedRoundTrips = prepared.knowledge.map((item) => {
    const itemMarkers = prepared.markers.filter((marker) => marker.knowledgeId === item.knowledgeId);
    const completePreparedText = [item.body, ...Object.values(item.technicalFields)].filter(Boolean).join('\n');
    return restoreProtectedResponse(completePreparedText, { ...prepared, markers: itemMarkers });
  });
  languageResults.push({ language, ok: prepared.ok && protectedRoundTrips.every((result) => result.ok), stats: prepared.stats, errors: prepared.errors, warnings: prepared.warnings, roundTripFailures: protectedRoundTrips.filter((result) => !result.ok).length });
}

const permanentRegression = languages.map((language) => {
  const body = 'PATCH /openapi/v1/env/{env_id}/open';
  const item = { id: 'REGRESSION-API-PATH', type: 'http_api', sourceLanguage: 'structured', body, termIds: [], metadata: {}, protectedFields: [{ kind: 'method', value: 'PATCH' }, { kind: 'endpoint', value: '/openapi/v1/env/{env_id}/open' }] };
  const prepared = prepareTerminologyPipeline({ knowledge: [item], terms, targetLanguage: language });
  const restored = restoreProtectedResponse(prepared.knowledge[0].body, prepared);
  return { language, passed: restored.ok && restored.text === body };
});
const errors = languageResults.flatMap((result) => result.errors.map((error) => ({ language: result.language, ...error })));
const report = {
  generatedAt: new Date().toISOString(), manifestVersion: payload.manifestVersion,
  summary: { knowledge: knowledge.length, terminology: terms.length, referencedTermIds: referencedIds.length, nonUiReferencedTermIds: referencedIds.length - outputTermIds.length, placeholders: placeholders.length, invalidTermIds: invalidTermIds.length, unresolvedPlaceholders: errors.filter((item) => item.code === 'FAQ_PLACEHOLDER_UNLINKED').length, conflictTranslations: errors.filter((item) => item.code === 'TERM_TRANSLATION_CONFLICT').length, technicalRoundTripFailures: languageResults.reduce((sum, item) => sum + item.roundTripFailures, 0), permanentRegressionPassed: permanentRegression.every((item) => item.passed) },
  missingTranslations, invalidTermIds, languageResults, permanentRegression,
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const cards = Object.entries(report.summary).map(([key, value]) => `<div class="card"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
const languageRows = languageResults.map((item) => `<tr><td>${item.language}</td><td>${item.ok ? '通过' : '失败'}</td><td>${item.stats.termMarkers}</td><td>${item.stats.technicalMarkers}</td><td>${item.stats.fallbackTranslations}</td><td>${item.errors.length}</td><td>${item.roundTripFailures}</td></tr>`).join('');
const missingRows = languages.map((language) => `<tr><td>${language}</td><td>${missingTranslations[language]}</td></tr>`).join('');
const errorRows = errors.length ? errors.map((item) => `<tr><td>${item.language}</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.knowledgeId)}</td><td>${escapeHtml(item.message)}</td></tr>`).join('') : '<tr><td colspan="4">无错误</td></tr>';
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>V2 确定性多语言术语报告</title><style>body{font:14px system-ui;margin:32px;color:#17343d}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#e8f5f7;padding:12px 16px;border-radius:10px}.card span{display:block;color:#55737c}.card strong{font-size:22px}table{border-collapse:collapse;width:100%;margin:16px 0 28px}th{background:#146477;color:#fff;text-align:left}th,td{padding:8px;border-bottom:1px solid #d9e5e8}</style><h1>V2 确定性多语言术语和技术字段报告</h1><p>知识版本：${escapeHtml(payload.manifestVersion)}。不包含客户问题或模型回复。</p><div class="cards">${cards}</div><h2>各语言流水线</h2><table><tr><th>语言</th><th>结果</th><th>术语标记</th><th>技术标记</th><th>英文回退</th><th>错误</th><th>逐字符失败</th></tr>${languageRows}</table><h2>引用术语缺失译法</h2><table><tr><th>语言</th><th>数量</th></tr>${missingRows}</table><h2>结构化错误</h2><table><tr><th>语言</th><th>代码</th><th>知识 ID</th><th>说明</th></tr>${errorRows}</table><h2>永久回归</h2><p><code>PATCH /openapi/v1/env/{env_id}/open</code>：${report.summary.permanentRegressionPassed ? '全部语言逐字符通过' : '失败'}</p></html>`;
await fs.mkdir(outputDirectory, { recursive: true });
await Promise.all([fs.writeFile(path.join(outputDirectory, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`), fs.writeFile(path.join(outputDirectory, 'latest.html'), html)]);
console.log(JSON.stringify(report.summary, null, 2));
if (errors.length || invalidTermIds.length || !report.summary.permanentRegressionPassed || report.summary.technicalRoundTripFailures) process.exitCode = 1;
