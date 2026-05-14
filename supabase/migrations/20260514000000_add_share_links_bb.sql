-- Share links table for short URL sharing of lineups
create table if not exists public.share_links_bb (
  id text primary key,
  team_id int not null references public.teams_bb (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  view_count int not null default 0
);

create index if not exists idx_share_links_bb_team_id on public.share_links_bb (team_id);
create index if not exists idx_share_links_bb_created_at on public.share_links_bb (created_at desc);
create index if not exists idx_share_links_bb_expires_at on public.share_links_bb (expires_at);
