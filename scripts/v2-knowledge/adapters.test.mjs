import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptApi, adaptFaqWorkbook, adaptFunctions, adaptPricing } from './adapters.mjs';
import { chunkKnowledge, validateChunks } from './chunker.mjs';

function workbook(sheets) {
  return {
    sheetNames: Object.keys(sheets),
    rows(sheet) { return (sheets[sheet] ?? []).map((values, index) => ({ values, row: index + 2 })); },
  };
}

test('FAQ 保留双语问题、用户问法、原始占位符、termIds、Function ID 与来源', () => {
  const warnings = [];
  const records = adaptFaqWorkbook({
    workbook: workbook({
      feature_faq: [{ FAQ_ID: 'FAQ-1', '标准问题（中文）': '如何设置？', '标准问题（英文）': 'How?', '用户问法': 'How do I set it?;Where?', '标准答案': 'Go to {{Profiles}}. https://example.test/a', term_id: 'TERM-1、TERM-2', function_id: 'FUNC-1', 标签: 'setup,profile' }],
      troubleshooting: [], user_routing: [], out_of_scope: [], troubleshooting_flow: [],
    }), file: 'FAQ库.xlsx', version: '1', warnings,
  });
  assert.equal(warnings.length, 0);
  assert.equal(records[0].id, 'FAQ-1');
  assert.deepEqual(records[0].termIds, ['TERM-1', 'TERM-2']);
  assert.deepEqual(records[0].metadata.functionIds, ['FUNC-1']);
  assert.ok(records[0].canonicalQuestions.some((item) => item.language === 'zh'));
  assert.ok(records[0].protectedFields.some((item) => item.kind === 'placeholder' && item.value === '{{Profiles}}'));
  assert.equal(records[0].source.row, 2);
});

test('Out of Scope 默认同时支持 DICloak 和 ParaTurbo', () => {
  const records = adaptFaqWorkbook({ workbook: workbook({ feature_faq: [], troubleshooting: [], user_routing: [], out_of_scope: [{ FAQ_ID: 'OOS-X', '标准答案（英文）': 'Unsupported' }], troubleshooting_flow: [] }), file: 'FAQ.xlsx', version: '1', warnings: [] });
  assert.deepEqual(records[0].productScope, ['dicloak', 'paraturbo']);
});

test('排障流程把同一节点的多条匹配分支聚合为一个稳定知识 ID', () => {
  const warnings = [];
  const records = adaptFaqWorkbook({
    workbook: workbook({
      feature_faq: [], troubleshooting: [], user_routing: [], out_of_scope: [],
      troubleshooting_flow: [
        { FLOW_ID: 'FLOW-1', NODE_ID: 'start', NODE_NAME: '入口', MATCH_VALUE: 'client', MATCH_KEYWORDS: '管理员', NEXT_NODE_ID: 'client_solution', QUESTION: '你的身份是？' },
        { FLOW_ID: 'FLOW-1', NODE_ID: 'start', NODE_NAME: '入口', MATCH_VALUE: 'member', MATCH_KEYWORDS: '成员', NEXT_NODE_ID: 'member_solution', QUESTION: '你的身份是？' },
      ],
    }), file: 'FAQ库.xlsx', version: '1', warnings,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'FLOW-1:start');
  assert.equal(records[0].metadata.branches.length, 2);
  assert.match(records[0].body, /client_solution/);
  assert.match(records[0].body, /member_solution/);
});

test('功能知识补齐并保留三段 termIds 解析链，步骤按完整语义边界分块', () => {
  const warnings = [];
  const [record] = adaptFunctions({
    workbook: workbook({ 功能知识库: [{ function_id: 'FUNC-1', 一级模块: '环境', 页面名称: '编辑环境', 功能点名称: '代理设置', 功能说明: '设置代理', 入口路径: '环境 > 编辑', 界面位置: '代理设置', 前置条件: '已有环境', 操作步骤: '1. 打开编辑\n2. 保存', 已支持产品: 'dicloak', 一级模块术语ID: 'TERM-1', 页面名称术语ID: 'TERM-2', 功能点术语ID: 'TERM-3,TERM-4', 常见问题FAQ_ID: 'FAQ-1,FAQ-2' }] }),
    file: '功能知识库.xlsx', version: '1', warnings,
  });
  assert.deepEqual(record.termIds, ['TERM-1', 'TERM-2', 'TERM-3', 'TERM-4']);
  assert.deepEqual(record.metadata.faqIds, ['FAQ-1', 'FAQ-2']);
  const chunks = chunkKnowledge([record]);
  assert.equal(chunks.length, 2);
  assert.match(chunks[1].text, /1\. 打开编辑\n2\. 保存/);
  assert.deepEqual(validateChunks([record], chunks), []);
});

test('API 严格分离 HTTP/Local、版本、Method、Endpoint 与参数受保护字段', () => {
  const warnings = [];
  const records = adaptApi({
    workbook: workbook({
      'API 端点总表': [
        { api_id: 'API-H', API类型: 'HTTP API', 接口模块: '成员', 功能: '创建', 请求方法: 'POST', 端点路径: '/v1/member', 完整路径规则: 'https://api.example.test/v1/member', 成功响应核心字段: 'data.id', 已支持产品: 'dicloak' },
        { api_id: 'API-L', API类型: 'Local API V2', 接口模块: '环境', 功能: '查询', 请求方法: 'GET', 端点路径: '/v2/profiles', 完整路径规则: '{本地接口URL}/openapi/v2/profiles', 成功响应核心字段: 'data.list', 已支持产品: 'all' },
      ],
      'API 参数明细表': [
        { api_id: 'API-H', API类型: 'HTTP API', 请求方法: 'POST', 端点路径: '/v1/member', 参数位置: 'Body', 参数名: 'member_id', 数据类型: 'string', 是否必填: '是', 说明: '成员 ID；失败时返回 410018' },
        { api_id: 'API-L', API类型: 'Local API V2', 请求方法: 'GET', 端点路径: '/v2/profiles', 参数位置: 'Response', 参数名: 'data.list', 数据类型: 'array', 是否必填: '否', 说明: '列表' },
      ],
    }), file: 'API.xlsx', version: '1', warnings,
  });
  assert.deepEqual(records.map((record) => record.type), ['http_api', 'local_api']);
  assert.equal(records[1].metadata.version, 'v2');
  assert.ok(records[0].protectedFields.some((item) => item.kind === 'method' && item.value === 'POST'));
  assert.ok(records[0].protectedFields.some((item) => item.kind === 'endpoint' && item.value === '/v1/member'));
  assert.ok(records[0].protectedFields.some((item) => item.kind === 'json_key' && item.value === 'member_id'));
  assert.ok(records[0].protectedFields.some((item) => item.kind === 'error_code' && item.value === '410018'));
  const chunks = chunkKnowledge(records);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].type, 'http_api');
  assert.equal(chunks[1].type, 'local_api');
});

test('分块保持各自产品范围，不合并不同产品知识', () => {
  const warnings = [];
  const records = adaptFunctions({
    workbook: workbook({ 功能知识库: [
      { function_id: 'FUNC-D', 功能点名称: 'DICloak 功能', 已支持产品: 'dicloak' },
      { function_id: 'FUNC-P', 功能点名称: 'Paraturbo 功能', 已支持产品: 'paraturbo' },
    ] }), file: '功能知识库.xlsx', version: '1', warnings,
  });
  const chunks = chunkKnowledge(records);
  assert.deepEqual(chunks.find((chunk) => chunk.knowledgeId === 'FUNC-D').productScope, ['dicloak']);
  assert.deepEqual(chunks.find((chunk) => chunk.knowledgeId === 'FUNC-P').productScope, ['paraturbo']);
  assert.deepEqual(validateChunks(records, chunks), []);
});

test('套餐按套餐和功能项生成结构化记录，不复制整张横向表', () => {
  const warnings = [];
  const records = adaptPricing({
    workbook: workbook({ Sheet1: [{ Features: 'included profiles', 'Free/免费版': 5, 'Base/基础版': 20, 'Plus/高阶版': 100, 'Share+/共享版+': 200 }] }),
    file: '套餐.xlsx', version: '1', warnings,
  });
  assert.equal(records.length, 4);
  assert.equal(records[0].metadata.feature, 'included profiles');
  assert.equal(records[0].metadata.value, 5);
  assert.ok(records.every((record) => record.productScope.join(',') === 'dicloak,paraturbo'));
  assert.ok(records.every((record) => record.body.includes('功能项：included profiles')));
});

test('内容哈希可重复且正文变化后改变，分块继承来源和产品范围', () => {
  const warnings = [];
  const make = (answer) => adaptFaqWorkbook({
    workbook: workbook({ feature_faq: [{ FAQ_ID: 'FAQ-HASH', 标准答案: answer, 已支持产品: 'dicloak' }], troubleshooting: [], user_routing: [], out_of_scope: [], troubleshooting_flow: [] }),
    file: 'FAQ.xlsx', version: '1', warnings,
  })[0];
  const first = make('Answer {{Profiles}}');
  const same = make('Answer {{Profiles}}');
  const changed = make('Changed {{Profiles}}');
  assert.equal(first.contentHash, same.contentHash);
  assert.notEqual(first.contentHash, changed.contentHash);
  const [chunk] = chunkKnowledge([first]);
  assert.deepEqual(chunk.productScope, ['dicloak']);
  assert.deepEqual(chunk.source, { file: 'FAQ.xlsx', sheet: 'feature_faq', row: 2 });
  assert.ok(chunk.text.includes('{{Profiles}}'));
});
