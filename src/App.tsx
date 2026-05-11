import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { demoRules, demoTeam } from './data/demo'
import {
  FIELD_POSITIONS,
  createOverrideKey,
  isPosition,
  type FlexibilityLevel,
  type MatchHistoryEntry,
  type ManualOverrideMap,
  type MatchRules,
  type PersistedAppState,
  type Player,
  type Position,
  type PreviousMatchContext,
  type Team,
} from './domain'
import { generateLineupLocally, summarizeLineup } from './lib/lineupEngine'
import {
  loadRemoteState,
  loginUser,
  registerUser,
  saveMatchHistoryEntry,
  saveRemoteState,
  type SessionUser,
} from './lib/persistence'
import { isSupabaseConfigured } from './lib/supabaseClient'

type GeneratedLineup = ReturnType<typeof generateLineupLocally>

function PosBadge({ position }: { position: Position }) {
  return <span className={`pos-badge pos-${position}`}>{position}</span>
}

function TeamVisual({ logoUrl, size = 96 }: { logoUrl?: string; size?: number }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt="Logo de l’équipe"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          objectFit: 'cover',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.24)',
          boxShadow: '0 10px 24px rgba(0,0,0,0.2)',
          flexShrink: 0,
        }}
      />
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.85 }}
    >
      <path d="M8 88 Q48 4 88 88 Z" fill="rgba(27,107,53,0.25)" stroke="rgba(76,175,80,0.3)" strokeWidth="1" />
      <polygon points="48,28 74,54 48,80 22,54" fill="rgba(124,59,14,0.35)" stroke="rgba(253,186,116,0.4)" strokeWidth="1" />
      <line x1="48" y1="80" x2="74" y2="54" stroke="rgba(240,237,217,0.5)" strokeWidth="1" />
      <line x1="48" y1="80" x2="22" y2="54" stroke="rgba(240,237,217,0.5)" strokeWidth="1" />
      <line x1="22" y1="54" x2="48" y2="28" stroke="rgba(240,237,217,0.5)" strokeWidth="1" />
      <line x1="74" y1="54" x2="48" y2="28" stroke="rgba(240,237,217,0.5)" strokeWidth="1" />
      <rect x="44" y="76" width="8" height="8" rx="1" fill="#F0EDD9" />
      <rect x="70" y="50" width="8" height="8" rx="1" fill="#FFD700" />
      <rect x="44" y="24" width="8" height="8" rx="1" fill="#FFD700" />
      <rect x="18" y="50" width="8" height="8" rx="1" fill="#FFD700" />
      <circle cx="48" cy="52" r="4" fill="rgba(180,83,9,0.8)" stroke="rgba(253,186,116,0.6)" strokeWidth="1" />
    </svg>
  )
}

function TeamLogoBadge({ logoUrl, title }: { logoUrl?: string; title: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
      <TeamVisual logoUrl={logoUrl} size={26} />
      <span style={{ fontSize: '0.82rem', opacity: 0.9 }}>{title}</span>
    </div>
  )
}

const AUTH_STORAGE_KEY = 'autolineup-user-v1'
const OUTFIELD_GROUP_VALUE = 'OUTFIELD_GROUP'
const OUTFIELD_POSITIONS: Position[] = ['LF', 'CF', 'RF']

function createEmptyPersistedState(): PersistedAppState {
  return {
    team: {
      id: 0,
      name: '',
      logoUrl: '',
    },
    players: [],
    rules: {
      ...demoRules,
      pitcherId: 0,
      pitcherChanges: {},
      fixedCenterField: false,
      fixedCenterFieldPlayerId: undefined,
      fixedCenterFieldPosition: 'CF',
      fixedAssignments: [],
      prioritizeCatcher: false,
    },
    manualOverrides: {},
    lockedOverrides: [],
    matchHistory: [],
    selectedHistoryMatchId: undefined,
    historyContextWindow: 1,
  }
}

function generateLineupFromState(state: PersistedAppState): GeneratedLineup {
  if (state.players.filter((player) => player.flexibilityLevel !== 'absent').length < FIELD_POSITIONS.length) {
    return {
      innings: [],
      totals: {},
    }
  }

  return generateLineupLocally(
    state.players,
    state.rules,
    state.manualOverrides,
    state.lockedOverrides,
    toPreviousMatchContext(
      getHistoryContextMatches(
        state.matchHistory ?? [],
        state.selectedHistoryMatchId,
        state.historyContextWindow ?? 1,
      ),
    ),
  )
}

function readStoredSessionUser(): SessionUser | null {
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<SessionUser>
    if (typeof parsed.id !== 'number' || typeof parsed.email !== 'string') return null
    return {
      id: parsed.id,
      email: parsed.email,
    }
  } catch {
    return null
  }
}

function writeStoredSessionUser(user: SessionUser | null) {
  if (!user) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user))
}

function positionLabel(position: Position): string {
  if (position === 'P') return 'P (Lanceur)'
  if (position === 'C') return 'C (Receveur)'
  return position
}

function toSinglePositionList(value: string) {
  return isPosition(value) ? [value] : []
}

function isOutfieldGroup(positions: Position[]) {
  return OUTFIELD_POSITIONS.every((position) => positions.includes(position)) && positions.length === 3
}

function toPositionSelectValue(positions: Position[]) {
  if (isOutfieldGroup(positions)) return OUTFIELD_GROUP_VALUE
  return positions[0] ?? ''
}

function fromPositionSelectValue(value: string) {
  if (value === OUTFIELD_GROUP_VALUE) return [...OUTFIELD_POSITIONS]
  return toSinglePositionList(value)
}

function normalizeGeneralGroup(value: string): Player['positions']['general'][number] | null {
  if (value === 'infield') return 'infield'
  if (value === 'outfield') return 'outfield'
  if (value === 'outfield_catcher') return 'outfield_catcher'
  if (value === 'infield_catcher') return 'infield_catcher'
  if (value === 'all_fields') return 'all_fields'
  if (value === 'all_fields_catcher') return 'all_fields_catcher'
  if (value === 'all_positions') return 'all_positions'
  if (value === 'utility') return 'all_fields'
  return null
}

function toGeneralGroup(value: string): Player['positions']['general'][number] | null {
  return normalizeGeneralGroup(value)
}

function canBeStartingPitcher(player: Player) {
  if (player.flexibilityLevel === 'absent') return false
  if (player.excludedPositions?.includes('P')) return false
  if (player.positions.primary.includes('P')) return true
  if (player.positions.secondary.includes('P')) return true
  if (player.positions.tertiary.includes('P')) return true
  return player.positions.general.includes('all_positions')
}

function normalizePitcherChanges(
  pitcherChanges: MatchRules['pitcherChanges'] | undefined,
  players: Player[],
  rules: Pick<MatchRules, 'inningsCount' | 'pitcherId'>,
) {
  const eligiblePitchers = new Set(players.filter((player) => canBeStartingPitcher(player)).map((player) => player.id))
  const normalizedEntries = Object.entries(pitcherChanges ?? {})
    .map(([inning, pitcherId]) => [Number(inning), normalizeNumericId(pitcherId)] as const)
    .filter(([inning, pitcherId]) => Number.isInteger(inning) && inning > 1 && inning <= rules.inningsCount && eligiblePitchers.has(pitcherId))
    .sort((left, right) => left[0] - right[0])

  let previousPitcherId = rules.pitcherId

  return Object.fromEntries(
    normalizedEntries.flatMap(([inning, pitcherId]) => {
      if (pitcherId === previousPitcherId) return []
      previousPitcherId = pitcherId
      return [[inning, pitcherId]]
    }),
  ) as MatchRules['pitcherChanges']
}

function getPitcherForInning(rules: MatchRules, inning: number) {
  const changeEntries = Object.entries(rules.pitcherChanges ?? {})
    .map(([changeInning, pitcherId]) => [Number(changeInning), pitcherId] as const)
    .filter(
      (entry): entry is readonly [number, number] =>
        Number.isInteger(entry[0]) && entry[0] > 1 && typeof entry[1] === 'number',
    )
    .sort((left, right) => left[0] - right[0])

  let pitcherId = rules.pitcherId
  for (const [changeInning, changedPitcherId] of changeEntries) {
    if (changeInning > inning) break
    pitcherId = changedPitcherId
  }

  return pitcherId
}

function encodeShareState(state: PersistedAppState) {
  return `#share=${window.btoa(encodeURIComponent(JSON.stringify(state)))}`
}

function normalizeNumericId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'string') {
    const digits = value.match(/\d+/)
    if (digits) {
      const parsed = Number(digits[0])
      if (Number.isFinite(parsed)) return parsed
    }
  }

  return 0
}

function normalizeExcludedPositions(positions: Position[] | undefined): Position[] {
  if (!positions) return []
  return [...new Set(positions.filter((position) => FIELD_POSITIONS.includes(position)))]
}

function applyExcludedPositions(player: Player, excludedPositions: Position[]): Player {
  const excluded = normalizeExcludedPositions(excludedPositions)
  const excludedSet = new Set(excluded)
  const filteredPrimary = player.positions.primary.filter((position) => !excludedSet.has(position))
  const nextLockedPosition =
    player.lockedPosition && excludedSet.has(player.lockedPosition)
      ? undefined
      : player.lockedPosition
  const fallbackPrimary = FIELD_POSITIONS.find((position) => !excludedSet.has(position))

  return {
    ...player,
    excludedPositions: excluded,
    lockedPosition: nextLockedPosition,
    lockedCanBench: nextLockedPosition ? player.lockedCanBench ?? true : false,
    positions: {
      ...player.positions,
      primary: filteredPrimary.length > 0 ? filteredPrimary : fallbackPrimary ? [fallbackPrimary] : [],
      secondary: player.positions.secondary.filter((position) => !excludedSet.has(position)),
      tertiary: player.positions.tertiary.filter((position) => !excludedSet.has(position)),
    },
  }
}

function excludedPositionsSummary(excludedPositions: Position[] | undefined) {
  const excluded = normalizeExcludedPositions(excludedPositions)
  if (excluded.length === 0) return 'Aucune'
  if (excluded.length <= 2) return excluded.map((position) => positionLabel(position)).join(', ')
  return `${excluded.length} positions`
}

function computeBenchTotals(lineup: ReturnType<typeof generateLineupLocally>, players: Player[]) {
  const benchTotals = Object.fromEntries(players.map((player) => [player.id, 0])) as Record<number, number>

  for (const inning of lineup.innings) {
    for (const playerId of inning.bench) {
      benchTotals[playerId] = (benchTotals[playerId] ?? 0) + 1
    }
  }

  return benchTotals
}

function createMatchHistoryEntry(lineup: ReturnType<typeof generateLineupLocally>, players: Player[], count: number): MatchHistoryEntry {
  const createdAt = new Date().toISOString()

  return {
    id: `${Date.now()}-${count + 1}`,
    label: `Match ${count + 1}`,
    createdAt,
    lineup,
    benchTotals: computeBenchTotals(lineup, players),
  }
}

function getHistoryContextMatches(matchHistory: MatchHistoryEntry[], selectedHistoryMatchId: string | undefined, window: number) {
  if (window <= 0) return []

  if (!selectedHistoryMatchId) {
    return matchHistory.slice(0, window)
  }

  const selectedIndex = matchHistory.findIndex((match) => match.id === selectedHistoryMatchId)
  if (selectedIndex === -1) return []

  return matchHistory.slice(selectedIndex, selectedIndex + window)
}

function toPreviousMatchContext(matchHistoryEntries: MatchHistoryEntry[]): PreviousMatchContext | undefined {
  if (matchHistoryEntries.length === 0) return undefined

  const benchTotals = {} as Record<number, number>

  for (const matchHistoryEntry of matchHistoryEntries) {
    for (const [playerId, benchTotal] of Object.entries(matchHistoryEntry.benchTotals)) {
      const numericPlayerId = Number(playerId)
      benchTotals[numericPlayerId] = (benchTotals[numericPlayerId] ?? 0) + benchTotal
    }
  }

  return {
    benchTotals,
    matchCount: matchHistoryEntries.length,
  }
}

function isActivePlayer(player: Player) {
  return player.flexibilityLevel !== 'absent'
}

function normalizePersistedState(state: PersistedAppState): PersistedAppState {
  const team: Team = {
    ...state.team,
    id: normalizeNumericId(state.team.id) || demoTeam.id,
  }

  const players: Player[] = state.players.map((player, index): Player => {
    const normalizedGeneralGroups = player.positions.general
      .map((group) => normalizeGeneralGroup(group))
      .filter((group): group is Player['positions']['general'][number] => group !== null)
    const deduplicatedGeneralGroups: Player['positions']['general'] = [...new Set(normalizedGeneralGroups)]

    return {
      ...player,
      id: normalizeNumericId(player.id) || index + 1,
      teamId: normalizeNumericId(player.teamId) || team.id,
      lockedCanBench: player.lockedPosition ? player.lockedCanBench ?? true : false,
      excludedPositions: normalizeExcludedPositions(player.excludedPositions),
      positions: {
        ...player.positions,
        general: deduplicatedGeneralGroups.length > 0 ? deduplicatedGeneralGroups : ['all_fields'],
      },
    }
  })

  return {
    ...state,
    team,
    players,
    rules: {
      ...state.rules,
      pitcherId: normalizeNumericId(state.rules.pitcherId) || players[0]?.id || demoRules.pitcherId,
      pitcherChanges: normalizePitcherChanges(state.rules.pitcherChanges, players, {
        inningsCount: state.rules.inningsCount,
        pitcherId: normalizeNumericId(state.rules.pitcherId) || players[0]?.id || demoRules.pitcherId,
      }),
      fixedCenterField: false,
      fixedCenterFieldPlayerId: undefined,
      fixedCenterFieldPosition: 'CF',
      fixedAssignments: [],
    },
    manualOverrides: Object.fromEntries(
      Object.entries(state.manualOverrides).flatMap(([key, value]) => {
        const normalized = normalizeNumericId(value)
        return normalized ? [[key, normalized]] : []
      }),
    ) as ManualOverrideMap,
    matchHistory: (state.matchHistory ?? []).map((match, index) => ({
      id: String(match.id ?? `${Date.now()}-${index + 1}`),
      label: match.label?.trim() || `Match ${index + 1}`,
      createdAt: match.createdAt ?? new Date().toISOString(),
      lineup: match.lineup,
      benchTotals: Object.fromEntries(
        Object.entries(match.benchTotals ?? {}).flatMap(([playerId, benchTotal]) => {
          const normalizedPlayerId = normalizeNumericId(playerId)
          const normalizedBenchTotal = typeof benchTotal === 'number' && Number.isFinite(benchTotal) ? benchTotal : 0
          return normalizedPlayerId ? [[normalizedPlayerId, normalizedBenchTotal]] : []
        }),
      ) as Record<number, number>,
    })),
    selectedHistoryMatchId: state.selectedHistoryMatchId,
    historyContextWindow: [1, 2, 3].includes(state.historyContextWindow ?? 1) ? state.historyContextWindow : 1,
  }
}

function nextPlayerId(players: Player[]) {
  return players.reduce((maxId, player) => Math.max(maxId, player.id), 0) + 1
}

function App() {
  const [initialState] = useState<PersistedAppState>(() => createEmptyPersistedState())

  const [team, setTeam] = useState<Team>(initialState.team)
  const [players, setPlayers] = useState<Player[]>(initialState.players)
  const [rules, setRules] = useState<MatchRules>(initialState.rules)
  const [inningsCountInput, setInningsCountInput] = useState(String(initialState.rules.inningsCount))
  const [maxPitcherInningsInput, setMaxPitcherInningsInput] = useState(String(initialState.rules.maxPitcherInnings))
  const [maxConsecutiveBenchInput, setMaxConsecutiveBenchInput] = useState(String(initialState.rules.maxConsecutiveBench))
  const [manualOverrides, setManualOverrides] = useState<ManualOverrideMap>(initialState.manualOverrides)
  const [lockedOverrides, setLockedOverrides] = useState<string[]>(initialState.lockedOverrides)
  const [pitcherChangeSelections, setPitcherChangeSelections] = useState<Record<number, number>>({})
  const [matchHistory, setMatchHistory] = useState<MatchHistoryEntry[]>(initialState.matchHistory ?? [])
  const [selectedHistoryMatchId, setSelectedHistoryMatchId] = useState<string | undefined>(initialState.selectedHistoryMatchId)
  const [historyContextWindow, setHistoryContextWindow] = useState(initialState.historyContextWindow ?? 1)
  const historyContextMatches = useMemo(
    () => getHistoryContextMatches(matchHistory, selectedHistoryMatchId, historyContextWindow),
    [historyContextWindow, matchHistory, selectedHistoryMatchId],
  )
  const previousMatchContext = useMemo(
    () => toPreviousMatchContext(historyContextMatches),
    [historyContextMatches],
  )
  const selectedHistoryMatch = useMemo(
    () => matchHistory.find((match) => match.id === selectedHistoryMatchId),
    [matchHistory, selectedHistoryMatchId],
  )
  const activePlayers = useMemo(
    () => players.filter((player) => isActivePlayer(player)),
    [players],
  )
  const [lineup, setLineup] = useState(() => generateLineupFromState(initialState))
  const [status, setStatus] = useState('MVP prêt à générer un alignement intelligent.')
  const [authUser, setAuthUser] = useState<SessionUser | null>(() => readStoredSessionUser())
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [dbHydrationDone, setDbHydrationDone] = useState(!isSupabaseConfigured)

  function applyPersistedState(nextState: PersistedAppState) {
    setTeam(nextState.team)
    setPlayers(nextState.players)
    setRules(nextState.rules)
    setManualOverrides(nextState.manualOverrides)
    setLockedOverrides(nextState.lockedOverrides)
    setMatchHistory(nextState.matchHistory ?? [])
    setSelectedHistoryMatchId(nextState.selectedHistoryMatchId)
    setHistoryContextWindow(nextState.historyContextWindow ?? 1)
    setPitcherChangeSelections({})
    setLineup(generateLineupFromState(nextState))
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return

    if (!authUser) {
      setDbHydrationDone(false)
      return
    }

    const currentUser = authUser

    let cancelled = false

    async function hydrateFromDb() {
      setDbHydrationDone(false)

      try {
        const remoteState = await loadRemoteState(currentUser.id)

        if (!cancelled && remoteState) {
          const normalizedRemoteState = normalizePersistedState(remoteState)
          applyPersistedState(normalizedRemoteState)
          setStatus('Configuration chargée depuis Supabase.')
        } else if (!cancelled) {
          applyPersistedState(createEmptyPersistedState())
          setStatus('Aucune configuration trouvée pour ce coach. Crée ton équipe et elle sera sauvegardée en base.')
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Erreur inconnue Supabase.'
          setStatus(`Erreur de chargement Supabase: ${message}`)
        }
      } finally {
        if (!cancelled) {
          setDbHydrationDone(true)
        }
      }
    }

    void hydrateFromDb()

    return () => {
      cancelled = true
    }
  }, [authUser])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    if (!authUser) return
    if (!dbHydrationDone) return

    const handle = window.setTimeout(() => {
      const snapshot: PersistedAppState = {
        team,
        players,
        rules,
        manualOverrides,
        lockedOverrides,
        matchHistory,
        selectedHistoryMatchId,
        historyContextWindow,
      }
      void saveRemoteState(authUser.id, snapshot).catch((error) => {
        const message = error instanceof Error ? error.message : 'Erreur inconnue Supabase.'
        setStatus(`Erreur de sauvegarde Supabase: ${message}`)
      })
    }, 550)

    return () => {
      window.clearTimeout(handle)
    }
  }, [
    authUser,
    dbHydrationDone,
    team,
    players,
    rules,
    manualOverrides,
    lockedOverrides,
    matchHistory,
    selectedHistoryMatchId,
    historyContextWindow,
  ])

  useEffect(() => {
    if (!selectedHistoryMatchId) return
    if (matchHistory.some((match) => match.id === selectedHistoryMatchId)) return

    setSelectedHistoryMatchId(undefined)
  }, [matchHistory, selectedHistoryMatchId])

  useEffect(() => {
    if (selectedHistoryMatchId) return
    if (matchHistory.length === 0) return

    setSelectedHistoryMatchId(matchHistory[0].id)
  }, [matchHistory, selectedHistoryMatchId])

  useEffect(() => {
    setInningsCountInput(String(rules.inningsCount))
  }, [rules.inningsCount])

  useEffect(() => {
    setMaxPitcherInningsInput(String(rules.maxPitcherInnings))
  }, [rules.maxPitcherInnings])

  useEffect(() => {
    setMaxConsecutiveBenchInput(String(rules.maxConsecutiveBench))
  }, [rules.maxConsecutiveBench])

  const startingPitcherOptions = useMemo(
    () => activePlayers.filter((player) => canBeStartingPitcher(player)),
    [activePlayers],
  )

  useEffect(() => {
    if (startingPitcherOptions.length === 0) return
    if (startingPitcherOptions.some((player) => player.id === rules.pitcherId)) return

    setRules((currentRules) => ({
      ...currentRules,
      pitcherId: startingPitcherOptions[0].id,
      pitcherChanges: normalizePitcherChanges(currentRules.pitcherChanges, players, {
        inningsCount: currentRules.inningsCount,
        pitcherId: startingPitcherOptions[0].id,
      }),
    }))
  }, [players, startingPitcherOptions, rules.pitcherId])

  const playerNames = useMemo(
    () => Object.fromEntries(players.map((player) => [player.id, player.name])),
    [players],
  )

  const summary = useMemo(() => summarizeLineup(lineup, players), [lineup, players])
  const currentMatchBenchTotals = useMemo(
    () => computeBenchTotals(lineup, activePlayers),
    [lineup, activePlayers],
  )
  const interMatchBenchPriorityPlayers = useMemo(() => {
    if (!previousMatchContext) return new Set<number>()

    return new Set(
      activePlayers
        .filter(
          (player) =>
            ((previousMatchContext.benchTotals[player.id] ?? 0) / Math.max(previousMatchContext.matchCount, 1)) === 0,
        )
        .map((player) => player.id),
    )
  }, [activePlayers, previousMatchContext])
  const remainingBenchPriorityPlayers = useMemo(
    () =>
      new Set(
        [...interMatchBenchPriorityPlayers].filter((playerId) => (currentMatchBenchTotals[playerId] ?? 0) === 0),
      ),
    [currentMatchBenchTotals, interMatchBenchPriorityPlayers],
  )

  function updatePlayer(playerId: number, updater: (player: Player) => Player) {
    setPlayers((currentPlayers) => {
      const nextPlayers = currentPlayers.map((player) => (player.id === playerId ? updater(player) : player))

      setRules((currentRules) => ({
        ...currentRules,
        pitcherChanges: normalizePitcherChanges(currentRules.pitcherChanges, nextPlayers, currentRules),
      }))

      return nextPlayers
    })
  }

  function addPlayer() {
    const newPlayer: Player = {
      id: nextPlayerId(players),
      name: 'Nouveau joueur',
      teamId: team.id,
      positions: { primary: ['1B'], secondary: [], tertiary: [], general: ['all_fields'] },
      flexibilityLevel: 'starter',
      excludedPositions: [],
    }

    setPlayers((currentPlayers) => [...currentPlayers, newPlayer])
    setStatus('Joueur ajouté au roster.')
  }

  function removePlayer(playerId: number) {
    const remainingPlayers = players.filter((player) => player.id !== playerId)
    setPlayers(remainingPlayers)
    setManualOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([, value]) => value !== playerId)),
    )
    setLockedOverrides((current) => current.filter((key) => manualOverrides[key] !== playerId))

    if (rules.pitcherId === playerId) {
      const replacement = remainingPlayers.find((player) => canBeStartingPitcher(player))
        ?? remainingPlayers[0]
      if (replacement) {
        setRules((currentRules) => ({
          ...currentRules,
          pitcherId: replacement.id,
          pitcherChanges: normalizePitcherChanges(currentRules.pitcherChanges, remainingPlayers, {
            inningsCount: currentRules.inningsCount,
            pitcherId: replacement.id,
          }),
        }))
      } else {
        setRules((currentRules) => ({
          ...currentRules,
          pitcherChanges: normalizePitcherChanges(currentRules.pitcherChanges, remainingPlayers, currentRules),
        }))
      }
    } else {
      setRules((currentRules) => ({
        ...currentRules,
        pitcherChanges: normalizePitcherChanges(currentRules.pitcherChanges, remainingPlayers, currentRules),
      }))
    }

    setStatus('Joueur retiré du roster.')
  }

  function updateOverride(inning: number, position: Position, playerId?: number) {
    const key = createOverrideKey(inning, position)
    setManualOverrides((current) => {
      const next = { ...current }
      if (playerId !== undefined) {
        next[key] = playerId
      } else {
        delete next[key]
      }
      return next
    })
    setStatus(`Override mis à jour pour la manche ${inning}, position ${position}.`)
  }

  function toggleLockedOverride(inning: number, position: Position) {
    const key = createOverrideKey(inning, position)
    setLockedOverrides((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  function generateCurrentLineup() {
    if (activePlayers.length < FIELD_POSITIONS.length) {
      setStatus(`Impossible de générer un alignement: ${FIELD_POSITIONS.length} joueurs actifs sont requis, seulement ${activePlayers.length} sont disponibles.`)
      return
    }

    const generated = generateLineupLocally(players, rules, manualOverrides, lockedOverrides, previousMatchContext)
    setLineup(generated)
    setStatus(
      historyContextMatches.length > 0
        ? `Alignement généré avec l'équité des ${historyContextMatches.length} dernier(s) match(s) sélectionné(s).`
        : 'Alignement généré avec les paramètres actuels.',
    )
  }

  function applyPitcherChangeFromInning(inning: number) {
    const selectedPitcherId = pitcherChangeSelections[inning] ?? getPitcherForInning(rules, inning)
    const nextRules: MatchRules = {
      ...rules,
      pitcherChanges: normalizePitcherChanges(
        {
          ...rules.pitcherChanges,
          [inning]: selectedPitcherId,
        },
        players,
        rules,
      ),
    }

    const nextLineup = generateLineupLocally(players, nextRules, manualOverrides, lockedOverrides, previousMatchContext)
    setRules(nextRules)
    setLineup(nextLineup)
    setStatus(`Changement de lanceur appliqué dès la manche ${inning}. Les manches ${inning} à ${rules.inningsCount} ont été recalculées.`)
  }

  function clearPitcherChangeFromInning(inning: number) {
    const nextPitcherChanges = { ...rules.pitcherChanges }
    delete nextPitcherChanges[inning]

    const nextRules: MatchRules = {
      ...rules,
      pitcherChanges: normalizePitcherChanges(nextPitcherChanges, players, rules),
    }

    const nextLineup = generateLineupLocally(players, nextRules, manualOverrides, lockedOverrides, previousMatchContext)
    setRules(nextRules)
    setLineup(nextLineup)
    setStatus(`Changement manuel retiré à partir de la manche ${inning}. Les manches ${inning} à ${rules.inningsCount} ont été recalculées.`)
  }

  function saveCurrentMatch() {
    const entry = createMatchHistoryEntry(lineup, players, matchHistory.length)
    setMatchHistory((current) => [entry, ...current])
    setSelectedHistoryMatchId(entry.id)

    if (isSupabaseConfigured && authUser) {
      void saveMatchHistoryEntry(authUser.id, team, entry).catch((error) => {
        const message = error instanceof Error ? error.message : 'Erreur inconnue Supabase.'
        setStatus(`Erreur de sauvegarde du match dans Supabase: ${message}`)
      })
    }

    setStatus(`${entry.label} sauvegardé. Il peut maintenant servir de référence pour le prochain match.`)
  }

  function removeSavedMatch(matchId: string) {
    setMatchHistory((current) => current.filter((match) => match.id !== matchId))
    setStatus('Match sauvegardé supprimé de l’historique.')
  }

  function renameSavedMatch(matchId: string, label: string) {
    setMatchHistory((current) =>
      current.map((match) => (match.id === matchId ? { ...match, label: label.trim() || match.label } : match)),
    )
  }

  async function copyShareLink() {
    const shareState: PersistedAppState = {
      team,
      players,
      rules,
      manualOverrides,
      lockedOverrides,
      matchHistory,
      selectedHistoryMatchId,
      historyContextWindow,
    }
    const link = `${window.location.origin}${window.location.pathname}${encodeShareState(shareState)}`
    await window.navigator.clipboard.writeText(link)
    setStatus('Lien de match copié dans le presse-papiers.')
  }

  async function handleRegister() {
    if (!isSupabaseConfigured) {
      setAuthError('Supabase n’est pas configuré dans les variables d’environnement.')
      return
    }

    const email = authEmail.trim().toLowerCase()
    if (!email || !authPassword) {
      setAuthError('Email et mot de passe sont requis.')
      return
    }

    setAuthLoading(true)
    setAuthError(null)

    try {
      const user = await registerUser(email, authPassword)
      writeStoredSessionUser(user)
      setAuthUser(user)
      setStatus(`Compte créé: ${user.email}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue.'
      setAuthError(`Impossible de créer le compte: ${message}`)
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleLogin() {
    if (!isSupabaseConfigured) {
      setAuthError('Supabase n’est pas configuré dans les variables d’environnement.')
      return
    }

    const email = authEmail.trim().toLowerCase()
    if (!email || !authPassword) {
      setAuthError('Email et mot de passe sont requis.')
      return
    }

    setAuthLoading(true)
    setAuthError(null)

    try {
      const user = await loginUser(email, authPassword)
      writeStoredSessionUser(user)
      setAuthUser(user)
      setStatus(`Connecté: ${user.email}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur inconnue.'
      setAuthError(`Connexion impossible: ${message}`)
    } finally {
      setAuthLoading(false)
    }
  }

  function handleLogout() {
    writeStoredSessionUser(null)
    setAuthUser(null)
    setAuthPassword('')
    setAuthError(null)
    applyPersistedState(createEmptyPersistedState())
    setDbHydrationDone(!isSupabaseConfigured)
    setStatus('Session locale fermée.')
  }

  async function copySummary() {
    await window.navigator.clipboard.writeText(summary)
    setStatus('Résumé du lineup copié.')
  }

  function printLineup() {
    window.print()
    setStatus('Utilisez le dialogue d’impression pour exporter en PDF.')
  }

  async function handleTeamLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setStatus('Le logo doit être une image valide.')
      event.target.value = ''
      return
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'))
      reader.readAsDataURL(file)
    }).catch(() => '')

    if (!dataUrl) {
      setStatus('Erreur pendant le chargement du logo.')
      event.target.value = ''
      return
    }

    setTeam((current) => ({ ...current, logoUrl: dataUrl }))
    setStatus('Logo de l’équipe importé avec succès.')
    event.target.value = ''
  }

  function resetDemo() {
    const emptyState = createEmptyPersistedState()
    applyPersistedState(emptyState)
    setStatus('Équipe vidée.')
  }

  const requiresAuthBeforeEditing = isSupabaseConfigured && !authUser

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">⚾ Field Manager — Baseball intelligent</p>
          <h1>AutoLineup Baseball</h1>
          <TeamLogoBadge logoUrl={team.logoUrl} title={team.logoUrl ? 'Identité d’équipe active' : 'Ajoute ton logo pour personnaliser'} />
          <p className="lede">
            Gérez votre roster, configurez un match, générez un lineup optimisé par manche et ajustez-le
            manuellement sans perdre les contraintes clés.
          </p>
        </div>
        <TeamVisual logoUrl={team.logoUrl} size={96} />
        <div className="stack compact" style={{ minWidth: '320px' }}>
          <strong>Persistance Supabase</strong>
          {!isSupabaseConfigured ? (
            <p className="status-chip">Configure VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY pour activer la sauvegarde DB.</p>
          ) : authUser ? (
            <>
              <p className="status-chip">Connecté: {authUser.email}</p>
              <p className="status-chip">{dbHydrationDone ? 'Sync active' : 'Chargement DB en cours...'}</p>
              <button type="button" className="ghost" onClick={handleLogout}>
                Se déconnecter
              </button>
            </>
          ) : (
            <>
              <label>
                Email
                <input
                  type="email"
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="coach@equipe.com"
                />
              </label>
              <label>
                Mot de passe
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  placeholder="Mot de passe"
                />
              </label>
              {authError ? <p className="status-chip">{authError}</p> : null}
              <div className="stack compact" style={{ alignItems: 'flex-start' }}>
                <button type="button" onClick={handleLogin} disabled={authLoading}>
                  {authLoading ? 'Connexion...' : 'Se connecter'}
                </button>
                <button type="button" className="ghost" onClick={handleRegister} disabled={authLoading}>
                  {authLoading ? 'Création...' : 'Créer un compte'}
                </button>
              </div>
            </>
          )}
        </div>
        <div className="hero-actions">
          <button type="button" onClick={copyShareLink}>
            🔗 Copier le lien du match
          </button>
          <button type="button" onClick={copySummary}>
            📋 Copier le résumé
          </button>
          <button type="button" onClick={printLineup}>
            🖨️ Export PDF
          </button>
          <button type="button" className="ghost" onClick={resetDemo}>
            ↺ Réinitialiser la démo
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => document.getElementById('guide-section')?.scrollIntoView({ behavior: 'smooth' })}
          >
            📚 Comment ça marche ?
          </button>
        </div>
      </header>

      {requiresAuthBeforeEditing ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">🔒 Accès requis</p>
              <h2>Connecte-toi pour modifier l'équipe</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted, #666)', marginTop: '0.5rem' }}>
                La modification des joueurs, règles et lineups est verrouillée jusqu'à la connexion.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>

      <section className="grid two-columns">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <TeamLogoBadge logoUrl={team.logoUrl} title="Section équipe" />
              <p className="eyebrow">⚾ Étape 1</p>
              <h2>Configurer votre équipe</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted, #666)', marginTop: '0.5rem' }}>
                Créez votre équipe, ajoutez vos joueurs et définissez leurs positions.
              </p>
            </div>
            <button type="button" onClick={addPlayer}>
              Ajouter un joueur
            </button>
          </div>

          <div className="stack compact">
            <label>
              Nom de l’équipe
              <input
                value={team.name}
                onChange={(event) => setTeam((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Upload logo (image)
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  void handleTeamLogoUpload(event)
                }}
              />
            </label>
            {team.logoUrl ? (
              <div className="stack compact" style={{ alignItems: 'flex-start' }}>
                <img
                  src={team.logoUrl}
                  alt="Logo de l’équipe"
                  style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px' }}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setTeam((current) => ({ ...current, logoUrl: '' }))
                    setStatus('Logo retiré.')
                  }}
                >
                  Retirer le logo
                </button>
              </div>
            ) : null}
          </div>

          <div className="roster-list">
            {players.map((player) => (
              <section key={player.id} className="player-card">
                <div className="player-card-header">
                  <input
                    aria-label={`Nom ${player.id}`}
                    value={player.name}
                    onChange={(event) =>
                      updatePlayer(player.id, (current) => ({ ...current, name: event.target.value }))
                    }
                  />
                  <button type="button" className="ghost danger" onClick={() => removePlayer(player.id)}>
                    Retirer
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    Niveau
                    <select
                      value={player.flexibilityLevel}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          flexibilityLevel: event.target.value as FlexibilityLevel,
                        }))
                      }
                    >
                      <option value="starter">Starter</option>
                      <option value="absent">Absent</option>
                    </select>
                  </label>
                  <label>
                    Lock global
                    <select
                      value={player.lockedPosition ?? ''}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          lockedPosition: event.target.value ? (event.target.value as Position) : undefined,
                          lockedCanBench: event.target.value ? current.lockedCanBench ?? true : false,
                        }))
                      }
                    >
                      <option value="">Aucun</option>
                      {FIELD_POSITIONS.filter((position) => !(player.excludedPositions ?? []).includes(position)).map((position) => (
                        <option key={position} value={position}>
                          {positionLabel(position)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {player.lockedPosition ? (
                    <label>
                      Lock global: banc autorise
                      <select
                        value={player.lockedCanBench ? 'yes' : 'no'}
                        onChange={(event) =>
                          updatePlayer(player.id, (current) => ({
                            ...current,
                            lockedCanBench: event.target.value === 'yes',
                          }))
                        }
                      >
                        <option value="no">Non (toujours sur le terrain)</option>
                        <option value="yes">Oui (peut aller au banc)</option>
                      </select>
                    </label>
                  ) : null}
                  <label>
                    Primary
                    <select
                      value={toPositionSelectValue(player.positions.primary)}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          positions: { ...current.positions, primary: fromPositionSelectValue(event.target.value) },
                        }))
                      }
                    >
                      <option value="">Sélectionner</option>
                      <option value={OUTFIELD_GROUP_VALUE}>Outfield (LF, CF, RF)</option>
                      {FIELD_POSITIONS.filter((position) => !(player.excludedPositions ?? []).includes(position)).map((position) => (
                        <option key={`primary-${player.id}-${position}`} value={position}>
                          {positionLabel(position)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Secondary
                    <select
                      value={toPositionSelectValue(player.positions.secondary)}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          positions: { ...current.positions, secondary: fromPositionSelectValue(event.target.value) },
                        }))
                      }
                    >
                      <option value="">Aucun</option>
                      <option value={OUTFIELD_GROUP_VALUE}>Outfield (LF, CF, RF)</option>
                      {FIELD_POSITIONS.filter((position) => !(player.excludedPositions ?? []).includes(position)).map((position) => (
                        <option key={`secondary-${player.id}-${position}`} value={position}>
                          {positionLabel(position)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tertiary
                    <select
                      value={toPositionSelectValue(player.positions.tertiary)}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          positions: { ...current.positions, tertiary: fromPositionSelectValue(event.target.value) },
                        }))
                      }
                    >
                      <option value="">Aucun</option>
                      <option value={OUTFIELD_GROUP_VALUE}>Outfield (LF, CF, RF)</option>
                      {FIELD_POSITIONS.filter((position) => !(player.excludedPositions ?? []).includes(position)).map((position) => (
                        <option key={`tertiary-${player.id}-${position}`} value={position}>
                          {positionLabel(position)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="combobox-field">
                    <span className="combobox-field-label">Positions interdites</span>
                    <details className="multi-combobox">
                      <summary>
                        <span>{excludedPositionsSummary(player.excludedPositions)}</span>
                        <span className="combobox-hint">Cliquez pour choisir</span>
                      </summary>
                      <div className="multi-combobox-options">
                        {FIELD_POSITIONS.map((position) => {
                          const checked = (player.excludedPositions ?? []).includes(position)

                          return (
                            <label key={`excluded-${player.id}-${position}`} className="multi-combobox-option">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  updatePlayer(player.id, (current) => {
                                    const nextExcludedSet = new Set(current.excludedPositions ?? [])
                                    if (event.target.checked) {
                                      nextExcludedSet.add(position)
                                    } else {
                                      nextExcludedSet.delete(position)
                                    }

                                    return applyExcludedPositions(current, [...nextExcludedSet])
                                  })
                                }}
                              />
                              <span>{positionLabel(position)}</span>
                            </label>
                          )
                        })}
                      </div>
                    </details>
                  </div>
                  <label>
                      Groupe de positions (fallback)
                      <select
                      value={player.positions.general[0] ?? 'all_fields'}
                        onChange={(event) => {
                          const group = toGeneralGroup(event.target.value)
                          updatePlayer(player.id, (current) => ({
                            ...current,
                            positions: { ...current.positions, general: group ? [group] : [] },
                          }))
                        }}
                      >
                        <option value="infield">Intérieur (infield)</option>
                        <option value="outfield">Extérieur (outfield)</option>
                        <option value="outfield_catcher">Outfield + Catcher</option>
                        <option value="infield_catcher">Intérieur + Catcher</option>
                        <option value="all_fields">Partout (sans lanceur ni catcher)</option>
                        <option value="all_fields_catcher">Partout + Catcher (sans lanceur)</option>
                        <option value="all_positions">Partout + Catcher + Lanceur</option>
                      </select>
                  </label>
                </div>
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <TeamLogoBadge logoUrl={team.logoUrl} title="Section match" />
              <p className="eyebrow">⚙️ Étape 2</p>
              <h2>Configurer le match</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted, #666)', marginTop: '0.5rem' }}>
                Définissez les règles : manches, lanceur partant, rotation, etc. Après avoir généré l'alignement,
                vous pouvez changer le lanceur à tout moment dans la section des manches et l'alignement est
                recalculé automatiquement.
              </p>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Nombre de manches
              <input
                type="text"
                inputMode="numeric"
                value={inningsCountInput}
                onChange={(event) => {
                  const rawValue = event.target.value
                  setInningsCountInput(rawValue)
                  if (!rawValue.trim()) return

                  const parsed = Number(rawValue)
                  if (Number.isFinite(parsed) && parsed > 0) {
                    setRules((current) => {
                      const inningsCount = Math.trunc(parsed)
                      return {
                        ...current,
                        inningsCount,
                        pitcherChanges: normalizePitcherChanges(current.pitcherChanges, players, {
                          inningsCount,
                          pitcherId: current.pitcherId,
                        }),
                      }
                    })
                  }
                }}
              />
            </label>
            <label>
              Lanceur partant
              <select
                value={rules.pitcherId}
                onChange={(event) =>
                  setRules((current) => {
                    const pitcherId = Number(event.target.value)
                    return {
                      ...current,
                      pitcherId,
                      pitcherChanges: normalizePitcherChanges(current.pitcherChanges, players, {
                        inningsCount: current.inningsCount,
                        pitcherId,
                      }),
                    }
                  })
                }
                disabled={startingPitcherOptions.length === 0}
              >
                {startingPitcherOptions.length === 0 ? (
                  <option value="">Aucun lanceur éligible</option>
                ) : (
                  startingPitcherOptions.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label>
              Manches max du lanceur
              <input
                type="text"
                inputMode="numeric"
                value={maxPitcherInningsInput}
                onChange={(event) => {
                  const rawValue = event.target.value
                  setMaxPitcherInningsInput(rawValue)
                  if (!rawValue.trim()) return

                  const parsed = Number(rawValue)
                  if (Number.isFinite(parsed) && parsed > 0) {
                    setRules((current) => ({ ...current, maxPitcherInnings: Math.trunc(parsed) }))
                  }
                }}
              />
            </label>
            <label>
              Max manches au banc par match
              <input
                type="text"
                inputMode="numeric"
                value={maxConsecutiveBenchInput}
                onChange={(event) => {
                  const rawValue = event.target.value
                  setMaxConsecutiveBenchInput(rawValue)
                  if (!rawValue.trim()) return

                  const parsed = Number(rawValue)
                  if (Number.isFinite(parsed) && parsed > 0) {
                    setRules((current) => ({ ...current, maxConsecutiveBench: Math.trunc(parsed) }))
                  }
                }}
              />
            </label>
          </div>

        </article>
      </section>

      <section className="panel innings-print-section">
        <div className="panel-heading">
          <div>
            <TeamLogoBadge logoUrl={team.logoUrl} title="Section lineup" />
            <p className="eyebrow">📋 Étape 3</p>
            <h2>Générer et ajuster votre lineup</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted, #666)', marginTop: '0.5rem' }}>
              Parcourez les alignements par manche et affichez-les ou ajustez-les manuellement.
            </p>
          </div>
          <div className="stack compact lineup-actions" style={{ alignItems: 'flex-end' }}>
            <button type="button" onClick={generateCurrentLineup}>
              ⚡ Générer l'alignement
            </button>
            <button type="button" className="ghost" onClick={saveCurrentMatch}>
              💾 Sauvegarder ce match
            </button>
            <p className="status-chip">{status}</p>
          </div>
        </div>

        <div className="match-history-panel">
          <label>
            Match précédent à utiliser pour l'équité
            <select
              value={selectedHistoryMatchId ?? ''}
              onChange={(event) => setSelectedHistoryMatchId(event.target.value || undefined)}
            >
              <option value="">Aucun contexte chargé</option>
              {matchHistory.map((match) => (
                <option key={match.id} value={match.id}>
                  {match.label} · {new Date(match.createdAt).toLocaleDateString('fr-CA')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre de matchs pris en compte pour l’équité
            <select
              value={historyContextWindow}
              onChange={(event) => setHistoryContextWindow(Number(event.target.value))}
            >
              <option value={1}>1 match</option>
              <option value={2}>2 matchs</option>
              <option value={3}>3 matchs</option>
            </select>
          </label>
          {historyContextMatches.length > 0 ? (
            <p className="match-history-note">
              L'équité est calculée à partir de {historyContextMatches.length} match(s) sauvegardé(s), en partant de {(historyContextMatches[0]?.label ?? selectedHistoryMatch?.label ?? 'la dernière sauvegarde').toLowerCase()}.
            </p>
          ) : null}
          {matchHistory.length > 0 ? (
            <div className="match-history-list">
              {matchHistory.map((match) => (
                <div key={match.id} className="match-history-item">
                  <div>
                    <input
                      value={match.label}
                      onChange={(event) => renameSavedMatch(match.id, event.target.value)}
                      className="match-history-input"
                    />
                    <span>{new Date(match.createdAt).toLocaleString('fr-CA')}</span>
                  </div>
                  <div className="match-history-actions">
                    <button type="button" className="ghost" onClick={() => setSelectedHistoryMatchId(match.id)}>
                      Utiliser
                    </button>
                    <button type="button" className="ghost danger" onClick={() => removeSavedMatch(match.id)}>
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="match-history-note">Sauvegardez un match généré pour l'utiliser comme référence au prochain.</p>
          )}
        </div>

        <div className="lineup-grid">
          {lineup.innings.map((inning) => (
            <article key={inning.inning} className="inning-card">
              <div className="inning-card-header">
                <h3>Manche {inning.inning}</h3>
                <span className="inning-score">Score {inning.score}</span>
              </div>
              {inning.inning > 1 ? (
                <div className="pitcher-change-controls">
                  <label>
                    Lanceur dès cette manche
                    <select
                      value={pitcherChangeSelections[inning.inning] ?? getPitcherForInning(rules, inning.inning)}
                      onChange={(event) =>
                        setPitcherChangeSelections((current) => ({
                          ...current,
                          [inning.inning]: Number(event.target.value),
                        }))
                      }
                    >
                      {startingPitcherOptions.map((player) => (
                        <option key={`pitcher-change-${inning.inning}-${player.id}`} value={player.id}>
                          {player.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => applyPitcherChangeFromInning(inning.inning)}>
                    Changer le lanceur
                  </button>
                  {rules.pitcherChanges[inning.inning] !== undefined ? (
                    <button type="button" className="ghost" onClick={() => clearPitcherChangeFromInning(inning.inning)}>
                      Annuler
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="inning-table-wrap">
                <table className="lineup-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Joueur</th>
                    <th>Lock</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELD_POSITIONS.map((position) => {
                    const overrideKey = createOverrideKey(inning.inning, position)
                    return (
                      <tr key={position}>
                        <td><PosBadge position={position} /></td>
                        <td>
                          <select
                            value={manualOverrides[overrideKey] ?? inning.assignments[position]}
                            onChange={(event) =>
                              updateOverride(
                                inning.inning,
                                position,
                                event.target.value ? Number(event.target.value) : undefined,
                              )
                            }
                          >
                            {activePlayers.map((player) => (
                              <option key={player.id} value={player.id}>
                                {player.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={lockedOverrides.includes(overrideKey) ? 'active-lock' : 'ghost'}
                            onClick={() => toggleLockedOverride(inning.inning, position)}
                          >
                            {lockedOverrides.includes(overrideKey) ? 'Verrouillé' : 'Libre'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                </table>
              </div>
              <p className="bench-line">
                🪑 Dugout: {inning.bench.map((playerId) => playerNames[playerId]).join(', ') || 'Aucun'}
              </p>
              <ul className="notes-list">
                {inning.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="guide-section" className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">📚 Étape 0 (optionnelle)</p>
            <h2>Comprendre le système</h2>
          </div>
        </div>

        <div className="stack compact">
          <div style={{ marginBottom: '1.5rem' }}>
            <h3>⚾ Profil du joueur</h3>
            <ul style={{ fontSize: '0.9rem', lineHeight: '1.6' }}>
              <li>
                <strong>Niveau</strong> : Priorité du joueur dans le calcul.
                <ul style={{ marginTop: '0.3rem', marginBottom: '0' }}>
                  <li><strong>Starter</strong> : Joueur titulaire, bonus de flexibilité appliqué</li>
                  <li><strong>Absent</strong> : Joueur indisponible, exclu du calcul</li>
                </ul>
              </li>
              <li>
                <strong>Lock global</strong> : Si défini, le joueur est limité à cette position uniquement.
                <ul style={{ marginTop: '0.3rem', marginBottom: '0' }}>
                  <li><strong>Banc interdit</strong> (No) : Le joueur doit jouer cette position à chaque manche</li>
                  <li><strong>Banc autorisé</strong> (Yes) : Le joueur peut être au banc, mais ne jouera jamais une autre position</li>
                </ul>
              </li>
              <li>
                <strong>Primary / Secondary / Tertiary</strong> : Positions où le joueur peut jouer, avec des scores de compatibilité décroissants (100 / 70 / 40). Le moteur préfère Primary, puis Secondary, puis Tertiary.
              </li>
              <li>
                <strong>Groupe de positions (fallback)</strong> : Si aucune position spécifique n'est libre, le moteur peut utiliser ce groupe avec un score faible (30). Options :
                <ul style={{ marginTop: '0.5rem' }}>
                  <li><strong>Infield</strong> : 1B, 2B, 3B, SS</li>
                  <li><strong>Outfield</strong> : LF, CF, RF</li>
                  <li><strong>Outfield + Catcher</strong> : LF, CF, RF, C</li>
                  <li><strong>Infield + Catcher</strong> : 1B, 2B, 3B, SS, C</li>
                  <li><strong>All Fields</strong> : Toutes positions sauf P et C</li>
                  <li><strong>All Fields + Catcher</strong> : Toutes positions sauf P</li>
                  <li><strong>All Positions</strong> : P, C, 1B, 2B, 3B, SS, LF, CF, RF (vraiment toutes)</li>
                </ul>
              </li>
              <li>
                <strong>Positions exclues</strong> : Positions où le joueur ne peut JAMAIS jouer (incompatibilité totale). Utile pour les joueurs spécialisés.
              </li>
            </ul>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3>⚙️ Paramètres du match</h3>
            <ul style={{ fontSize: '0.9rem', lineHeight: '1.6' }}>
              <li>
                <strong>Nombre de manches</strong> : Durée totale du match (ex: 6 manches).
              </li>
              <li>
                <strong>Lanceur principal</strong> : Le joueur qui lance au début du match. Le moteur le place au monticule à chaque manche jusqu'à atteindre sa limite d'innings.
              </li>
              <li>
                <strong>Manches max du lanceur</strong> : Limite d'innings que le lanceur principal peut lancer avant d'être remplacé (ex: 4 manches max).
              </li>
              <li>
                <strong>Changements de lanceur</strong> : Définies une fois le lineup généré. Permets de programmer des changements de lanceur à des manches spécifiques.
              </li>
              <li>
                <strong>Max manches consécutives au banc</strong> : Seuil d'inactivité. Une fois qu'un joueur a passé ce nombre de manches au banc, il devient prioritaire pour jouer à la prochaine manche disponible.
              </li>
              <li>
                <strong>Priorité receveur</strong> : Si activée, donne un bonus aux joueurs spécialisés au poste de C (leur Primary ou Secondary position inclut C).
              </li>
            </ul>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3>🧮 Comment le score de lineup est calculé</h3>
            <p style={{ fontSize: '0.9rem', marginBottom: '0.8rem' }}>
              Pour chaque joueur à chaque position à chaque manche, le moteur calcule un score combinant plusieurs facteurs :
            </p>
            <ol style={{ fontSize: '0.9rem', lineHeight: '1.8', paddingLeft: '1.5rem' }}>
              <li>
                <strong>Score de compatibilité position</strong> (base) :
                <ul style={{ marginTop: '0.3rem', marginBottom: '0.3rem' }}>
                  <li>Primary : +100</li>
                  <li>Secondary : +70</li>
                  <li>Tertiary : +40</li>
                  <li>Groupe de positions : +30</li>
                  <li>Incompatible/Exclu : -1000</li>
                </ul>
              </li>
              <li>
                <strong>Bonus flexibilité</strong> : Défini une seule fois par joueur
                <ul style={{ marginTop: '0.3rem', marginBottom: '0.3rem' }}>
                  <li>Starter : +1</li>
                  <li>Absent : -1000 (exclu du calcul)</li>
                </ul>
              </li>
              <li>
                <strong>Bonus équilibre temps de jeu</strong> : (manches restantes - manches jouées) × 8
                <br/><span style={{ fontSize: '0.85rem' }}>Plus un joueur a joué, moins il a de bonus</span>
              </li>
              <li>
                <strong>Bonus retour du banc</strong> : +18 si le joueur était au banc à la manche précédente
              </li>
              <li>
                <strong>Bonus équité inter-match</strong> : Basé sur le temps de banc des matchs précédents (bonus/pénalité jusqu'à ±120)
              </li>
              <li>
                <strong>Pénalité répétition position</strong> : -(nombre de fois répétée × 4) si le joueur garde la même position que la manche précédente
              </li>
              <li>
                <strong>Bonus priorité receveur</strong> (si activé) : +25 pour les spécialistes du poste C, -25 sinon
              </li>
            </ol>
            <p style={{ fontSize: '0.85rem', marginTop: '0.8rem', color: 'var(--muted, #666)' }}>
              Le moteur cherche la meilleure combinaison de 9 joueurs (1 par position) qui maximise le score total, tout en respectant les contraintes (pitcher dédié, locks globaux, max innings au banc, etc). La recherche est optimisée pour trouver rapidement une solution satisfaisante.
            </p>
          </div>

          <div>
            <h3>💡 Conseils d'utilisation</h3>
            <ul style={{ fontSize: '0.9rem', lineHeight: '1.6' }}>
              <li>Définissez <strong>Primary</strong> pour la meilleure position, <strong>Secondary</strong> pour l'alternative, et <strong>Tertiary</strong> pour les cas d'urgence.</li>
              <li>Utilisez <strong>Lock global</strong> seulement si un joueur ne peut jouer que d'une seule position (ex: lanceur spécialisé).</li>
              <li>Niveau <strong>Starter</strong> pour les titulaires, <strong>Absent</strong> pour les indisponibles.</li>
              <li>Le groupe de positions est un filet de secours : privilégiez toujours les positions spécifiques (Primary/Secondary/Tertiary).</li>
              <li>Pour une équité optimale inter-match, utilisez l'historique des matchs et le contexte de fenêtre pour mémoriser le temps de jeu passé.</li>
              <li><strong>Positions exclues</strong> utiles pour forcer certaines restrictions (ex: un lanceur ne peut pas jouer en champ).</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="grid two-columns">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <TeamLogoBadge logoUrl={team.logoUrl} title="Analyse équipe" />
              <p className="eyebrow">📊 Étape 4</p>
              <h2>Voir les résultats</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted, #666)', marginTop: '0.5rem' }}>
                Vérifiez le temps de jeu et l'équité de la rotation.
              </p>
            </div>
          </div>
          <p>
            Chaque case du tableau est éditable. Activez un verrou pour forcer la réutilisation d’une assignation à
            la prochaine régénération automatique.
          </p>
          <div className="metrics-grid">
            {players.map((player) => (
              <div key={player.id} className="metric-card">
                <strong>{player.name}</strong>
                <span>⏱ {lineup.totals[player.id] ?? 0} manches jouées</span>
                <span>
                  🔒 Lock : {player.lockedPosition
                    ? `${player.lockedPosition} (${player.lockedCanBench ? 'banc autorise' : 'sans banc'})`
                    : 'aucun'}
                </span>
                {player.flexibilityLevel === 'absent' ? (
                  <span className="priority-note absent">🚫 Absent (hors calcul)</span>
                ) : null}
                {interMatchBenchPriorityPlayers.has(player.id) && player.flexibilityLevel !== 'absent' ? (
                  remainingBenchPriorityPlayers.has(player.id) ? (
                    <span className="priority-note pending">⏳ Priorité banc inter-match: doit encore passer au banc</span>
                  ) : (
                    <span className="priority-note done">✅ Priorité banc inter-match: déjà passé au banc</span>
                  )
                ) : null}
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <TeamLogoBadge logoUrl={team.logoUrl} title="Vision produit" />
              <p className="eyebrow">🚀 Bonus</p>
              <h2>Roadmap produit</h2>
            </div>
          </div>
          <div className="roadmap">
            <div>
              <h3>MVP</h3>
              <ul>
                <li>Gestion équipe / roster</li>
                <li>Scoring primary-secondary-tertiary</li>
                <li>Pitcher, catcher, joueurs fixes, banc</li>
              </ul>
            </div>
            <div>
              <h3>V1</h3>
              <ul>
                <li>Persistance Supabase complète</li>
                <li>Éditeur drag & drop avancé</li>
                <li>Export PDF enrichi</li>
              </ul>
            </div>
            <div>
              <h3>V2 / V3</h3>
              <ul>
                <li>Multi-ligues et templates de règles</li>
                <li>Moteur optimisé multi-sport</li>
                <li>Coaching assisté par IA</li>
              </ul>
            </div>
          </div>
        </article>
      </section>

      {/* Sticky bottom bar — visible only on mobile via CSS */}
      <div className="mobile-sticky-bar">
        <button type="button" onClick={generateCurrentLineup}>
          ⚡ Générer
        </button>
        <button type="button" className="ghost" onClick={saveCurrentMatch}>
          💾 Sauvegarder
        </button>
      </div>

        </>
      )}
    </div>
  )
}

export default App
