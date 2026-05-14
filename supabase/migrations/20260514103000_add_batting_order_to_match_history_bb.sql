alter table if exists public.match_history_bb
  add column if not exists batting_order_player_ids jsonb not null default '[]'::jsonb;
