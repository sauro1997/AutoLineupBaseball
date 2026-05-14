alter table if exists public.players_bb
  add column if not exists no_bench_last_inning boolean not null default false;
