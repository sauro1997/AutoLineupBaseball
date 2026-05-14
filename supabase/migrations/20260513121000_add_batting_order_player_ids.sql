-- Persist batting order configured in the frontend.
-- Run manually in Supabase SQL editor.

alter table if exists public.rules_bb
  add column if not exists batting_order_player_ids jsonb not null default '[]'::jsonb;
