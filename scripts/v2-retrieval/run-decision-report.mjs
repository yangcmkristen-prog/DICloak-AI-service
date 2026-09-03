import fs from 'node:fs/promises';
import path from 'node:path';
import { retrieveV2 } from '../../src/lib/server/v2/retrieval/service.ts';

const scenarios = [
  ['CORE-BROAD', '环境打不开'],
  ['CORE-LOGIN', '无法登录'],
  ['CORE-HTTP', 'HTTP API 打开环境的 Endpoint 是什么？'],
  ['CORE-RISK', '帮我删除它'],
  ['BROAD-01', '点击打开环境没有反应'],
  ['BROAD-02', '浏览器环境启动失败'],
  ['BROAD-03', '页面加载失败'],
  ['BROAD-04', '代理连接不上'],
  ['BROAD-05', '代理检测失败怎么办'],
  ['BROAD-06', '扩展异常'],
  ['BROAD-07', '扩展无法使用'],
  ['BROAD-08', '内核下载失败'],
  ['BROAD-09', '打开环境提示本地网络错误'],
  ['BROAD-10', '环境文件损坏了怎么办'],
  ['BROAD-11', '缓存异常导致环境打不开'],
  ['BROAD-12', '环境打开后网站访问不了'],
  ['BROAD-13', '软件提示权限不足'],
  ['BROAD-14', '磁盘空间不足会影响环境启动吗'],
  ['BROAD-15', '环境一直加载中'],
  ['BROAD-16', '账号不能用'],
  ['BROAD-17', '第三方平台登录失败'],
  ['BROAD-18', 'DICloak 登录失败'],
  ['BROAD-19', 'profile cannot open'],
  ['BROAD-20', 'extension not working'],
];

const results = [];
for (const [id, question] of scenarios) {
  const trace = await retrieveV2(question);
  const legacyWouldClarifyOnly = trace.questionMode === 'broad_troubleshooting' || trace.intent.missingConditions.includes('symptomDetails') || trace.evidenceConfidence === 'none';
  results.push({
    id, question,
    before: { responseStrategy: legacyWouldClarifyOnly ? 'clarify_only' : 'direct', selectedKnowledgeIds: legacyWouldClarifyOnly ? [] : trace.debugCandidates.slice(0, 5).map((item) => item.knowledgeId) },
    after: { questionMode: trace.questionMode, evidenceConfidence: trace.evidenceConfidence, responseStrategy: trace.responseStrategy, selectedKnowledgeIds: trace.selectedKnowledge.map((item) => item.knowledgeId), knowledgeGroups: trace.knowledgeGroups, branches: trace.branches, missingCriticalInformation: trace.missingCriticalInformation, optionalFollowUpFields: trace.optionalFollowUpFields, decisionReasons: trace.decisionReasons },
    degradedRoutes: trace.degradedRoutes, timings: trace.timings,
  });
}

const summary = {
  cases: results.length,
  broadCases: results.filter((row) => row.id.startsWith('BROAD-')).length,
  beforeClarifyOnly: results.filter((row) => row.before.responseStrategy === 'clarify_only').length,
  afterClarifyOnly: results.filter((row) => row.after.responseStrategy === 'clarify_only').length,
  answerFirst: results.filter((row) => ['direct', 'aggregated', 'conditional', 'answer_then_clarify', 'unsupported'].includes(row.after.responseStrategy)).length,
  executionFailures: results.filter((row) => row.degradedRoutes.length).length,
};
const report = { generatedAt: new Date().toISOString(), mode: 'real-response-decision', summary, results };
const output = path.resolve('reports', 'evaluation'); await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'v2-decision-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const rows = results.map((row) => `<tr><td>${esc(row.id)}</td><td>${esc(row.question)}</td><td>${esc(row.before.responseStrategy)}</td><td>${esc(row.after.questionMode)}</td><td>${esc(row.after.evidenceConfidence)}</td><td>${esc(row.after.responseStrategy)}</td><td>${esc(row.after.selectedKnowledgeIds.join('; '))}</td><td>${esc(row.after.knowledgeGroups.map((group) => group.label).join('; '))}</td><td>${esc(row.after.branches.map((branch) => branch.label).join('; '))}</td></tr>`).join('');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>V2 回复策略决策报告</title><style>body{font:14px system-ui;margin:30px;color:#17333c}table{border-collapse:collapse;width:100%}th,td{padding:8px;border:1px solid #ddd;text-align:left;vertical-align:top}th{background:#e5f4f7}</style><h1>V2 回复策略修改前后对比</h1><pre>${esc(JSON.stringify(summary, null, 2))}</pre><table><tr><th>ID</th><th>问题</th><th>修改前</th><th>问题模式</th><th>证据</th><th>修改后策略</th><th>selectedKnowledge</th><th>知识组</th><th>条件分支</th></tr>${rows}</table></html>`;
await fs.writeFile(path.join(output, 'v2-decision-latest.html'), html);
const examples = path.resolve('evaluation-source', 'examples'); await fs.mkdir(examples, { recursive: true });
await fs.writeFile(path.join(examples, 'v2-decision-sample.json'), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(path.join(examples, 'v2-decision-sample.html'), html);
console.log(JSON.stringify(summary, null, 2));
