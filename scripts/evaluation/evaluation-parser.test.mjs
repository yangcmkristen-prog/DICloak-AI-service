import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import { parseBoolean, parseEvaluationWorkbook, splitSemicolon } from './evaluation-utils.mjs';

test('解析中英文布尔字段', () => {
  assert.equal(parseBoolean('是'), true);
  assert.equal(parseBoolean('FALSE'), false);
  assert.equal(parseBoolean('maybe'), undefined);
});

test('只按英文分号解析数组并清理空项', () => {
  assert.deepEqual(splitSemicolon('GET; env_id;;/api/v1/test'), ['GET', 'env_id', '/api/v1/test']);
});

test('解析错误包含文件、Sheet、行号、列名和中文说明', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'evaluation-parser-'));
  const file = path.join(directory, 'invalid.xlsx');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['案例ID', '是否启用', '客户问题', '对话历史', '产品', '语言', '正确知识ID', '知识类型', '是否应该追问', '必须包含', '禁止包含', '必须保持原样', '参考回复', '错误类型', '备注'],
    ['CASE-1', '也许', '测试', '', 'unknown', 'xx', '', 'FAQ', '否', '', '', '', '', '', ''],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, '评测案例');
  XLSX.writeFile(workbook, file);
  const result = await parseEvaluationWorkbook(file);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.every((error) => error.file && error.sheet && error.row > 0 && error.column && /[\u4e00-\u9fff]/.test(error.message)));
});
