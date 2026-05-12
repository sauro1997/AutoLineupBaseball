-- Add a unique constraint on (team_id, name) to enable safe upsert without
-- re-creating rows on every save (which generated new auto-increment IDs and caused
-- duplicate players when a save failed mid-way).

create unique index if not exists uq_players_bb_team_name
  on public.players_bb (team_id, name);
