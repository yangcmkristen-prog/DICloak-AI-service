const integer = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function getSearchConfig(environment = process.env) {
  const schema = environment.V2_SEARCH_SCHEMA ?? 'v2_search';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('V2_SEARCH_SCHEMA 只能包含小写字母、数字和下划线');
  return {
    environment: environment.V2_SEARCH_ENVIRONMENT ?? '',
    allowMigration: environment.V2_SEARCH_ALLOW_MIGRATION === 'true',
    schema,
    provider: environment.V2_EMBEDDING_PROVIDER ?? '',
    model: environment.V2_EMBEDDING_MODEL ?? '',
    dimensions: integer(environment.V2_EMBEDDING_DIMENSIONS, 1536),
    baseUrl: environment.V2_EMBEDDING_BASE_URL ?? '',
    hasEmbeddingKey: Boolean(environment.V2_EMBEDDING_API_KEY),
    hasSupabase: Boolean(environment.SUPABASE_URL && (environment.SUPABASE_SERVICE_ROLE_KEY || environment.SUPABASE_ANON_KEY)),
    hasDatabaseUrl: Boolean(environment.SUPABASE_DB_URL),
    rejectUnauthorized: environment.SUPABASE_DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

export function mayRunMigration(config) {
  return config.hasSupabase && config.hasDatabaseUrl && config.environment === 'test' && config.allowMigration;
}
