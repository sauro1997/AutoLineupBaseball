create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_username text not null,
  name text not null,
  logo_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  positions jsonb not null,
  flexibility_level text not null check (flexibility_level in ('starter', 'regular', 'bench', 'utility')),
  locked_position text check (locked_position in ('P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF')),
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  innings_count integer not null default 6 check (innings_count between 1 and 12),
  pitcher_id uuid not null references public.players (id),
  rules jsonb not null default '{}'::jsonb,
  share_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.rules (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  rule_type text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lineups (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  inning integer not null check (inning > 0),
  position text not null check (position in ('P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF')),
  player_id uuid not null references public.players (id),
  score integer not null,
  created_at timestamptz not null default now(),
  unique (game_id, inning, position)
);


