import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { root, writeReport } from './evaluation/evaluation-utils.mjs';

const knowledgeDirectory = path.join(root, 'knowledge-source');
const manifest = JSON.parse(await fs.readFile(path.join(knowledgeDirectory, 'manifest.json'), 'utf8'));
const faqOverrideIndex = process.argv.indexOf('--faq');
const faqOverridePath = faqOverrideIndex >= 0 && process.argv[faqOverrideIndex + 1]
  ? path.resolve(process.argv[faqOverrideIndex + 1])
  : null;
const findings = [];
const records = {};
const add = (severity, code, type, file, sheet, row, column, message) => findings.push({ severity, code, type, file, sheet, row, column, message });
const text = (value) => String(value ?? '').trim();
const splitIds = (value) => text(value).split(/[,，、;；\s]+/).map((item) => item.trim()).filter(Boolean);
const allowedProducts = new Set(['', 'all', 'dicloak', 'paraturbo']);

function sheetRows(fileName, sheetName) {
  const workbook = records[fileName];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true }).map((row, index) => ({ values: row, row: index + 2 }));
}

for (const fileName of Object.values(manifest.files)) {
  const sourcePath = fileName === manifest.files.faq && faqOverridePath
    ? faqOverridePath
    : path.join(knowledgeDirectory, fileName);
  records[fileName] = XLSX.readFile(sourcePath, { cellDates: true });
}

const termFile = manifest.files.terminology;
const termSheet = records[termFile].SheetNames[0];
const termRows = sheetRows(termFile, termSheet);
const termIds = new Set();
const termIdsByEnglish = new Map();
for (const { values, row } of termRows) {
  const id = text(values.term_id);
  if (!id) add('error', 'TERM_ID_EMPTY', '术语', termFile, termSheet, row, 'term_id', '术语 ID 为空');
  else if (termIds.has(id)) add('error', 'TERM_ID_DUPLICATE', '术语', termFile, termSheet, row, 'term_id', `术语 ID 重复：${id}`);
  else termIds.add(id);
  const english = text(values['英文']);
  const visibleValue = text(values.is_ui_visible).toLowerCase();
  const isUiVisible = values.is_ui_visible === 1 || ['1', 'true', '是', 'yes'].includes(visibleValue);
  if (isUiVisible && !english) add('error', 'TERM_EN_EMPTY', '术语', termFile, termSheet, row, '英文', `界面可见术语 ${id || '(空 ID)'} 的英文为空`);
  else {
    const normalizedEnglish = english.toLowerCase();
    const matchingIds = termIdsByEnglish.get(normalizedEnglish) ?? new Set();
    if (id) matchingIds.add(id);
    termIdsByEnglish.set(normalizedEnglish, matchingIds);
  }
  for (const column of isUiVisible ? ['俄语', '葡萄牙语（巴西）', '西班牙语', '越南语'] : []) {
    if (!text(values[column])) add('warning', 'TERM_TRANSLATION_MISSING', '术语', termFile, termSheet, row, column, `术语 ${id || '(空 ID)'} 缺少目标语言译法`);
  }
}

const faqFile = manifest.files.faq;
const faqReportFile = faqOverridePath ? path.basename(faqOverridePath) : faqFile;
const faqSheets = ['feature_faq', 'troubleshooting', 'user_routing', 'out_of_scope'];
const faqIds = new Map();
for (const sheet of faqSheets) {
  for (const { values, row } of sheetRows(faqFile, sheet)) {
    const id = text(values.FAQ_ID);
    if (!id) add('error', 'FAQ_ID_EMPTY', 'FAQ', faqReportFile, sheet, row, 'FAQ_ID', 'FAQ ID 为空');
    else if (faqIds.has(id)) add('error', 'FAQ_ID_DUPLICATE', 'FAQ', faqReportFile, sheet, row, 'FAQ_ID', `FAQ ID 重复，首次位于 ${faqIds.get(id)}`);
    else faqIds.set(id, `${sheet}:${row}`);
    const question = text(values['标准问题（中文）']) || text(values['标准问题（英文）']);
    const answerColumns = sheet === 'troubleshooting' ? ['标准答案（通用）', '标准答案（client）', '标准答案（end_user）'] : sheet === 'out_of_scope' ? ['标准答案（英文）'] : ['标准答案'];
    if (sheet !== 'out_of_scope' && !question) add('error', 'FAQ_QUESTION_EMPTY', 'FAQ', faqReportFile, sheet, row, '标准问题', `FAQ ${id || '(空 ID)'} 的问题为空`);
    if (!answerColumns.some((column) => text(values[column]))) add('error', 'FAQ_ANSWER_EMPTY', 'FAQ', faqReportFile, sheet, row, answerColumns.join('/'), `FAQ ${id || '(空 ID)'} 的答案为空`);
    const linkedTermIds = splitIds(values.term_id ?? values['术语ID'] ?? values['涉及术语']);
    for (const termId of linkedTermIds) if (!termIds.has(termId)) add('error', 'FAQ_TERM_ID_UNKNOWN', 'FAQ', faqReportFile, sheet, row, 'term_id', `FAQ ${id || '(空 ID)'} 引用了不存在的 term_id：${termId}`);
    for (const column of answerColumns) {
      const answer = text(values[column]);
      const openCount = (answer.match(/\{\{/g) ?? []).length;
      const closeCount = (answer.match(/\}\}/g) ?? []).length;
      if (openCount !== closeCount) add('error', 'PLACEHOLDER_UNCLOSED', 'FAQ', faqReportFile, sheet, row, column, '{{}} 占位符未闭合');
      for (const match of answer.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        const placeholder = match[1].trim().toLowerCase();
        const placeholderTermIds = termIdsByEnglish.get(placeholder);
        const hasLinkedTerm = placeholderTermIds && linkedTermIds.some((termId) => placeholderTermIds.has(termId));
        if (!hasLinkedTerm) add('error', 'PLACEHOLDER_TERM_UNLINKED', 'FAQ', faqReportFile, sheet, row, column, `占位符「${match[1]}」无法关联当前知识的 term_id`);
      }
    }
  }
}

const functionFile = manifest.files.functionKnowledge;
const functionSheet = records[functionFile].SheetNames[0];
const functionIds = new Set();
for (const { values, row } of sheetRows(functionFile, functionSheet)) {
  const id = text(values.function_id);
  if (!id) add('error', 'FUNCTION_ID_EMPTY', '功能知识', functionFile, functionSheet, row, 'function_id', '功能知识 ID 为空');
  else if (functionIds.has(id)) add('error', 'FUNCTION_ID_DUPLICATE', '功能知识', functionFile, functionSheet, row, 'function_id', `功能知识 ID 重复：${id}`);
  else functionIds.add(id);
  const termColumns = ['一级模块术语ID', '页面名称术语ID', '功能点术语ID'];
  for (const column of termColumns) for (const termId of splitIds(values[column])) if (!termIds.has(termId)) add('error', 'FUNCTION_TERM_ID_UNKNOWN', '功能知识', functionFile, functionSheet, row, column, `无法解析 term_id：${termId}`);
  const product = text(values['已支持产品']).toLowerCase();
  if (!allowedProducts.has(product)) add('error', 'PRODUCT_SCOPE_INVALID', '功能知识', functionFile, functionSheet, row, '已支持产品', `无效产品范围：${product}`);
}

const apiFile = manifest.files.api;
const endpointSheet = records[apiFile].SheetNames.find((name) => name.includes('端点'));
const parameterSheet = records[apiFile].SheetNames.find((name) => name.includes('参数'));
const apiIds = new Set();
for (const { values, row } of sheetRows(apiFile, endpointSheet)) {
  const id = text(values.api_id);
  if (!id) add('error', 'API_ID_EMPTY', 'API', apiFile, endpointSheet, row, 'api_id', 'API ID 为空');
  else if (apiIds.has(id)) add('error', 'API_ID_DUPLICATE', 'API', apiFile, endpointSheet, row, 'api_id', `API ID 重复：${id}`);
  else apiIds.add(id);
  const apiType = text(values['API类型']);
  if (!['HTTP API', 'Local API', 'Local API V1', 'Local API V2'].includes(apiType)) add('error', 'API_TYPE_INVALID', 'API', apiFile, endpointSheet, row, 'API类型', `无效 API 类型：${apiType || '空'}`);
  if (!text(values['端点路径'])) add('error', 'API_ENDPOINT_EMPTY', 'API', apiFile, endpointSheet, row, '端点路径', `API ${id || '(空 ID)'} 的 Endpoint 为空`);
  const product = text(values['已支持产品']).toLowerCase();
  if (!allowedProducts.has(product)) add('error', 'PRODUCT_SCOPE_INVALID', 'API', apiFile, endpointSheet, row, '已支持产品', `无效产品范围：${product}`);
}
for (const { values, row } of sheetRows(apiFile, parameterSheet)) {
  const id = text(values.api_id);
  if (id && !apiIds.has(id)) add('error', 'API_PARAMETER_ORPHAN', 'API参数', apiFile, parameterSheet, row, 'api_id', `参数引用不存在的 API ID：${id}`);
  if (!text(values['参数名'])) add('warning', 'API_PARAMETER_NAME_EMPTY', 'API参数', apiFile, parameterSheet, row, '参数名', 'API 参数名为空');
}

const pricingFile = manifest.files.pricing;
const pricingSheet = records[pricingFile].SheetNames[0];
const pricingRows = sheetRows(pricingFile, pricingSheet);
const pricingHeaders = pricingRows.length ? Object.keys(pricingRows[0].values) : [];
if (!pricingHeaders.includes('Features')) add('error', 'PRICING_FIELD_MISSING', '套餐', pricingFile, pricingSheet, 1, 'Features', '缺少套餐必需字段 Features');
if (!pricingHeaders.some((header) => header.includes('/'))) add('error', 'PRICING_PLAN_MISSING', '套餐', pricingFile, pricingSheet, 1, '套餐列', '缺少套餐列');
for (const { values, row } of pricingRows) if (!text(values.Features)) add('error', 'PRICING_FEATURE_EMPTY', '套餐', pricingFile, pricingSheet, row, 'Features', '套餐功能名称为空');

const counts = findings.reduce((summary, finding) => ({ ...summary, [finding.severity]: (summary[finding.severity] ?? 0) + 1 }), { error: 0, warning: 0 });
const summary = { files: Object.keys(records).length, terms: termRows.length, faq: faqIds.size, functions: functionIds.size, apiEndpoints: apiIds.size, errors: counts.error, warnings: counts.warning };
const data = { generatedAt: new Date().toISOString(), manifestVersion: manifest.version, faqSource: faqReportFile, summary, findings };
const rows = findings.map((finding) => ({ 级别: finding.severity, 代码: finding.code, 类型: finding.type, 文件: finding.file, Sheet: finding.sheet, 行: finding.row, 列: finding.column, 说明: finding.message }));
await writeReport(path.join(root, 'reports', 'knowledge'), 'latest', data, rows, '正式知识诊断报告');
const sampleFindings = findings.slice(0, 20).map((finding) => ({ ...finding, message: finding.message.replace(/[A-Z]{2,}-[A-Z0-9-]+/g, '[已脱敏ID]') }));
await writeReport(path.join(root, 'evaluation-source', 'examples'), 'knowledge-diagnostic-sample', { ...data, findings: sampleFindings, summary: { ...summary, note: '仅含前 20 条且 ID 已脱敏；完整报告不提交 Git' } }, sampleFindings, '正式知识诊断（脱敏摘要）');
console.log(`知识诊断完成：${counts.error} 个错误，${counts.warning} 个警告。完整报告已写入 reports/knowledge。`);
