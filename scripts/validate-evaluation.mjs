import path from 'node:path';
import { evaluationDirectory, loadEvaluationManifest, parseEvaluationWorkbook } from './evaluation/evaluation-utils.mjs';

const manifest = await loadEvaluationManifest();
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(evaluationDirectory, manifest.workbook);
const result = await parseEvaluationWorkbook(input);
if (result.errors.length) {
  for (const error of result.errors) console.error(`${error.file} / ${error.sheet} / 行 ${error.row} / 列「${error.column}」：${error.message}`);
  process.exitCode = 1;
} else {
  console.log(`评测集校验通过：${path.basename(input)}，${result.cases.length} 个案例。`);
}
