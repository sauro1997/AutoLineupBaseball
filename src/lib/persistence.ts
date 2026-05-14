import type { FlexibilityLevel, MatchHistoryEntry, MatchRules, PersistedAppState, Player, Position, Team } from '../domain'
import { demoRules, demoTeam } from '../data/demo'
import { supabase } from './supabaseClient'

export type SessionUser = {
  id: number
  email: string
}

export type ShareViewInning = {
  inning: number
  score: number
  notes: string[]
  bench: string[]
  assignments: Record<Position, string>
}

export type ShareViewPayload = {
  version: 1
  teamName: string
  matchLabel: string
  matchDate: string
  battingOrder: string[]
  innings: ShareViewInning[]
}

type TeamRow = {
  id: number
  name: string
  logo_url: string | null
  created_at?: string
}

type PlayerRow = {
  id: number
  team_id: number
  name: string
  positions: Player['positions']
  flexibility_level: Player['flexibilityLevel']
  excluded_positions: Player['excludedPositions'] | null
  locked_position: Player['lockedPosition'] | null
  locked_can_bench: boolean
  no_bench_last_inning?: boolean | null
}

type RulesRow = {
  team_id: number
  innings_count: number
  pitcher_id: number | null
  max_pitcher_innings: number
  pitcher_changes: MatchRules['pitcherChanges'] | null
  fixed_center_field: boolean
  fixed_center_field_player_id: number | null
  fixed_assignments: MatchRules['fixedAssignments'] | null
  prioritize_catcher: boolean
  max_consecutive_bench: number
  manual_overrides: PersistedAppState['manualOverrides'] | null
  locked_overrides: PersistedAppState['lockedOverrides'] | null
  selected_history_match_id: string | null
  history_context_window: number | null
  batting_order_player_ids: number[] | null
}

type MatchHistoryRow = {
  client_match_id: string | null
  label: string
  lineup_json: MatchHistoryEntry['lineup']
  bench_totals: MatchHistoryEntry['benchTotals'] | null
  created_at: string
}

type PlayerIdMap = Map<number, number>

type TeamSelectionCandidate = TeamRow & {
  player_count: number
}

function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase non configure: ajoute VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.')
  }

  return supabase
}

function normalizeManualOverrides(
  manualOverrides: PersistedAppState['manualOverrides'] | null | undefined,
): PersistedAppState['manualOverrides'] {
  if (!manualOverrides || typeof manualOverrides !== 'object') return {}

  return Object.fromEntries(
    Object.entries(manualOverrides).flatMap(([key, value]) =>
      typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [],
    ),
  ) as PersistedAppState['manualOverrides']
}

function normalizeLockedOverrides(lockedOverrides: unknown): string[] {
  if (!Array.isArray(lockedOverrides)) return []
  return lockedOverrides.filter((value): value is string => typeof value === 'string')
}

function normalizeBattingOrderPlayerIds(battingOrderPlayerIds: unknown): number[] {
  if (!Array.isArray(battingOrderPlayerIds)) return []

  return battingOrderPlayerIds.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
}

async function getOrCreateTeam(userId: number, team: Team): Promise<TeamRow> {
  const db = getSupabase()

  const { data: existingTeams, error: existingTeamsError } = await db
    .from('teams_bb')
    .select('id,name,logo_url,created_at')
    .eq('user_id', userId)
    .order('id', { ascending: false })

  if (existingTeamsError) throw existingTeamsError

  let existingTeam: TeamRow | null = null

  if ((existingTeams ?? []).length > 0) {
    const teamIds = (existingTeams ?? []).map((candidate) => candidate.id)
    const { data: playerRows, error: playerRowsError } = await db
      .from('players_bb')
      .select('team_id')
      .in('team_id', teamIds)

    if (playerRowsError) throw playerRowsError

    const playerCounts = new Map<number, number>()
    for (const row of playerRows ?? []) {
      const teamId = Number(row.team_id)
      playerCounts.set(teamId, (playerCounts.get(teamId) ?? 0) + 1)
    }

    existingTeam = [...(existingTeams as TeamRow[])]
      .map((candidate) => ({
        ...candidate,
        player_count: playerCounts.get(candidate.id) ?? 0,
      }))
      .sort((left, right) => {
        if (right.player_count !== left.player_count) return right.player_count - left.player_count

        const leftCreatedAt = left.created_at ? Date.parse(left.created_at) : 0
        const rightCreatedAt = right.created_at ? Date.parse(right.created_at) : 0
        if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt

        return right.id - left.id
      })[0] ?? null
  }

  if (existingTeam) {
    const { error: updateTeamError } = await db
      .from('teams_bb')
      .update({
        name: team.name,
        logo_url: team.logoUrl ?? null,
      })
      .eq('id', existingTeam.id)

    if (updateTeamError) throw updateTeamError

    return {
      id: existingTeam.id,
      name: team.name,
      logo_url: team.logoUrl ?? null,
    }
  }

  const { data: insertedTeam, error: insertedTeamError } = await db
    .from('teams_bb')
    .insert({
      user_id: userId,
      name: team.name,
      logo_url: team.logoUrl ?? null,
    })
    .select('id,name,logo_url')
    .single<TeamRow>()

  if (insertedTeamError) throw insertedTeamError

  return insertedTeam
}

function toDbPlayerId(playerIdMap: PlayerIdMap, playerId: number | null | undefined): number | null {
  if (typeof playerId !== 'number' || !Number.isFinite(playerId)) return null
  return playerIdMap.get(playerId) ?? null
}

function toDbPitcherChanges(
  pitcherChanges: MatchRules['pitcherChanges'],
  playerIdMap: PlayerIdMap,
): MatchRules['pitcherChanges'] {
  return Object.fromEntries(
    Object.entries(pitcherChanges ?? {}).flatMap(([inning, playerId]) => {
      const dbPlayerId = toDbPlayerId(playerIdMap, playerId)
      return dbPlayerId ? [[inning, dbPlayerId]] : []
    }),
  ) as MatchRules['pitcherChanges']
}

function toDbFixedAssignments(
  fixedAssignments: MatchRules['fixedAssignments'],
  playerIdMap: PlayerIdMap,
): MatchRules['fixedAssignments'] {
  return fixedAssignments.flatMap((assignment) => {
    const dbPlayerId = toDbPlayerId(playerIdMap, assignment.playerId)
    return dbPlayerId ? [{ ...assignment, playerId: dbPlayerId }] : []
  })
}

function toDbManualOverrides(
  manualOverrides: PersistedAppState['manualOverrides'],
  playerIdMap: PlayerIdMap,
): PersistedAppState['manualOverrides'] {
  return Object.fromEntries(
    Object.entries(manualOverrides).flatMap(([key, playerId]) => {
      const dbPlayerId = toDbPlayerId(playerIdMap, playerId)
      return dbPlayerId ? [[key, dbPlayerId]] : []
    }),
  ) as PersistedAppState['manualOverrides']
}

function toDbBattingOrderPlayerIds(
  battingOrderPlayerIds: PersistedAppState['battingOrderPlayerIds'],
  playerIdMap: PlayerIdMap,
): number[] {
  const ordered: number[] = []

  for (const playerId of battingOrderPlayerIds ?? []) {
    const dbPlayerId = toDbPlayerId(playerIdMap, playerId)
    if (!dbPlayerId) continue
    if (ordered.includes(dbPlayerId)) continue
    ordered.push(dbPlayerId)
  }

  return ordered
}

function toDbLineup(lineup: MatchHistoryEntry['lineup'], playerIdMap: PlayerIdMap): MatchHistoryEntry['lineup'] {
  return {
    innings: lineup.innings.map((inning) => ({
      ...inning,
      assignments: Object.fromEntries(
        Object.entries(inning.assignments).flatMap(([position, playerId]) => {
          const dbPlayerId = toDbPlayerId(playerIdMap, playerId)
          return dbPlayerId ? [[position, dbPlayerId]] : []
        }),
      ) as MatchHistoryEntry['lineup']['innings'][number]['assignments'],
      bench: inning.bench.flatMap((playerId) => {
        const dbPlayerId = toDbPlayerId(playerIdMap, playerId)
        return dbPlayerId ? [dbPlayerId] : []
      }),
    })),
    totals: Object.fromEntries(
      Object.entries(lineup.totals).flatMap(([playerId, total]) => {
        const dbPlayerId = toDbPlayerId(playerIdMap, Number(playerId))
        return dbPlayerId ? [[dbPlayerId, total]] : []
      }),
    ) as MatchHistoryEntry['lineup']['totals'],
  }
}

function toDbBenchTotals(benchTotals: MatchHistoryEntry['benchTotals'], playerIdMap: PlayerIdMap): MatchHistoryEntry['benchTotals'] {
  return Object.fromEntries(
    Object.entries(benchTotals).flatMap(([playerId, total]) => {
      const dbPlayerId = toDbPlayerId(playerIdMap, Number(playerId))
      return dbPlayerId ? [[dbPlayerId, total]] : []
    }),
  ) as MatchHistoryEntry['benchTotals']
}

async function replacePlayers(teamId: number, players: Player[]): Promise<PlayerIdMap> {
  const db = getSupabase()
  const playerIdMap: PlayerIdMap = new Map()

  if (players.length === 0) {
    const { error } = await db.from('players_bb').delete().eq('team_id', teamId)
    if (error) throw error
    return playerIdMap
  }

  // Upsert each player using (team_id, name) as the stable key.
  // This avoids deleting + re-inserting all rows and generating new DB IDs on every save.
  const updatedAt = new Date().toISOString()

  for (const player of players) {
    const { data: upsertedPlayer, error: upsertError } = await db
      .from('players_bb')
      .upsert(
        {
          team_id: teamId,
          name: player.name,
          positions: player.positions,
          flexibility_level: player.flexibilityLevel,
          excluded_positions: player.excludedPositions ?? [],
          locked_position: player.lockedPosition ?? null,
          locked_can_bench: player.lockedCanBench ?? false,
          no_bench_last_inning: player.noBenchLastInning ?? false,
          updated_at: updatedAt,
        },
        { onConflict: 'team_id,name' },
      )
      .select('id')
      .single<{ id: number }>()

    if (upsertError) throw upsertError

    playerIdMap.set(player.id, upsertedPlayer.id)
  }

  // Delete players that are no longer in the roster.
  const playerNames = players.map((player) => player.name)
  const { error: deleteError } = await db
    .from('players_bb')
    .delete()
    .eq('team_id', teamId)
    .not('name', 'in', `(${playerNames.map((n) => `"${n}"`).join(',')})`)

  if (deleteError) throw deleteError

  return playerIdMap
}

async function syncRules(
  teamId: number,
  rules: MatchRules,
  manualOverrides: PersistedAppState['manualOverrides'],
  lockedOverrides: string[],
  selectedHistoryMatchId: string | undefined,
  historyContextWindow: number,
  battingOrderPlayerIds: PersistedAppState['battingOrderPlayerIds'],
  playerIdMap: PlayerIdMap,
) {
  const db = getSupabase()

  const { error: deleteRulesError } = await db
    .from('rules_bb')
    .delete()
    .eq('team_id', teamId)

  if (deleteRulesError) throw deleteRulesError

  const { error: insertRulesError } = await db.from('rules_bb').insert({
    team_id: teamId,
    innings_count: rules.inningsCount,
    pitcher_id: toDbPlayerId(playerIdMap, rules.pitcherId),
    max_pitcher_innings: rules.maxPitcherInnings,
    pitcher_changes: toDbPitcherChanges(rules.pitcherChanges, playerIdMap),
    fixed_center_field: rules.fixedCenterField,
    fixed_center_field_player_id: toDbPlayerId(playerIdMap, rules.fixedCenterFieldPlayerId),
    fixed_assignments: toDbFixedAssignments(rules.fixedAssignments, playerIdMap),
    prioritize_catcher: rules.prioritizeCatcher,
    max_consecutive_bench: rules.maxConsecutiveBench,
    manual_overrides: toDbManualOverrides(manualOverrides, playerIdMap),
    locked_overrides: lockedOverrides,
    selected_history_match_id: selectedHistoryMatchId ?? null,
    history_context_window: historyContextWindow,
    batting_order_player_ids: toDbBattingOrderPlayerIds(battingOrderPlayerIds, playerIdMap),
    updated_at: new Date().toISOString(),
  })

  if (insertRulesError) throw insertRulesError
}

async function syncMatchHistory(teamId: number, matchHistory: MatchHistoryEntry[], playerIdMap: PlayerIdMap) {
  const db = getSupabase()

  const nextIds = new Set(matchHistory.map((entry) => entry.id))

  const { data: existingHistory, error: existingHistoryError } = await db
    .from('match_history_bb')
    .select('client_match_id')
    .eq('team_id', teamId)

  if (existingHistoryError) throw existingHistoryError

  const idsToDelete = (existingHistory ?? [])
    .map((row) => row.client_match_id as string | null)
    .filter((id): id is string => !!id && !nextIds.has(id))

  if (idsToDelete.length > 0) {
    const { error: deleteHistoryError } = await db
      .from('match_history_bb')
      .delete()
      .eq('team_id', teamId)
      .in('client_match_id', idsToDelete)

    if (deleteHistoryError) throw deleteHistoryError
  }

  if (matchHistory.length === 0) return

  const payload = matchHistory.map((entry) => ({
    team_id: teamId,
    client_match_id: entry.id,
    label: entry.label,
    lineup_json: toDbLineup(entry.lineup, playerIdMap),
    bench_totals: toDbBenchTotals(entry.benchTotals, playerIdMap),
    created_at: entry.createdAt,
  }))

  const { error: upsertHistoryError } = await db
    .from('match_history_bb')
    .upsert(payload, { onConflict: 'team_id,client_match_id' })

  if (upsertHistoryError) throw upsertHistoryError
}

export async function registerUser(email: string, password: string): Promise<SessionUser> {
  const db = getSupabase()

  const { data, error } = await db
    .from('users_bb')
    .insert({ email, password })
    .select('id,email')
    .single<SessionUser>()

  if (error) throw error

  return data
}

export async function loginUser(email: string, password: string): Promise<SessionUser> {
  const db = getSupabase()

  const { data, error } = await db
    .from('users_bb')
    .select('id,email,password')
    .eq('email', email)
    .maybeSingle<{ id: number; email: string; password: string }>()

  if (error) throw error
  if (!data || data.password !== password) {
    throw new Error('Email ou mot de passe invalide.')
  }

  return {
    id: data.id,
    email: data.email,
  }
}

export async function loadRemoteState(userId: number): Promise<PersistedAppState | null> {
  const db = getSupabase()

  const { data: teams, error: teamError } = await db
    .from('teams_bb')
    .select('id,name,logo_url,created_at')
    .eq('user_id', userId)
    .order('id', { ascending: false })

  if (teamError) throw teamError
  if (!teams || teams.length === 0) return null

  const teamIds = teams.map((candidate) => candidate.id)
  const { data: playerTeamRows, error: playerTeamRowsError } = await db
    .from('players_bb')
    .select('team_id')
    .in('team_id', teamIds)

  if (playerTeamRowsError) throw playerTeamRowsError

  const playerCounts = new Map<number, number>()
  for (const row of playerTeamRows ?? []) {
    const teamId = Number(row.team_id)
    playerCounts.set(teamId, (playerCounts.get(teamId) ?? 0) + 1)
  }

  const team = [...(teams as TeamRow[])]
    .map((candidate) => ({
      ...candidate,
      player_count: playerCounts.get(candidate.id) ?? 0,
    }))
    .sort((left, right) => {
      if (right.player_count !== left.player_count) return right.player_count - left.player_count

      const leftCreatedAt = left.created_at ? Date.parse(left.created_at) : 0
      const rightCreatedAt = right.created_at ? Date.parse(right.created_at) : 0
      if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt

      return right.id - left.id
    })[0] as TeamSelectionCandidate | undefined

  if (!team) return null

  const [{ data: players, error: playersError }, { data: rules, error: rulesError }, { data: history, error: historyError }] =
    await Promise.all([
      db.from('players_bb').select('*').eq('team_id', team.id).order('id', { ascending: true }),
      db
        .from('rules_bb')
        .select('*')
        .eq('team_id', team.id)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle<RulesRow>(),
      db
        .from('match_history_bb')
        .select('client_match_id,label,lineup_json,bench_totals,created_at')
        .eq('team_id', team.id)
        .order('created_at', { ascending: false }),
    ])

  if (playersError) throw playersError
  if (rulesError) throw rulesError
  if (historyError) throw historyError

  const mappedPlayers = (players as PlayerRow[] | null ?? []).map((player): Player => ({
    id: player.id,
    teamId: team.id,
    name: player.name,
    positions: player.positions,
    flexibilityLevel: (player.flexibility_level === 'absent' ? 'absent' : 'starter') as FlexibilityLevel,
    excludedPositions: player.excluded_positions ?? [],
    lockedPosition: player.locked_position ?? undefined,
    lockedCanBench: player.locked_can_bench,
    noBenchLastInning: player.no_bench_last_inning ?? false,
  }))

  const mappedRules: MatchRules = {
    inningsCount: rules?.innings_count ?? demoRules.inningsCount,
    pitcherId: rules?.pitcher_id ?? mappedPlayers[0]?.id ?? demoRules.pitcherId,
    maxPitcherInnings: rules?.max_pitcher_innings ?? demoRules.maxPitcherInnings,
    pitcherChanges: rules?.pitcher_changes ?? {},
    fixedCenterField: rules?.fixed_center_field ?? false,
    fixedCenterFieldPlayerId: rules?.fixed_center_field_player_id ?? undefined,
    fixedCenterFieldPosition: 'CF',
    fixedAssignments: rules?.fixed_assignments ?? [],
    prioritizeCatcher: rules?.prioritize_catcher ?? false,
    maxConsecutiveBench: rules?.max_consecutive_bench ?? demoRules.maxConsecutiveBench,
  }

  const mappedHistory = (history as MatchHistoryRow[] | null ?? []).map((entry, index): MatchHistoryEntry => ({
    id: entry.client_match_id ?? `${Date.now()}-${index + 1}`,
    label: entry.label,
    createdAt: entry.created_at,
    lineup: entry.lineup_json,
    benchTotals: entry.bench_totals ?? {},
  }))

  return {
    team: {
      id: team.id,
      name: team.name || demoTeam.name,
      logoUrl: team.logo_url ?? undefined,
    },
    players: mappedPlayers,
    rules: mappedRules,
    manualOverrides: normalizeManualOverrides(rules?.manual_overrides),
    lockedOverrides: normalizeLockedOverrides(rules?.locked_overrides),
    matchHistory: mappedHistory,
    selectedHistoryMatchId: rules?.selected_history_match_id ?? undefined,
    historyContextWindow: rules?.history_context_window ?? 1,
    battingOrderPlayerIds: normalizeBattingOrderPlayerIds(rules?.batting_order_player_ids),
  }
}

export async function importLocalStateIfRemoteEmpty(userId: number, localState: PersistedAppState): Promise<boolean> {
  const remote = await loadRemoteState(userId)
  if (remote) return false

  await saveRemoteState(userId, localState)
  return true
}

export async function saveRemoteState(userId: number, state: PersistedAppState): Promise<void> {
  const team = await getOrCreateTeam(userId, state.team)
  const playerIdMap = await replacePlayers(team.id, state.players)

  await syncRules(
    team.id,
    state.rules,
    state.manualOverrides,
    state.lockedOverrides,
    state.selectedHistoryMatchId,
    state.historyContextWindow ?? 1,
    state.battingOrderPlayerIds,
    playerIdMap,
  )
  await syncMatchHistory(team.id, state.matchHistory ?? [], playerIdMap)
}

export async function saveMatchHistoryEntry(userId: number, team: Team, entry: MatchHistoryEntry): Promise<void> {
  const dbTeam = await getOrCreateTeam(userId, team)
  const db = getSupabase()

  const { error } = await db.from('match_history_bb').upsert(
    {
      team_id: dbTeam.id,
      client_match_id: entry.id,
      label: entry.label,
      lineup_json: entry.lineup,
      bench_totals: entry.benchTotals,
      created_at: entry.createdAt,
    },
    { onConflict: 'team_id,client_match_id' },
  )

  if (error) throw error
}

function generateShareId(): string {
  // Generate a short alphanumeric ID (8 chars)
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return id
}

export async function createShareLink(userId: number, team: Team, payload: ShareViewPayload): Promise<string> {
  const db = getSupabase()
  const dbTeam = await getOrCreateTeam(userId, team)

  let shareId = generateShareId()
  let attempts = 0
  const maxAttempts = 5

  // Retry if collision (very unlikely)
  while (attempts < maxAttempts) {
    const { data: existing, error: checkError } = await db
      .from('share_links_bb')
      .select('id')
      .eq('id', shareId)
      .maybeSingle()

    if (checkError) throw checkError
    if (!existing) break

    shareId = generateShareId()
    attempts++
  }

  if (attempts >= maxAttempts) {
    throw new Error('Impossible de générer un ID de partage unique.')
  }

  const { error } = await db.from('share_links_bb').insert({
    id: shareId,
    team_id: dbTeam.id,
    payload,
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
  })

  if (error) throw error

  return shareId
}

export async function loadShareLink(shareId: string): Promise<ShareViewPayload | null> {
  const db = getSupabase()

  const { data, error } = await db
    .from('share_links_bb')
    .select('payload,expires_at')
    .eq('id', shareId)
    .maybeSingle<{ payload: ShareViewPayload; expires_at: string | null }>()

  if (error) throw error
  if (!data) return null

  // Check if link is expired
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null
  }

  // Note: View count tracking could be added with RPC function if needed
  return data.payload
}
