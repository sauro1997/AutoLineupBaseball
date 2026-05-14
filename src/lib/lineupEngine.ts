import {
  FIELD_POSITIONS,
  POSITION_SCORES,
  createOverrideKey,
  flexibilityWeights,
  type ExportedLineup,
  type GeneralPositionGroup,
  type InningAssignment,
  type LineupResult,
  type ManualOverrideMap,
  type MatchRules,
  type Player,
  type Position,
  type PreviousMatchContext,
  type Team,
} from '../domain'

type PlayerState = {
  inningsPlayed: number
  inningsPitched: number
  consecutiveBench: number
  benchInnings: number
  previousMatchAverageBenchInnings: number
  lastPosition?: Position
  repeatedPositionCount: number
  benchLastInning: boolean
}

type SearchState = {
  bestAssignments: Record<Position, number> | null
  bestScore: number
  bestMandatorySatisfied: number
  bestPreferredOnFieldSatisfied: number
}

type AssignmentSearchResult = {
  assignments: Record<Position, number>
  score: number
  requiredOnFieldApplied: boolean
  forcedOnFieldApplied: boolean
}

const INFIELD_POSITIONS: Position[] = ['1B', '2B', '3B', 'SS']
const OUTFIELD_POSITIONS: Position[] = ['LF', 'CF', 'RF']

function matchesGeneralGroup(group: GeneralPositionGroup, position: Position) {
  if (group === 'infield') return INFIELD_POSITIONS.includes(position)
  if (group === 'outfield') return OUTFIELD_POSITIONS.includes(position)
  if (group === 'outfield_catcher') return position === 'C' || OUTFIELD_POSITIONS.includes(position)
  if (group === 'infield_catcher') return position === 'C' || INFIELD_POSITIONS.includes(position)
  if (group === 'all_fields') return position !== 'P' && position !== 'C'
  if (group === 'all_fields_catcher') return position !== 'P'
  if (group === 'all_positions') return true
  return false
}

function buildInitialPlayerState(players: Player[], previousMatchContext?: PreviousMatchContext) {
  return new Map<number, PlayerState>(
    players.map((player) => [
      player.id,
      {
        inningsPlayed: 0,
        inningsPitched: 0,
        consecutiveBench: 0,
        benchInnings: 0,
        previousMatchAverageBenchInnings: previousMatchContext
          ? (previousMatchContext.benchTotals[player.id] ?? 0) / Math.max(previousMatchContext.matchCount, 1)
          : 0,
        repeatedPositionCount: 0,
        benchLastInning: false,
      } as PlayerState,
    ]),
  )
}

function isActivePlayer(player: Player) {
  return player.flexibilityLevel !== 'absent'
}

function getCompatibilityScore(player: Player, position: Position) {
  if (player.excludedPositions?.includes(position)) return POSITION_SCORES.incompatible
  if (player.positions.primary.includes(position)) return POSITION_SCORES.primary
  if (player.positions.secondary.includes(position)) return POSITION_SCORES.secondary
  if (player.positions.tertiary.includes(position)) return POSITION_SCORES.tertiary
  if (player.positions.general.some((group) => matchesGeneralGroup(group, position))) return POSITION_SCORES.category

  return POSITION_SCORES.incompatible
}

function getPlayerBonus(player: Player, playerState: PlayerState, position: Position, inning: number) {
  const balanceBonus = Math.max(0, inning - 1 - playerState.inningsPlayed) * 8
  const benchRecoveryBonus = playerState.benchLastInning ? 18 : 0
  const interMatchFairnessBonus =
    playerState.previousMatchAverageBenchInnings > 0 ? playerState.previousMatchAverageBenchInnings * 10 : -18
  const firstInningInterMatchBonus =
    inning === 1
      ? playerState.previousMatchAverageBenchInnings > 0
        ? 35
        : -120
      : 0
  const flexibilityBonus = flexibilityWeights[player.flexibilityLevel]
  const repeatPenalty = playerState.lastPosition === position ? playerState.repeatedPositionCount * 4 : 0

  return (
    balanceBonus +
    benchRecoveryBonus +
    interMatchFairnessBonus +
    firstInningInterMatchBonus +
    flexibilityBonus -
    repeatPenalty
  )
}

function getAssignmentScore(
  player: Player,
  playerState: PlayerState,
  position: Position,
  inning: number,
  rules: MatchRules,
) {
  const compatibility = getCompatibilityScore(player, position)
  const catcherPriorityBonus =
    rules.prioritizeCatcher && position === 'C'
      ? player.positions.primary.includes('C') || player.positions.secondary.includes('C')
        ? 25
        : -25
      : 0

  return compatibility + getPlayerBonus(player, playerState, position, inning) + catcherPriorityBonus
}

function getDesignatedPitcherId(rules: MatchRules, inning: number) {
  const scheduledChangeEntries = Object.entries(rules.pitcherChanges ?? {})
    .map(([changeInning, pitcherId]) => [Number(changeInning), pitcherId] as const)
    .filter(
      (entry): entry is readonly [number, number] =>
        Number.isInteger(entry[0]) && entry[0] > 1 && typeof entry[1] === 'number',
    )
    .sort((left, right) => left[0] - right[0])

  let designatedPitcherId = rules.pitcherId
  for (const [changeInning, pitcherId] of scheduledChangeEntries) {
    if (changeInning > inning) break
    designatedPitcherId = pitcherId
  }

  return designatedPitcherId
}

function getLockedPitcherId(playerStates: Map<number, PlayerState>, rules: MatchRules, inning: number) {
  const designatedPitcherId = getDesignatedPitcherId(rules, inning)
  const designatedPitcherState = playerStates.get(designatedPitcherId)
  if (!designatedPitcherState) return undefined

  if (designatedPitcherId === rules.pitcherId && designatedPitcherState.inningsPitched >= rules.maxPitcherInnings) {
    return undefined
  }

  return designatedPitcherId
}

function isManualPitcherChangeInning(rules: MatchRules, inning: number) {
  return inning > 1 && rules.pitcherChanges[inning] !== undefined
}

function canTakePosition(
  player: Player,
  position: Position,
  rules: MatchRules,
  playerState: PlayerState,
  lockedPitcherId: number | undefined,
  forcedPlayerId?: number,
) {
  const isLockedPitcherException = position === 'P' && lockedPitcherId !== undefined && player.id === lockedPitcherId

  if (forcedPlayerId !== undefined && player.id !== forcedPlayerId) return false
  if (player.lockedPosition && player.lockedPosition !== position && !isLockedPitcherException) return false
  if (position === 'P' && lockedPitcherId !== undefined && player.id !== lockedPitcherId) return false
  if (position === 'P' && player.id === rules.pitcherId && playerState.inningsPitched >= rules.maxPitcherInnings) return false
  if (rules.fixedCenterField) {
    const fixedForPosition = rules.fixedAssignments.find((assignment) => assignment.position === position)
    if (fixedForPosition && player.id !== fixedForPosition.playerId) return false
  }

  return getCompatibilityScore(player, position) > POSITION_SCORES.incompatible
}

function mandatoryPlayers(playerStates: Map<number, PlayerState>, rules: MatchRules) {
  return new Set(
    [...playerStates.entries()]
      .filter(([, state]) => rules.maxConsecutiveBench > 0 && state.benchInnings >= rules.maxConsecutiveBench)
      .map(([playerId]) => playerId),
  )
}

function generateBestAssignments(
  players: Player[],
  rules: MatchRules,
  playerStates: Map<number, PlayerState>,
  inning: number,
  lockedAssignments: Record<Position, number>,
  forcedOnFieldPlayers: Set<number> = new Set<number>(),
) : AssignmentSearchResult {
  const mandatoryReturners = mandatoryPlayers(playerStates, rules)
  const mandatoryOnFieldPlayers = new Set<number>([...mandatoryReturners, ...forcedOnFieldPlayers])
  const lockedPitcherId = getLockedPitcherId(playerStates, rules, inning)
  const playersById = Object.fromEntries(players.map((player) => [player.id, player]))
  const sanitizedLockedAssignments = {} as Record<Position, number>
  const seededAssignments = {} as Record<Position, number>
  const seededPlayers = new Set<number>()

  for (const [position, playerId] of Object.entries(lockedAssignments) as Array<[Position, number]>) {
    if (seededPlayers.has(playerId)) continue
    sanitizedLockedAssignments[position] = playerId
    seededAssignments[position] = playerId
    seededPlayers.add(playerId)
  }

  const candidateMatrix = FIELD_POSITIONS.map((position) => {
    if (seededAssignments[position]) {
      return { position, candidates: [playersById[seededAssignments[position]] as Player] }
    }

    const forcedPlayerId = sanitizedLockedAssignments[position]
    const rankedCandidates = players
      .filter((player) =>
        canTakePosition(player, position, rules, playerStates.get(player.id)!, lockedPitcherId, forcedPlayerId),
      )
      .sort((left, right) => {
        const leftScore = getAssignmentScore(left, playerStates.get(left.id)!, position, inning, rules)
        const rightScore = getAssignmentScore(right, playerStates.get(right.id)!, position, inning, rules)

        return rightScore - leftScore
      })

    return { position, candidates: rankedCandidates }
  }).sort((left, right) => left.candidates.length - right.candidates.length)

  function runSearch(preferredOnField?: Set<number>) {
    const state: SearchState = {
      bestAssignments: null,
      bestScore: Number.NEGATIVE_INFINITY,
      bestMandatorySatisfied: -1,
      bestPreferredOnFieldSatisfied: -1,
    }

    function search(index: number, assignments: Record<Position, number>, usedPlayers: Set<number>, score: number) {
      if (index === candidateMatrix.length) {
        const mandatorySatisfied = [...mandatoryOnFieldPlayers].filter((playerId) => usedPlayers.has(playerId)).length
        const preferredOnFieldSatisfied = preferredOnField
          ? [...preferredOnField].filter((playerId) => usedPlayers.has(playerId)).length
          : 0
        if (
          mandatorySatisfied > state.bestMandatorySatisfied ||
          (mandatorySatisfied === state.bestMandatorySatisfied && (
            preferredOnFieldSatisfied > state.bestPreferredOnFieldSatisfied ||
            (preferredOnFieldSatisfied === state.bestPreferredOnFieldSatisfied && score > state.bestScore)
          ))
        ) {
          state.bestMandatorySatisfied = mandatorySatisfied
          state.bestPreferredOnFieldSatisfied = preferredOnFieldSatisfied
          state.bestScore = score
          state.bestAssignments = { ...assignments }
        }
        return
      }

      const { position, candidates } = candidateMatrix[index]
      for (const candidate of candidates) {
        if (usedPlayers.has(candidate.id)) continue

        const compatibility = getCompatibilityScore(candidate, position)
        if (compatibility <= POSITION_SCORES.incompatible) continue

        const playerState = playerStates.get(candidate.id)!
        const candidateScore = getAssignmentScore(candidate, playerState, position, inning, rules)

        assignments[position] = candidate.id
        usedPlayers.add(candidate.id)
        search(index + 1, assignments, usedPlayers, score + candidateScore)
        usedPlayers.delete(candidate.id)
        delete assignments[position]
      }
    }

    const initialScore = Object.entries(seededAssignments).reduce((total, [position, playerId]) => {
      const player = playersById[playerId]
      return total + getAssignmentScore(player, playerStates.get(playerId)!, position as Position, inning, rules)
    }, 0)

    search(0, { ...seededAssignments }, new Set(seededPlayers), initialScore)
    return state
  }

  const playersNeedingBenchPriority = players
    .filter((player) => {
      const state = playerStates.get(player.id)
      return state ? state.previousMatchAverageBenchInnings === 0 && state.benchInnings === 0 : false
    })
    .map((player) => player.id)
  const requiredOnFieldPlayers = new Set(
    players
      .filter((player) => !playersNeedingBenchPriority.includes(player.id))
      .map((player) => player.id),
  )

  const shouldTryBenchPriority =
    playersNeedingBenchPriority.length > 0 && requiredOnFieldPlayers.size <= FIELD_POSITIONS.length

  const normalState = shouldTryBenchPriority ? runSearch(requiredOnFieldPlayers) : runSearch()
  const strictBenchPriorityApplied = shouldTryBenchPriority
    ? normalState.bestPreferredOnFieldSatisfied === requiredOnFieldPlayers.size
    : false

  if (!normalState.bestAssignments) {
    const fallbackAssignments = {} as Record<Position, number>
    const availablePlayers = new Set(players.map((player) => player.id))

    for (const { position } of candidateMatrix) {
      const forcedPlayerId = lockedAssignments[position]
      const forcedCandidate =
        forcedPlayerId &&
        availablePlayers.has(forcedPlayerId) &&
        canTakePosition(
          playersById[forcedPlayerId],
          position,
          rules,
          playerStates.get(forcedPlayerId)!,
          lockedPitcherId,
          forcedPlayerId,
        )
          ? forcedPlayerId
          : undefined

      const compatibleCandidates = [...availablePlayers].filter(
        (playerId) =>
          canTakePosition(
            playersById[playerId],
            position,
            rules,
            playerStates.get(playerId)!,
            lockedPitcherId,
            forcedPlayerId,
          ),
      )

      const selectedPlayerId = forcedCandidate
        ? forcedCandidate
        : compatibleCandidates.sort((left, right) => {
            const leftPlayer = playersById[left]
            const rightPlayer = playersById[right]
            const leftMandatory = mandatoryOnFieldPlayers.has(left) ? 1 : 0
            const rightMandatory = mandatoryOnFieldPlayers.has(right) ? 1 : 0
            if (leftMandatory !== rightMandatory) return rightMandatory - leftMandatory
            const leftPreviousBench = playerStates.get(left)!.previousMatchAverageBenchInnings
            const rightPreviousBench = playerStates.get(right)!.previousMatchAverageBenchInnings
            if (leftPreviousBench !== rightPreviousBench) return rightPreviousBench - leftPreviousBench
            const leftBench = playerStates.get(left)!.benchInnings
            const rightBench = playerStates.get(right)!.benchInnings
            if (leftBench !== rightBench) return rightBench - leftBench
            return getCompatibilityScore(rightPlayer, position) - getCompatibilityScore(leftPlayer, position)
          })[0]

      if (selectedPlayerId === undefined) {
        // Aucune solution compatible pour cette position avec les contraintes actuelles.
        const partialScore = Object.entries(fallbackAssignments).reduce(
          (sum, [pos, pid]) => sum + getCompatibilityScore(playersById[pid], pos as Position),
          0,
        )
        return {
          assignments: normalState.bestAssignments ?? ({} as Record<Position, number>),
          score: partialScore,
          requiredOnFieldApplied: false,
          forcedOnFieldApplied: false,
        }
      }

      fallbackAssignments[position] = selectedPlayerId
      availablePlayers.delete(selectedPlayerId)
    }

    const fallbackScore = Object.entries(fallbackAssignments).reduce(
      (sum, [pos, pid]) => sum + getCompatibilityScore(playersById[pid], pos as Position),
      0,
    )

    return {
      assignments: fallbackAssignments,
      score: fallbackScore,
      requiredOnFieldApplied: false,
      forcedOnFieldApplied:
        forcedOnFieldPlayers.size === 0 ||
        [...forcedOnFieldPlayers].every((playerId) => Object.values(fallbackAssignments).includes(playerId)),
    }
  }

  return {
    assignments: normalState.bestAssignments,
    score: normalState.bestScore,
    requiredOnFieldApplied: strictBenchPriorityApplied,
    forcedOnFieldApplied:
      forcedOnFieldPlayers.size === 0 ||
      [...forcedOnFieldPlayers].every((playerId) => Object.values(normalState.bestAssignments!).includes(playerId)),
  }
}

function buildLockedAssignments(
  inning: number,
  players: Player[],
  rules: MatchRules,
  playerStates: Map<number, PlayerState>,
  manualOverrides: ManualOverrideMap,
) {
  const lockedAssignments: Partial<Record<Position, number>> = {}

  const lockedPitcherId = getLockedPitcherId(playerStates, rules, inning)
  if (lockedPitcherId !== undefined) {
    lockedAssignments.P = lockedPitcherId
  }

  if (rules.fixedCenterField) {
    for (const assignment of rules.fixedAssignments) {
      lockedAssignments[assignment.position] = assignment.playerId
    }
  }

  for (const player of players) {
    if (player.lockedPosition && !player.lockedCanBench) {
      if (lockedPitcherId !== undefined && player.id === lockedPitcherId && player.lockedPosition !== 'P') {
        // Si ce joueur est impose lanceur pour cette manche, ne pas le forcer
        // simultanement sur une autre position verrouillee.
        continue
      }
      lockedAssignments[player.lockedPosition] = player.id
    }
  }

  for (const position of FIELD_POSITIONS) {
    const overrideKey = createOverrideKey(inning, position)
    const playerId = manualOverrides[overrideKey]
    if (playerId !== undefined) lockedAssignments[position] = playerId
  }

  return lockedAssignments as Record<Position, number>
}

function getCatcherPriorityNote(players: Player[], inning: InningAssignment, rules: MatchRules) {
  if (!rules.prioritizeCatcher) return undefined

  const catcher = players.find((player) => player.id === inning.assignments.C)
  if (!catcher) return undefined

  if (catcher.positions.primary.includes('C') || catcher.positions.secondary.includes('C')) {
    return `Receveur priorisé: ${catcher.name}`
  }

  return `Receveur de secours utilisé: ${catcher.name}`
}

function getPitcherReliefNote(
  players: Player[],
  assignments: Record<Position, number>,
  rules: MatchRules,
  playerStates: Map<number, PlayerState>,
  inning: number,
) {
  const assignedPitcherId = assignments.P
  const designatedPitcherId = getDesignatedPitcherId(rules, inning)
  const assignedPitcher = players.find((player) => player.id === assignedPitcherId)
  const designatedPitcher = players.find((player) => player.id === designatedPitcherId)
  if (!assignedPitcher || !designatedPitcher) return undefined

  const previousDesignatedPitcherId = inning > 1 ? getDesignatedPitcherId(rules, inning - 1) : rules.pitcherId
  if (isManualPitcherChangeInning(rules, inning) && assignedPitcherId === designatedPitcherId && designatedPitcherId !== previousDesignatedPitcherId) {
    return `Changement manuel: ${assignedPitcher.name} prend le monticule dès la manche ${inning}.`
  }

  if (assignedPitcherId === designatedPitcherId) return undefined

  const designatedPitcherState = playerStates.get(designatedPitcherId)
  if (!designatedPitcherState) return undefined
  if (designatedPitcherId !== rules.pitcherId) return undefined
  if (designatedPitcherState.inningsPitched < rules.maxPitcherInnings) return undefined

  return `Relève auto: ${designatedPitcher.name} a atteint la limite (${rules.maxPitcherInnings}), ${assignedPitcher.name} prend le monticule.`
}

export function generateLineupLocally(
  players: Player[],
  rules: MatchRules,
  manualOverrides: ManualOverrideMap = {},
  lockedOverrideKeys: string[] = [],
  previousMatchContext?: PreviousMatchContext,
): LineupResult {
  const activePlayers = players.filter((player) => isActivePlayer(player))
  const playerStates = buildInitialPlayerState(activePlayers, previousMatchContext)
  const playerIds = new Set(activePlayers.map((player) => player.id))
  const innings: InningAssignment[] = []
  const lockedOverrides = new Set(lockedOverrideKeys)

  for (let inning = 1; inning <= rules.inningsCount; inning += 1) {
    const forcedOnFieldPlayers =
      inning === rules.inningsCount
        ? new Set(activePlayers.filter((player) => player.noBenchLastInning).map((player) => player.id))
        : new Set<number>()
    const lockedAssignments = buildLockedAssignments(inning, activePlayers, rules, playerStates, manualOverrides)
    const { assignments, score, requiredOnFieldApplied, forcedOnFieldApplied } = generateBestAssignments(
      activePlayers,
      rules,
      playerStates,
      inning,
      lockedAssignments,
      forcedOnFieldPlayers,
    )
    const lockedCount = FIELD_POSITIONS.filter((position) =>
      lockedOverrides.has(createOverrideKey(inning, position)),
    ).length

    for (const position of FIELD_POSITIONS) {
      const overrideKey = createOverrideKey(inning, position)
      const overridePlayerId = manualOverrides[overrideKey]
      if (
        overridePlayerId !== undefined &&
        playerIds.has(overridePlayerId) &&
        getCompatibilityScore(activePlayers.find((player) => player.id === overridePlayerId)!, position) > POSITION_SCORES.incompatible
      ) {
        assignments[position] = overridePlayerId
      }
    }

    const usedPlayers = new Set(Object.values(assignments))
    const bench = activePlayers.filter((player) => !usedPlayers.has(player.id)).map((player) => player.id)
    const notes = [] as string[]
    const pitcherReliefNote = getPitcherReliefNote(activePlayers, assignments, rules, playerStates, inning)
    if (pitcherReliefNote) notes.push(pitcherReliefNote)

    for (const player of activePlayers) {
      const state = playerStates.get(player.id)!
      if (usedPlayers.has(player.id)) {
        state.inningsPlayed += 1
        state.benchLastInning = false
        state.consecutiveBench = 0

        const assignedPosition = Object.entries(assignments).find(([, playerId]) => playerId === player.id)?.[0] as
          | Position
          | undefined

        if (assignedPosition === 'P') {
          state.inningsPitched += 1
        }

        if (state.lastPosition === assignedPosition && assignedPosition) {
          state.repeatedPositionCount += 1
        } else {
          state.repeatedPositionCount = 1
        }

        state.lastPosition = assignedPosition
      } else {
        state.benchLastInning = true
        state.consecutiveBench += 1
        state.benchInnings += 1
      }
    }

    const catcherNote = getCatcherPriorityNote(activePlayers, { inning, assignments, bench, score, notes }, rules)
    if (catcherNote) notes.push(catcherNote)

    if (bench.length > 0) {
      notes.push(`Banc: ${bench.length} joueur(s)`)
    }

    const playersStillNeedingFirstBench = activePlayers.filter((player) => {
      const state = playerStates.get(player.id)
      return state ? state.previousMatchAverageBenchInnings === 0 && state.benchInnings === 0 : false
    }).length

    if (playersStillNeedingFirstBench > 0 && requiredOnFieldApplied) {
      notes.push('Priorité banc inter-match appliquée: passage prioritaire au banc pour les joueurs jamais passés au banc au match précédent.')
    }

    if (playersStillNeedingFirstBench > 0 && !requiredOnFieldApplied && inning === 1) {
      notes.push('Priorité banc inter-match partielle: certaines contraintes de positions empêchent l’application stricte.')
    }

    if (inning === rules.inningsCount && forcedOnFieldPlayers.size > 0) {
      if (forcedOnFieldApplied) {
        notes.push('Option defensive appliquee: joueurs proteges du banc sur la derniere manche.')
      } else {
        notes.push('Option defensive partielle: impossible de garder tous les joueurs proteges hors du banc avec les contraintes actuelles.')
      }
    }

    if (inning === 1 && previousMatchContext) {
      notes.push(`Équité inter-match active sur ${previousMatchContext.matchCount} match(s) précédent(s).`)
    }

    if (lockedCount > 0) {
      notes.push(`${lockedCount} override(s) verrouillé(s)`)
    }

    innings.push({ inning, assignments, bench, score, notes })
  }

  const totals = Object.fromEntries(
    players.map((player) => [player.id, player.flexibilityLevel === 'absent' ? 0 : (playerStates.get(player.id)?.inningsPlayed ?? 0)]),
  )

  return { innings, totals }
}

export function summarizeLineup(lineup: LineupResult, players: Player[]) {
  const names = Object.fromEntries(players.map((player) => [player.id, player.name]))

  return lineup.innings
    .map((inning) => {
      const assignments = FIELD_POSITIONS.map(
        (position) => `${position}: ${names[inning.assignments[position]] ?? '—'}`,
      ).join(' | ')
      const bench = inning.bench.map((playerId) => names[playerId]).join(', ') || 'Aucun'
      return `Manche ${inning.inning} — ${assignments} — Banc: ${bench}`
    })
    .join('\n')
}

export function exportLineupToJSON(
  lineup: LineupResult,
  team: Team,
  players: Player[],
  inningsCount: number,
): ExportedLineup {
  return {
    version: '1.0',
    exported_at: new Date().toISOString(),
    team: {
      id: team.id,
      name: team.name,
    },
    inningsCount,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      positions: p.positions,
      flexibilityLevel: p.flexibilityLevel,
    })),
    lineup,
  }
}

export function exportLineupToCSV(lineup: LineupResult, players: Player[]): string {
  const playerNames = Object.fromEntries(players.map((p) => [p.id, p.name]))
  const rows: string[] = []

  // Header
  const positions = FIELD_POSITIONS
  rows.push(['Manche', ...positions].join(','))

  // Innings
  for (const inning of lineup.innings) {
    const row: string[] = [String(inning.inning)]
    for (const position of positions) {
      const playerId = inning.assignments[position]
      const playerName = playerId ? playerNames[playerId] ?? 'Unknown' : '—'
      row.push(playerName)
    }
    rows.push(row.join(','))
  }

  // Bench rows
  rows.push(['BANC', ...new Array(positions.length - 1).fill('')].join(','))
  for (const inning of lineup.innings) {
    const benchStr = inning.bench.map((id) => playerNames[id] ?? 'Unknown').join(' | ')
    rows.push([String(inning.inning), benchStr].join(','))
  }

  return rows.join('\n')
}

export function validateLineupJSON(data: unknown): {
  valid: boolean
  error?: string
  parsed?: ExportedLineup
} {
  try {
    const parsed = data as ExportedLineup
    if (!parsed.lineup || !Array.isArray(parsed.lineup.innings)) {
      return { valid: false, error: 'Structure lineup invalide' }
    }
    if (!parsed.players || !Array.isArray(parsed.players)) {
      return { valid: false, error: 'Liste des joueurs manquante' }
    }
    return { valid: true, parsed }
  } catch (err) {
    return { valid: false, error: 'Erreur JSON parse' }
  }
}

export type ImportLineupPreview = {
  inningsCount: number
  teamName: string
  playersInLineup: number
  playersToCreate: number
  createdPlayersNames: string[]
}

export function buildImportPreview(
  lineupData: ExportedLineup,
  currentPlayers: Player[],
): ImportLineupPreview {
  const currentPlayerIds = new Set(currentPlayers.map((p) => p.id))
  const dataPlayerIds = lineupData.players.map((p) => p.id)
  const playersToCreate = dataPlayerIds.filter((id) => !currentPlayerIds.has(id))
  const createdPlayersNames = lineupData.players
    .filter((p) => playersToCreate.includes(p.id))
    .map((p) => p.name)

  return {
    inningsCount: lineupData.inningsCount,
    teamName: lineupData.team.name,
    playersInLineup: dataPlayerIds.length,
    playersToCreate: playersToCreate.length,
    createdPlayersNames,
  }
}

export function createMissingPlayersFromLineup(lineupData: ExportedLineup, currentPlayers: Player[]): Player[] {
  const currentPlayerIds = new Set(currentPlayers.map((p) => p.id))
  const newPlayers: Player[] = []

  for (const importedPlayer of lineupData.players) {
    if (!currentPlayerIds.has(importedPlayer.id)) {
      newPlayers.push({
        id: importedPlayer.id,
        name: importedPlayer.name,
        teamId: 0,
        positions: importedPlayer.positions,
        flexibilityLevel: importedPlayer.flexibilityLevel,
        excludedPositions: [],
        noBenchLastInning: false,
      })
    }
  }

  return newPlayers
}
