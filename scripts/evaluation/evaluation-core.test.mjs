import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAnswer } from './evaluation-core.mjs';

const base = { product: 'dicloak', knowledgeType: 'HTTP API', knowledgeIds: ['FAQ-SECRET'], mustInclude: ['POST'], mustNotInclude: ['Local API'], preserveExact: ['/api/v1/test', 'env_id'], shouldAsk: false };

test('固定规则接受完整且未改写的答案', () => {
  assert.equal(evaluateAnswer(base, '使用 POST /api/v1/test，并传入 env_id。').pass, true);
});

test('固定规则识别 URL/Endpoint、参数和内部 ID 问题', () => {
  const result = evaluateAnswer(base, '根据知识库 FAQ-SECRET，使用 POST /api/v2/test。');
  assert.equal(result.pass, false);
  assert.ok(result.checks.some((check) => !check.pass && check.name.includes('保持原样')));
  assert.ok(result.checks.some((check) => !check.pass && check.name === '内部知识 ID 不泄漏'));
});

test('追问检测同时识别中文和英文问号', () => {
  const askCase = { ...base, knowledgeType: '无知识', knowledgeIds: [], mustInclude: [], mustNotInclude: [], preserveExact: [], shouldAsk: true };
  assert.equal(evaluateAnswer(askCase, '请说明你需要访问的是哪个链接，以及该链接的具体用途？').pass, true);
  assert.equal(evaluateAnswer(askCase, 'Which link do you need?').pass, true);
});
