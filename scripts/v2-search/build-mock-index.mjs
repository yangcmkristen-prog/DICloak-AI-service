import fs from 'node:fs/promises';
import path from 'node:path';
import { MemoryVersionedIndex, syncIndex } from './indexer.mjs';
import { MockEmbeddingProvider } from './providers.mjs';

const root = process.cwd();
const started = performance.now();
const knowledge = JSON.parse(await fs.readFile(path.join(root, 'reports/v2-knowledge/knowledge-latest.json'), 'utf8'));
const chunks = JSON.parse(await fs.readFile(path.join(root, 'reports/v2-knowledge/chunks-latest.json'), 'utf8'));
const provider = new MockEmbeddingProvider();
const index = new MemoryVersionedIndex();
const version = `mock-${knowledge.manifestVersion}`;
const stats = await syncIndex({ index, version, records: knowledge.records, chunks: chunks.chunks, provider });
index.publish(version);
const endpointProbe = chunks.chunks.flatMap((chunk) => chunk.protectedFields).find((field) => field.kind === 'endpoint')?.value ?? '';
const methodProbe = chunks.chunks.flatMap((chunk) => chunk.protectedFields).find((field) => field.kind === 'method')?.value ?? '';
const probes = [
  ['zh', '如何创建浏览器配置文件'], ['en', 'How do I create a browser profile?'],
  ['pt', 'Como criar um perfil de navegador?'], ['ru', 'Как создать профиль браузера?'],
  ['exact-endpoint', endpointProbe], ['exact-method', methodProbe],
].map(([language, query]) => ({ language, query, matches: index.searchExact(query).slice(0, 5).map((entry) => entry.chunk.chunkId) }));
const report = { generatedAt: new Date().toISOString(), mode: 'mock', realIndexExecuted: false, reason: '缺少已确认的测试 Supabase 与真实 embedding 配置', version, provider: provider.name, model: provider.model, dimensions: provider.dimensions, stats: { ...stats, failed: 0, milliseconds: Math.round(performance.now() - started), providerCalls: provider.calls }, probes };
const output = path.join(root, 'reports/v2-index');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'mock-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>V2 Mock 索引报告</title><style>body{font:14px system-ui;margin:32px;color:#17333c}table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;background:#f4f7f8;padding:12px}</style><h1>V2 Mock 索引报告</h1><p><b>注意：</b>这是确定性 Mock 验证，不代表真实跨语言检索准确率；真实索引未执行。</p><pre>${JSON.stringify(report.stats, null, 2)}</pre><table><tr><th>语言</th><th>查询</th><th>精确匹配</th></tr>${probes.map((probe) => `<tr><td>${probe.language}</td><td>${probe.query}</td><td>${probe.matches.join('<br>') || '无（Mock 不评估跨语言语义）'}</td></tr>`).join('')}</table></html>`;
await fs.writeFile(path.join(output, 'mock-latest.html'), html);
console.log(`V2 Mock 索引完成：${stats.total} 个块，新增 embedding ${stats.embedded}，复用 ${stats.reused}，失败 0。`);
