import {
  FIELD_POSITIONS,
  POSITION_SCORES,
  createOverrideKey,
  flexibilityWeights,
  getPositionCategory,
  type InningAssignment,
  type LineupResult,
  type ManualOverrideMap,
  type MatchRules,
  type Player,
  type Position,
} from '../domain'

type PlayerState = {
  inningsPlayed: number
  inningsPitched: number
  consecutiveBench: number
  lastPosition?: Position
  repeatedPositionCount: number
  benchLastInning: boolean
}

type SearchState = {
  bestAssignments: Record<Position, string> | null
  bestScore: number
}

function buildInitialPlayerState(players: Player[]): Record<string, PlayerState> {
  return Object.fromEntries(
    players.map((player) => [
      player.id,
      {
        inningsPlayed: 0,
        inningsPitched: 0,
        consecutiveBench: 0,
        repeatedPositionCount: 0,
        benchLastInning: false,
      },
    ]),
  )
}

function getCompatibilityScore(player: Player, position: Position) {
  if (player.positions.primary.includes(position)) return POSITION_SCORES.primary
  if (player.positions.secondary.includes(position)) return POSITION_SCORES.secondary
  if (player.positions.tertiary.includes(position)) return POSITION_SCORES.tertiary
  if (player.positions.general.includes('utility')) return POSITION_SCORES.category

  const category = getPositionCategory(position)
  if (player.positions.general.includes(category)) return POSITION_SCORES.category

  return POSITION_SCORES.incompatible
}

function getPlayerBonus(player: Player, playerState: PlayerState, position: Position, inning: number) {
  const balanceBonus = Math.max(0, inning - 1 - playerState.inningsPlayed) * 8
  const benchRecoveryBonus = playerState.benchLastInning ? 18 : 0
  const flexibilityBonus = flexibilityWeights[player.flexibilityLevel]
  const repeatPenalty = playerState.lastPosition === position ? playerState.repeatedPositionCount * 4 : 0

  return balanceBonus + benchRecoveryBonus + flexibilityBonus - repeatPenalty
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

function canTakePosition(
  player: Player,
  position: Position,
  rules: MatchRules,
  playerState: PlayerState,
  forcedPlayerId?: string,
) {
  if (forcedPlayerId && player.id !== forcedPlayerId) return false
  if (player.lockedPosition && player.lockedPosition !== position) return false
  if (position === 'P' && player.id !== rules.pitcherId) return false
  if (position === 'P' && playerState.inningsPitched >= rules.maxPitcherInnings) return false
  if (position === 'CF' && rules.fixedCenterField && rules.fixedCenterFieldPlayerId && player.id !== rules.fixedCenterFieldPlayerId)
    return false

  return getCompatibilityScore(player, position) > POSITION_SCORES.incompatible
}

function mandatoryPlayers(playerStates: Record<string, PlayerState>, rules: MatchRules) {
  return new Set(
    Object.entries(playerStates)
      .filter(([, state]) => rules.maxConsecutiveBench > 0 && state.consecutiveBench >= rules.maxConsecutiveBench)
      .map(([playerId]) => playerId),
  )
}

function generateBestAssignments(
  players: Player[],
  rules: MatchRules,
  playerStates: Record<string, PlayerState>,
  inning: number,
  lockedAssignments: Record<Position, string>,
) {
  const state: SearchState = { bestAssignments: null, bestScore: Number.NEGATIVE_INFINITY }
  const mandatoryReturners = mandatoryPlayers(playerStates, rules)
  const playersById = Object.fromEntries(players.map((player) => [player.id, player]))
  const sanitizedLockedAssignments = {} as Record<Position, string>
  const seededAssignments = {} as Record<Position, string>
  const seededPlayers = new Set<string>()

  for (const [position, playerId] of Object.entries(lockedAssignments) as Array<[Position, string]>) {
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
      .filter((player) => canTakePosition(player, position, rules, playerStates[player.id], forcedPlayerId))
      .sort((left, right) => {
        const leftScore = getAssignmentScore(left, playerStates[left.id], position, inning, rules)
        const rightScore = getAssignmentScore(right, playerStates[right.id], position, inning, rules)

        return rightScore - leftScore
      })

    return { position, candidates: rankedCandidates }
  }).sort((left, right) => left.candidates.length - right.candidates.length)

  function search(index: number, assignments: Record<Position, string>, usedPlayers: Set<string>, score: number) {
    if (index === candidateMatrix.length) {
      const unassignedMandatory = [...mandatoryReturners].some((playerId) => !usedPlayers.has(playerId))
      if (!unassignedMandatory && score > state.bestScore) {
        state.bestScore = score
        state.bestAssignments = { ...assignments }
      }
      return
    }

    const remainingSlots = candidateMatrix.length - index
    const remainingMandatory = [...mandatoryReturners].filter((playerId) => !usedPlayers.has(playerId)).length
    if (remainingMandatory > remainingSlots) return

    const { position, candidates } = candidateMatrix[index]
    for (const candidate of candidates) {
      if (usedPlayers.has(candidate.id)) continue

      const compatibility = getCompatibilityScore(candidate, position)
      if (compatibility <= POSITION_SCORES.incompatible) continue

      const playerState = playerStates[candidate.id]
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
    return total + getAssignmentScore(player, playerStates[playerId], position as Position, inning, rules)
  }, 0)

  search(0, { ...seededAssignments }, new Set(seededPlayers), initialScore)

  if (!state.bestAssignments) {
    const fallbackAssignments = {} as Record<Position, string>
    const availablePlayers = new Set(players.map((player) => player.id))

    for (const { position } of candidateMatrix) {
      const forcedPlayerId = lockedAssignments[position]
      const selectedPlayerId = forcedPlayerId && availablePlayers.has(forcedPlayerId)
        ? forcedPlayerId
        : [...availablePlayers].sort((left, right) => {
            const leftPlayer = playersById[left]
            const rightPlayer = playersById[right]
            return getCompatibilityScore(rightPlayer, position) - getCompatibilityScore(leftPlayer, position)
          })[0]

      fallbackAssignments[position] = selectedPlayerId
      availablePlayers.delete(selectedPlayerId)
    }

    return { assignments: fallbackAssignments, score: 0 }
  }

  return { assignments: state.bestAssignments, score: state.bestScore }
}

function buildLockedAssignments(
  inning: number,
  players: Player[],
  rules: MatchRules,
  manualOverrides: ManualOverrideMap,
) {
  const lockedAssignments: Partial<Record<Position, string>> = { P: rules.pitcherId }

  if (rules.fixedCenterField && rules.fixedCenterFieldPlayerId) {
    lockedAssignments.CF = rules.fixedCenterFieldPlayerId
  }

  for (const player of players) {
    if (player.lockedPosition) {
      lockedAssignments[player.lockedPosition] = player.id
    }
  }

  for (const position of FIELD_POSITIONS) {
    const overrideKey = createOverrideKey(inning, position)
    const playerId = manualOverrides[overrideKey]
    if (playerId) lockedAssignments[position] = playerId
  }

  return lockedAssignments as Record<Position, string>
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

export function generateLineup(
  players: Player[],
  rules: MatchRules,
  manualOverrides: ManualOverrideMap = {},
  lockedOverrideKeys: string[] = [],
): LineupResult {
  const playerStates = buildInitialPlayerState(players)
  const playerIds = new Set(players.map((player) => player.id))
  const innings: InningAssignment[] = []
  const lockedOverrides = new Set(lockedOverrideKeys)

  for (let inning = 1; inning <= rules.inningsCount; inning += 1) {
    const lockedAssignments = buildLockedAssignments(inning, players, rules, manualOverrides)
    const { assignments, score } = generateBestAssignments(players, rules, playerStates, inning, lockedAssignments)
    const lockedCount = FIELD_POSITIONS.filter((position) =>
      lockedOverrides.has(createOverrideKey(inning, position)),
    ).length

    for (const position of FIELD_POSITIONS) {
      const overrideKey = createOverrideKey(inning, position)
      const overridePlayerId = manualOverrides[overrideKey]
      if (overridePlayerId && playerIds.has(overridePlayerId)) {
        assignments[position] = overridePlayerId
      }
    }

    const usedPlayers = new Set(Object.values(assignments))
    const bench = players.filter((player) => !usedPlayers.has(player.id)).map((player) => player.id)
    const notes = [] as string[]

    for (const player of players) {
      const state = playerStates[player.id]
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
      }
    }

    const catcherNote = getCatcherPriorityNote(players, { inning, assignments, bench, score, notes }, rules)
    if (catcherNote) notes.push(catcherNote)

    if (bench.length > 0) {
      notes.push(`Banc: ${bench.length} joueur(s)`)
    }

    if (lockedCount > 0) {
      notes.push(`${lockedCount} override(s) verrouillé(s)`)
    }

    innings.push({ inning, assignments, bench, score, notes })
  }

  const totals = Object.fromEntries(players.map((player) => [player.id, playerStates[player.id].inningsPlayed]))

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
