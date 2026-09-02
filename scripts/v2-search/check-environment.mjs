import { getSearchConfig, mayRunMigration } from './config.mjs';
const config = getSearchConfig();
const status = (condition, missing = '缺少配置') => condition ? '可用' : missing;
console.log(JSON.stringify({
  supabase配置: status(config.hasSupabase && config.hasDatabaseUrl),
  测试环境: config.environment === 'test' ? '可用' : config.environment ? '需要人工确认' : '缺少配置',
  embedding配置: status(Boolean(config.provider && config.model && config.hasEmbeddingKey)),
  创建测试表: mayRunMigration(config) ? '可用' : config.hasSupabase ? '需要人工确认' : '缺少配置',
}, null, 2));
