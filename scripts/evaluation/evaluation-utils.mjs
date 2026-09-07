import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';

export const root = process.cwd();
export const evaluationDirectory = path.resolve(root, 'evaluation-source');

export async function loadEvaluationManifest() {
  return JSON.parse(await fs.readFile(path.join(evaluationDirectory, 'manifest.json'), 'utf8'));
}

export function splitSemicolon(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(';').map((item) => item.trim()).filter(Boolean);
}

export function parseBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '是', 'yes'].includes(normalized)) return true;
  if (['false', '否', 'no'].includes(normalized)) return false;
  return undefined;
}

export function issue(file, sheet, row, column, message) {
  return { file: path.basename(file), sheet, row, column, message };
}

export async function parseEvaluationWorkbook(filePath) {
  const manifest = await loadEvaluationManifest();
  const errors = [];
  if (path.extname(filePath).toLowerCase() !== '.xlsx') {
    errors.push(issue(filePath, '-', 0, '-', '文件格式必须为 .xlsx'));
    return { manifest, cases: [], errors };
  }

  let workbook;
  try {
    workbook = XLSX.readFile(filePath, { cellDates: true });
  } catch (error) {
    errors.push(issue(filePath, '-', 0, '-', `无法读取 Excel：${error instanceof Error ? error.message : String(error)}`));
    return { manifest, cases: [], errors };
  }
  if (!workbook.SheetNames.includes(manifest.sheetName)) {
    errors.push(issue(filePath, manifest.sheetName, 0, '-', `缺少必需 Sheet「${manifest.sheetName}」`));
    return { manifest, cases: [], errors };
  }

  const sheet = workbook.Sheets[manifest.sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const headers = (matrix[0] ?? []).map((value) => String(value).trim());
  for (const column of manifest.requiredColumns) {
    if (!headers.includes(column)) errors.push(issue(filePath, manifest.sheetName, 1, column, '缺少必填列'));
  }
  if (errors.length > 0) return { manifest, cases: [], errors };

  const ids = new Map();
  const cases = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const excelRow = index + 1;
    const raw = Object.fromEntries(headers.map((header, column) => [header, matrix[index]?.[column] ?? '']));
    if (Object.values(raw).every((value) => String(value).trim() === '')) continue;
    const caseId = String(raw['案例ID']).trim();
    for (const column of ['案例ID', '是否启用', '客户问题', '产品', '语言', '知识类型', '是否应该追问']) {
      if (String(raw[column]).trim() === '') errors.push(issue(filePath, manifest.sheetName, excelRow, column, '必填值为空'));
    }
    if (caseId) {
      if (ids.has(caseId)) errors.push(issue(filePath, manifest.sheetName, excelRow, '案例ID', `案例 ID 重复，首次出现在第 ${ids.get(caseId)} 行`));
      else ids.set(caseId, excelRow);
    }
    const enabled = parseBoolean(raw['是否启用']);
    const shouldAsk = parseBoolean(raw['是否应该追问']);
    if (enabled === undefined) errors.push(issue(filePath, manifest.sheetName, excelRow, '是否启用', '布尔值只允许 TRUE/FALSE、是/否或 1/0'));
    if (shouldAsk === undefined) errors.push(issue(filePath, manifest.sheetName, excelRow, '是否应该追问', '布尔值只允许 TRUE/FALSE、是/否或 1/0'));
    const product = String(raw['产品']).trim().toLowerCase();
    const language = String(raw['语言']).trim().toLowerCase();
    const knowledgeType = String(raw['知识类型']).trim();
    if (!manifest.allowedProducts.includes(product)) errors.push(issue(filePath, manifest.sheetName, excelRow, '产品', `不支持的产品：${product || '空'}`));
    if (!manifest.allowedLanguages.includes(language)) errors.push(issue(filePath, manifest.sheetName, excelRow, '语言', `不支持的语言：${language || '空'}`));
    if (!manifest.allowedKnowledgeTypes.includes(knowledgeType)) errors.push(issue(filePath, manifest.sheetName, excelRow, '知识类型', `不支持的知识类型：${knowledgeType || '空'}`));
    const knowledgeIds = splitSemicolon(raw['正确知识ID']);
    if (knowledgeType === '无知识' && knowledgeIds.length > 0) errors.push(issue(filePath, manifest.sheetName, excelRow, '正确知识ID', '无知识案例不得填写知识 ID'));
    if (knowledgeType !== '无知识' && knowledgeIds.length === 0) errors.push(issue(filePath, manifest.sheetName, excelRow, '正确知识ID', '有知识案例至少需要一个知识 ID'));
    for (const column of manifest.arrayColumns) {
      const value = String(raw[column] ?? '');
      if (/[；]/.test(value)) errors.push(issue(filePath, manifest.sheetName, excelRow, column, '数组必须使用英文分号 ; 分隔'));
    }
    cases.push({
      caseId, enabled, question: String(raw['客户问题']).trim(), history: String(raw['对话历史']).trim(),
      product, language, knowledgeIds, knowledgeType, shouldAsk,
      mustInclude: splitSemicolon(raw['必须包含']), anyExpression: splitSemicolon(raw['任一表达满足']), mustNotInclude: splitSemicolon(raw['禁止包含']),
      preserveExact: splitSemicolon(raw['必须保持原样']), referenceAnswer: String(raw['参考回复']).trim(),
      errorTypes: splitSemicolon(raw['错误类型']), notes: String(raw['备注']).trim(), row: excelRow,
    });
  }
  return { manifest, cases, errors };
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function reportHtml(title, summary, rows) {
  const cards = Object.entries(summary).map(([key, value]) => `<div class="card"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const body = rows.map((row) => `<tr>${Object.values(row).map((value) => `<td>${escapeHtml(Array.isArray(value) ? value.join('；') : value)}</td>`).join('')}</tr>`).join('');
  const headers = rows.length ? `<tr>${Object.keys(rows[0]).map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr>` : '';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:14px system-ui;margin:32px;color:#18323b}h1{color:#155e75}.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#e6f4f7;border-radius:10px;padding:12px 18px;min-width:120px}.card span{display:block;color:#52717b}.card strong{font-size:22px}table{border-collapse:collapse;width:100%;margin-top:24px}th{background:#155e75;color:white;text-align:left}th,td{padding:9px;border-bottom:1px solid #dce6ea;vertical-align:top}</style><h1>${escapeHtml(title)}</h1><div class="cards">${cards}</div><table><thead>${headers}</thead><tbody>${body}</tbody></table></html>`;
}

export async function writeReport(directory, name, data, htmlRows, title) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  await fs.writeFile(path.join(directory, `${name}.html`), reportHtml(title, data.summary, htmlRows));
}
