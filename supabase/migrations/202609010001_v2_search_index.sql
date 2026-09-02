-- Additive-only V2 search schema. Review and run on a test Supabase project first.
create extension if not exists vector;
create extension if not exists pg_trgm;
create schema if not exists v2_search;

create table if not exists v2_search.index_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  knowledge_version text not null,
  provider text not null,
  model text not null,
  dimensions integer not null check (dimensions = 1536),
  status text not null check (status in ('building', 'published', 'failed', 'retired')) default 'building',
  expected_chunks integer not null default 0,
  indexed_chunks integer not null default 0,
  failed_chunks integer not null default 0,
  error_summary text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists v2_one_published_version
  on v2_search.index_versions ((status)) where status = 'published';

create table if not exists v2_search.chunks (
  index_version_id uuid not null references v2_search.index_versions(id) on delete cascade,
  chunk_id text not null,
  knowledge_id text not null,
  ordinal integer not null,
  title text not null,
  embedding_text text not null,
  full_text text not null,
  embedding vector(1536) not null,
  products text[] not null,
  knowledge_type text not null,
  enabled boolean not null,
  knowledge_version text not null,
  api_type text check (api_type in ('http', 'local') or api_type is null),
  api_version text,
  source_language text not null,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  protected_fields jsonb not null default '[]'::jsonb,
  exact_terms text[] not null default '{}',
  search_document tsvector generated always as (to_tsvector('simple', coalesce(full_text, ''))) stored,
  created_at timestamptz not null default now(),
  primary key (index_version_id, chunk_id)
);

create index if not exists v2_chunks_embedding_hnsw on v2_search.chunks using hnsw (embedding vector_cosine_ops);
create index if not exists v2_chunks_full_text_gin on v2_search.chunks using gin (search_document);
create index if not exists v2_chunks_full_text_trgm on v2_search.chunks using gin (full_text gin_trgm_ops);
create index if not exists v2_chunks_title_trgm on v2_search.chunks using gin (title gin_trgm_ops);
create index if not exists v2_chunks_filters on v2_search.chunks (index_version_id, enabled, knowledge_type, api_type);
create index if not exists v2_chunks_products_gin on v2_search.chunks using gin (products);
create index if not exists v2_chunks_exact_terms_gin on v2_search.chunks using gin (exact_terms);
create index if not exists v2_chunks_hash on v2_search.chunks (content_hash);

create or replace function v2_search.publish_index(target_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_id uuid; expected integer; actual integer; failures integer;
begin
  select id, expected_chunks, indexed_chunks, failed_chunks into target_id, expected, actual, failures
  from v2_search.index_versions where version = target_version and status = 'building' for update;
  if target_id is null then raise exception 'building index version not found'; end if;
  if failures > 0 or actual <> expected then raise exception 'index is incomplete'; end if;
  update v2_search.index_versions set status = 'retired' where status = 'published';
  update v2_search.index_versions set status = 'published', published_at = now() where id = target_id;
end $$;

create or replace function v2_search.search_chunks(
  query_embedding vector(1536), query_text text, match_count integer default 10,
  product_filter text default null, api_type_filter text default null
) returns table (chunk_id text, knowledge_id text, title text, metadata jsonb, semantic_score double precision, text_rank real)
language sql stable security invoker set search_path = public, extensions, pg_catalog as $$
  select c.chunk_id, c.knowledge_id, c.title, c.metadata,
    1 - (c.embedding <=> query_embedding) as semantic_score,
    ts_rank_cd(c.search_document, plainto_tsquery('simple', query_text)) as text_rank
  from v2_search.chunks c join v2_search.index_versions v on v.id = c.index_version_id
  where v.status = 'published' and c.enabled
    and (product_filter is null or product_filter = any(c.products))
    and (api_type_filter is null or c.api_type = api_type_filter)
  order by ((1 - (c.embedding <=> query_embedding)) * 0.75 + ts_rank_cd(c.search_document, plainto_tsquery('simple', query_text)) * 0.25) desc
  limit greatest(1, least(match_count, 100));
$$;

create or replace function v2_search.search_exact_chunks(
  exact_value text, match_count integer default 20, product_filter text default null, api_type_filter text default null
) returns table (chunk_id text, knowledge_id text, title text, metadata jsonb)
language sql stable security invoker set search_path = '' as $$
  select c.chunk_id, c.knowledge_id, c.title, c.metadata
  from v2_search.chunks c join v2_search.index_versions v on v.id = c.index_version_id
  where v.status = 'published' and c.enabled and exact_value = any(c.exact_terms)
    and (product_filter is null or product_filter = any(c.products))
    and (api_type_filter is null or c.api_type = api_type_filter)
  limit greatest(1, least(match_count, 100));
$$;

revoke all on schema v2_search from public, anon, authenticated;
revoke all on all tables in schema v2_search from public, anon, authenticated;
revoke all on all functions in schema v2_search from public, anon, authenticated;
