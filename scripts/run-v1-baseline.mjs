import fs from 'node:fs/promises';
import path from 'node:path';
import { root, writeReport } from './evaluation/evaluation-utils.mjs';

const baseUrl = process.env.EVALUATION_BASE_URL || 'http://127.0.0.1:3000';
const syntheticCases = [
  { caseId: 'V1-SMOKE-ZH-001', question: '软件无法启动，但暂时没有报错信息，我接下来需要提供什么？', product: 'dicloak', language: 'zh' },
  { caseId: 'V1-SMOKE-EN-001', question: 'Where can I find the API endpoint documentation?', product: 'dicloak', language: 'en' },
  { caseId: 'V1-SMOKE-ES-001', question: '¿Qué información debo proporcionar si el navegador no se abre?', product: 'paraturbo', language: 'es' },
];

async function getJson(route) {
  const response = await fetch(`${baseUrl}${route}`);
  if (!response.ok) throw new Error(`${route} 返回 ${response.status}`);
  return response.json();
}

const [knowledgeResponse, systemResponse] = await Promise.all([getJson('/api/config/knowledge'), getJson('/api/config/system')]);
const config = systemResponse?.data?.apiConfig;
if (!knowledgeResponse?.data || knowledgeResponse.isEmpty) throw new Error('Supabase 知识不可用，跳过 V1 基线');
if (!config || typeof config.apiKey !== 'string' || !config.apiKey.trim() || typeof config.model !== 'string' || !config.model.trim()) throw new Error('V1 主模型配置不完整，跳过 V1 基线');

const results = [];
for (const item of syntheticCases) {
  const startedAt = performance.now();
  let firstTokenMs = null;
  let answer = '';
  let requestId = null;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: item.question,
      history: [],
      knowledge: knowledgeResponse.data,
      systemPrompt: systemResponse?.data?.systemPrompt || '',
      detectedLanguage: item.language,
      product: item.product,
    }),
  });
  if (!response.ok || !response.body) throw new Error(`V1 案例 ${item.caseId} 请求失败：${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (!requestId && typeof event.requestId === 'string') requestId = event.requestId;
      if (event.type === 'delta' && typeof event.content === 'string') {
        if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - startedAt);
        answer += event.content;
      }
      if (event.type === 'final' && typeof event.content === 'string') answer = event.content;
    }
  }
  results.push({
    ...item,
    answer,
    firstTokenMs,
    totalMs: Math.round(performance.now() - startedAt),
    requestId,
    modelCalls: null,
    tokenUsage: null,
    telemetryNote: '当前 V1 响应协议未向调用方暴露模型调用次数和 token；未修改 V1，因此记录为 null。',
  });
}

const telemetryLog = process.env.EVALUATION_TELEMETRY_LOG;
if (telemetryLog) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const log = await fs.readFile(path.resolve(telemetryLog), 'utf8');
  const events = log.split(/\r?\n/).flatMap((line) => {
    const start = line.indexOf('{"event":"model_call"');
    if (start < 0) return [];
    try { return [JSON.parse(line.slice(start))]; } catch { return []; }
  });
  for (const result of results) {
    const calls = events.filter((event) => event.requestId === result.requestId);
    result.modelCalls = calls.length;
    result.tokenUsage = {
      inputTokens: calls.reduce((sum, call) => sum + (Number(call.inputTokens) || 0), 0),
      outputTokens: calls.reduce((sum, call) => sum + (Number(call.outputTokens) || 0), 0),
      totalTokens: calls.reduce((sum, call) => sum + (Number(call.inputTokens) || 0) + (Number(call.outputTokens) || 0), 0),
    };
    result.telemetryNote = calls.length ? '来自现有 V1 服务端 request telemetry 日志。' : '未在日志中找到对应 requestId 的模型调用事件。';
  }
}

const data = { generatedAt: new Date().toISOString(), privacy: '仅使用仓库内定义的脱敏合成问题；报告默认不提交 Git。', summary: { executed: results.length, failed: 0 }, results };
const rows = results.map((result) => ({ 案例ID: result.caseId, 产品: result.product, 语言: result.language, 首字毫秒: result.firstTokenMs, 总毫秒: result.totalMs, 模型调用次数: result.modelCalls ?? '未获取', Token: result.tokenUsage?.totalTokens ?? '未获取', 回答: result.answer }));
await writeReport(path.join(root, 'reports', 'evaluation'), 'v1-baseline', data, rows, 'V1 小规模真实基线');
console.log(`V1 真实基线完成：${results.length} 个脱敏案例。`);
