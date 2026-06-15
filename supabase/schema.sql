create extension if not exists pgcrypto;

create table if not exists kb_entries (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists content_briefs (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('organic', 'ads')),
  format text not null check (format in ('reel', 'carousel', 'single', 'story')),
  pillar text,
  funnel_stage text check (funnel_stage in ('TOFU', 'MOFU', 'BOFU')),
  awareness_stage text,
  topic text not null,
  hook_primary text,
  hook_alt1 text,
  hook_alt2 text,
  structure_beats jsonb not null default '{}'::jsonb,
  style_hint text,
  cta_type text,
  target_signal text,
  language text,
  compliance_notes text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid references content_briefs(id) on delete set null,
  channel text not null,
  format text not null,
  caption text,
  media_urls text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  compliance_status text not null default 'pending',
  review_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publish_queue (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references assets(id) on delete set null,
  channel text not null check (channel in ('facebook', 'instagram')),
  format text not null check (format in ('carousel', 'single', 'reel', 'story')),
  caption text not null,
  media_urls text[] not null default '{}',
  planned_slot timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  compliance_status text not null default 'pending' check (compliance_status in ('pending', 'clear', 'flagged')),
  external_post_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists raw_metrics (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('facebook', 'instagram', 'ads', 'manual')),
  external_post_id text not null,
  captured_at timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  ref_type text not null,
  ref_id text not null,
  action text not null check (action in ('approve', 'edit', 'regen', 'reject')),
  before_text text,
  after_text text,
  reason text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists outcomes (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid references content_briefs(id) on delete set null,
  asset_id uuid references assets(id) on delete set null,
  post_id text,
  pillar text,
  funnel_stage text,
  hook_archetype text,
  style_key text,
  format text,
  channel text,
  audience_label text,
  published_at timestamptz,
  metric_window text check (metric_window in ('7d', '28d', '90d')),
  score numeric,
  watch_metric numeric,
  shares int,
  saves int,
  cpl numeric,
  vs_plan_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists learning_weights (
  id uuid primary key default gen_random_uuid(),
  dimension text not null,
  key text not null,
  value numeric not null default 1,
  previous_value numeric,
  reason text,
  source text not null default 'manual',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_kb_entries_category on kb_entries(category);
create index if not exists idx_publish_queue_status on publish_queue(status);
create index if not exists idx_raw_metrics_external_post_id on raw_metrics(external_post_id);
create index if not exists idx_feedback_ref on feedback(ref_type, ref_id);
create index if not exists idx_outcomes_brief_id on outcomes(brief_id);
create index if not exists idx_learning_weights_dimension_key on learning_weights(dimension, key);
create index if not exists idx_learning_weights_active on learning_weights(is_active);

insert into kb_entries (category, title, body, tags)
values
  ('brand', 'DREC brand colors', 'Navy #0F2A4A, teal #1FA9A0, orange #F58220. Use orange for CTA moments only.', array['brandkit', 'design']),
  ('compliance', 'Health-content baseline', 'No guaranteed outcomes, no personal attributes, no unconsented patient stories, and no unsafe before/after claims.', array['meta', 'health']),
  ('voice', 'Editorial posture', 'Clear, educational, evidence-led Mandarin-first content for Chinese-speaking adults around 50 who care about metabolic health.', array['copy', 'audience'])
on conflict do nothing;
