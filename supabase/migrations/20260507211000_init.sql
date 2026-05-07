create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
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

create or replace function public.is_team_owner(target_team_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.teams teams
    where teams.id = target_team_id
      and teams.owner_id = auth.uid()
  );
$$;

alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;
alter table public.rules enable row level security;
alter table public.lineups enable row level security;

create policy "team owners manage their teams"
  on public.teams
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "team owners manage players"
  on public.players
  using (public.is_team_owner(team_id))
  with check (public.is_team_owner(team_id));

create policy "team owners manage games"
  on public.games
  using (public.is_team_owner(team_id))
  with check (public.is_team_owner(team_id));

create policy "team owners manage rules"
  on public.rules
  using (public.is_team_owner(team_id))
  with check (public.is_team_owner(team_id));

create policy "team owners manage lineups"
  on public.lineups
  using (
    exists (
      select 1
      from public.games games
      where games.id = game_id
        and public.is_team_owner(games.team_id)
    )
  )
  with check (
    exists (
      select 1
      from public.games games
      where games.id = game_id
        and public.is_team_owner(games.team_id)
    )
  );
