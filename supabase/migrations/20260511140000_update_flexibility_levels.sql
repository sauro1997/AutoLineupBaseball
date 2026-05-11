-- Update flexibility_level constraint to only 'starter' and 'absent'.

-- Convert all existing non-absent values to 'starter'
update public.players_bb
set flexibility_level = 'starter'
where flexibility_level in ('regular', 'bench', 'utility', 'Starter');

update public.players_bb
set flexibility_level = 'absent'
where flexibility_level = 'Absent';

-- Drop old constraint
alter table if exists public.players_bb
  drop constraint if exists players_bb_flexibility_level_check;

-- Add new constraint with only 'starter' and 'absent'
alter table if exists public.players_bb
  add constraint players_bb_flexibility_level_check
  check (flexibility_level in ('starter', 'absent'));
