import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const knowledgeDirectory = path.resolve(process.cwd(), 'knowledge-source');
const manifestPath = path.join(knowledgeDirectory, 'manifest.json');
const requiredKnowledgeTypes = ['faq', 'terminology', 'functionKnowledge', 'api', 'pricing'];

function fail(message) {
  throw new Error(`knowledge-source/manifest.json: ${message}`);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`不是合法 JSON（${detail}）`);
}

if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  fail('顶层必须是 JSON 对象');
}
if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
  fail('缺少非空字符串 version');
}
if (typeof manifest.updatedAt !== 'string' || manifest.updatedAt.trim() === '') {
  fail('缺少非空字符串 updatedAt');
}
if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
  fail('files 必须是对象');
}

for (const knowledgeType of requiredKnowledgeTypes) {
  if (!(knowledgeType in manifest.files)) {
    fail(`缺少必需知识类型 files.${knowledgeType}`);
  }
}

const declaredFiles = [];
for (const [knowledgeType, fileName] of Object.entries(manifest.files)) {
  if (typeof fileName !== 'string' || fileName.trim() === '') {
    fail(`files.${knowledgeType} 必须映射到非空文件名`);
  }
  if (path.basename(fileName) !== fileName) {
    fail(`files.${knowledgeType} 必须直接指向正式目录中的文件，不能包含路径`);
  }
  if (path.extname(fileName).toLowerCase() !== '.xlsx') {
    fail(`files.${knowledgeType} 必须指向 .xlsx 文件：${fileName}`);
  }
  declaredFiles.push(fileName);
}

const duplicateFiles = declaredFiles.filter((fileName, index) => declaredFiles.indexOf(fileName) !== index);
if (duplicateFiles.length > 0) {
  fail(`存在重复文件映射：${[...new Set(duplicateFiles)].join('、')}`);
}

const directoryEntries = await readdir(knowledgeDirectory, { withFileTypes: true });
const actualExcelFiles = directoryEntries
  .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.xlsx')
  .map((entry) => entry.name);
const actualFileSet = new Set(directoryEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));

const missingFiles = declaredFiles.filter((fileName) => !actualFileSet.has(fileName));
if (missingFiles.length > 0) {
  fail(`声明的文件不存在：${missingFiles.join('、')}`);
}

const undeclaredExcelFiles = actualExcelFiles.filter((fileName) => !declaredFiles.includes(fileName));
if (undeclaredExcelFiles.length > 0) {
  fail(`正式目录中存在未声明的 Excel：${undeclaredExcelFiles.join('、')}`);
}

console.log(`知识 manifest 校验通过：${manifest.version}，${declaredFiles.length} 个正式 Excel。`);
