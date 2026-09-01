import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { adaptApi, adaptFaqWorkbook, adaptFunctions, adaptPricing, adaptTerminology } from './v2-knowledge/adapters.mjs';
import { chunkKnowledge, validateChunks } from './v2-knowledge/chunker.mjs';

const root = process.cwd();
const sourceDirectory = path.join(root, 'knowledge-source');
const outputDirectory = path.join(root, 'reports', 'v2-knowledge');
const manifest = JSON.parse(await fs.readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'));

function openWorkbook(file) {
  const workbook = XLSX.readFile(path.join(sourceDirectory, file), { cellDates: true });
  return {
    sheetNames: workbook.SheetNames,
    rows(sheet) {
      const worksheet = workbook.Sheets[sheet];
      if (!worksheet) return [];
      return XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: true }).map((values, index) => ({ values, row: index + 2 }));
    },
  };
}

const warnings = [];
const faq = openWorkbook(manifest.files.faq);
const terminology = openWorkbook(manifest.files.terminology);
const functions = openWorkbook(manifest.files.functionKnowledge);
const api = openWorkbook(manifest.files.api);
const pricing = openWorkbook(manifest.files.pricing);

const records = [
  ...adaptFaqWorkbook({ workbook: faq, file: manifest.files.faq, version: manifest.version, warnings }),
  ...adaptTerminology({ workbook: terminology, file: manifest.files.terminology, version: manifest.version, warnings }),
  ...adaptFunctions({ workbook: functions, file: manifest.files.functionKnowledge, version: manifest.version, warnings }),
  ...adaptApi({ workbook: api, file: manifest.files.api, version: manifest.version, warnings }),
  ...adaptPricing({ workbook: pricing, file: manifest.files.pricing, version: manifest.version, warnings }),
];

const recordIds = new Set();
const knownTermIds = new Set(records.filter((record) => record.type === 'terminology').map((record) => record.id));
for (const record of records) {
  if (recordIds.has(record.id)) warnings.push({ code: 'KNOWLEDGE_ID_DUPLICATE', message: `标准知识 ID 重复：${record.id}`, knowledgeId: record.id, source: record.source });
  recordIds.add(record.id);
  for (const termId of record.termIds) if (!knownTermIds.has(termId)) warnings.push({ code: 'TERM_ID_UNRESOLVED', message: `无法解析 termId：${termId}`, knowledgeId: record.id, source: record.source });
}

const chunks = chunkKnowledge(records);
warnings.push(...validateChunks(records, chunks));

const countBy = (items, key) => Object.fromEntries([...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) ?? 0) + 1), new Map())].sort(([left], [right]) => left.localeCompare(right)));
const sourceCounts = Object.fromEntries([...records.reduce((map, record) => map.set(`${record.source.file} / ${record.source.sheet}`, (map.get(`${record.source.file} / ${record.source.sheet}`) ?? 0) + 1), new Map())].sort(([left], [right]) => left.localeCompare(right)));
const samples = [];
const sampleTypes = [...new Set(chunks.map((chunk) => chunk.type))];
for (const type of sampleTypes) samples.push(...chunks.filter((chunk) => chunk.type === type).slice(0, 4));
for (const chunk of chunks) {
  if (samples.length >= 40) break;
  if (!samples.some((sample) => sample.chunkId === chunk.chunkId)) samples.push(chunk);
}

const preview = {
  generatedAt: new Date().toISOString(), manifestVersion: manifest.version,
  summary: { records: records.length, chunks: chunks.length, warnings: warnings.length, sampleChunks: samples.slice(0, 40).length },
  recordsByType: countBy(records, 'type'), chunksByType: countBy(chunks, 'type'), sourceCounts,
  excludedAuxiliarySources: [{ file: manifest.files.faq, sheet: 'mapping', reason: '辅助分类与关键词映射，不作为独立回答知识' }],
  warnings, samples: samples.slice(0, 40),
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const cards = Object.entries(preview.summary).map(([key, value]) => `<div class="card"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
const typeRows = [...new Set([...Object.keys(preview.recordsByType), ...Object.keys(preview.chunksByType)])].map((type) => `<tr><td>${escapeHtml(type)}</td><td>${preview.recordsByType[type] ?? 0}</td><td>${preview.chunksByType[type] ?? 0}</td></tr>`).join('');
const warningRows = warnings.length ? warnings.map((warning) => `<tr><td>${escapeHtml(warning.code)}</td><td>${escapeHtml(warning.knowledgeId ?? '')}</td><td>${escapeHtml(warning.message)}</td><td>${escapeHtml(warning.source ? `${warning.source.file} / ${warning.source.sheet} / ${warning.source.row}` : '')}</td></tr>`).join('') : '<tr><td colspan="4">无告警</td></tr>';
const sampleRows = preview.samples.map((chunk) => `<article><h3>${escapeHtml(chunk.chunkId)}</h3><p><b>类型：</b>${escapeHtml(chunk.type)}　<b>产品：</b>${escapeHtml(chunk.productScope.join(', '))}　<b>来源：</b>${escapeHtml(`${chunk.source.file} / ${chunk.source.sheet} / ${chunk.source.row}`)}</p><pre>${escapeHtml(chunk.text)}</pre><details><summary>metadata 与受保护字段</summary><pre>${escapeHtml(JSON.stringify({ metadata: chunk.metadata, protectedFields: chunk.protectedFields, termIds: chunk.termIds, contentHash: chunk.contentHash }, null, 2))}</pre></details></article>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>V2 标准知识与安全分块预览</title><style>body{font:14px system-ui;margin:32px;color:#18323b}h1,h2{color:#155e75}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#e6f4f7;border-radius:10px;padding:12px 18px;min-width:120px}.card span{display:block;color:#52717b}.card strong{font-size:22px}table{border-collapse:collapse;width:100%;margin:16px 0 28px}th{background:#155e75;color:#fff;text-align:left}th,td{padding:9px;border-bottom:1px solid #dce6ea;vertical-align:top}article{border:1px solid #dce6ea;border-radius:10px;padding:16px;margin:14px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f8f9;padding:12px;border-radius:8px}</style><h1>V2 标准知识与安全分块预览</h1><p>知识版本：${escapeHtml(manifest.version)}。报告包含正式知识内容，仅供本地人工审核，不提交 Git。</p><div class="cards">${cards}</div><h2>类型统计</h2><table><thead><tr><th>类型</th><th>知识数</th><th>分块数</th></tr></thead><tbody>${typeRows}</tbody></table><h2>告警</h2><table><thead><tr><th>代码</th><th>知识 ID</th><th>说明</th><th>来源</th></tr></thead><tbody>${warningRows}</tbody></table><h2>真实分块样例（${preview.samples.length}）</h2>${sampleRows}</html>`;

await fs.mkdir(outputDirectory, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDirectory, 'knowledge-latest.json'), `${JSON.stringify({ generatedAt: preview.generatedAt, manifestVersion: manifest.version, records }, null, 2)}\n`),
  fs.writeFile(path.join(outputDirectory, 'chunks-latest.json'), `${JSON.stringify({ generatedAt: preview.generatedAt, manifestVersion: manifest.version, chunks }, null, 2)}\n`),
  fs.writeFile(path.join(outputDirectory, 'preview-latest.json'), `${JSON.stringify(preview, null, 2)}\n`),
  fs.writeFile(path.join(outputDirectory, 'preview-latest.html'), html),
]);

console.log(`V2 知识适配完成：${records.length} 条标准知识，${chunks.length} 个安全分块，${warnings.length} 个告警，${preview.samples.length} 个真实样例。`);
if (warnings.length) process.exitCode = 1;
