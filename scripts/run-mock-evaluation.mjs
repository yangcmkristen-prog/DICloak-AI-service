import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateAnswer } from './evaluation/evaluation-core.mjs';
import { evaluationDirectory, loadEvaluationManifest, parseEvaluationWorkbook, root, writeReport } from './evaluation/evaluation-utils.mjs';

const manifest = await loadEvaluationManifest();
const parsed = await parseEvaluationWorkbook(path.join(evaluationDirectory, manifest.workbook));
if (parsed.errors.length) throw new Error('评测模板校验失败，请先运行 pnpm evaluation:validate');
const answers = JSON.parse(await fs.readFile(path.join(evaluationDirectory, 'examples', 'mock-answers.json'), 'utf8'));
const results = parsed.cases.filter((item) => item.enabled).map((item) => {
  const answer = answers[item.caseId] ?? '';
  return { caseId: item.caseId, target: 'mock', answer, ...evaluateAnswer(item, answer) };
});
const passed = results.filter((result) => result.pass).length;
const data = { generatedAt: new Date().toISOString(), disclaimer: '固定 Mock 规则结果，不代表真实 AI 准确率。', summary: { total: results.length, passed, failed: results.length - passed }, results };
const rows = results.map((result) => ({ 案例ID: result.caseId, 结果: result.pass ? '通过' : '失败', 失败检查: result.checks.filter((check) => !check.pass).map((check) => check.name) }));
await writeReport(path.join(root, 'reports', 'evaluation'), 'mock-latest', data, rows, 'V2 确定性 Mock 评测');
await writeReport(path.join(evaluationDirectory, 'examples'), 'mock-sample', data, rows, 'V2 确定性 Mock 评测（脱敏样例）');
console.log(`Mock 评测完成：${passed}/${results.length} 通过。`);
if (passed !== results.length) process.exitCode = 1;
