export const FIELD_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const

export const POSITION_SCORES = {
  primary: 100,
  secondary: 70,
  tertiary: 40,
  category: 30,
  incompatible: -1000,
} as const

export type Position = (typeof FIELD_POSITIONS)[number]
export type GeneralPositionGroup =
  | 'infield'
  | 'outfield'
  | 'outfield_catcher'
  | 'infield_catcher'
  | 'all_fields'
  | 'all_fields_catcher'
  | 'all_positions'
export type FlexibilityLevel = 'starter' | 'regular' | 'bench' | 'utility' | 'absent'

export type FixedAssignment = {
  position: Position
  playerId: number
}

export type Player = {
  id: number
  name: string
  teamId: number
  positions: {
    primary: Position[]
    secondary: Position[]
    tertiary: Position[]
    general: GeneralPositionGroup[]
  }
  flexibilityLevel: FlexibilityLevel
  excludedPositions?: Position[]
  lockedPosition?: Position
  lockedCanBench?: boolean
}

export type MatchRules = {
  inningsCount: number
  pitcherId: number
  maxPitcherInnings: number
  pitcherChanges: Partial<Record<number, number>>
  fixedCenterField: boolean
  fixedCenterFieldPlayerId?: number
  fixedCenterFieldPosition?: Position
  fixedAssignments: FixedAssignment[]
  prioritizeCatcher: boolean
  maxConsecutiveBench: number
}

export type Team = {
  id: number
  name: string
  logoUrl?: string
}

export type InningAssignment = {
  inning: number
  assignments: Record<Position, number>
  bench: number[]
  score: number
  notes: string[]
}

export type LineupResult = {
  innings: InningAssignment[]
  totals: Record<number, number>
}

export type PreviousMatchContext = {
  benchTotals: Record<number, number>
  matchCount: number
}

export type MatchHistoryEntry = {
  id: string
  label: string
  createdAt: string
  lineup: LineupResult
  benchTotals: Record<number, number>
}

export type ManualOverrideMap = Partial<Record<string, number>>

export type PersistedAppState = {
  team: Team
  players: Player[]
  rules: MatchRules
  manualOverrides: ManualOverrideMap
  lockedOverrides: string[]
  matchHistory?: MatchHistoryEntry[]
  selectedHistoryMatchId?: string
  historyContextWindow?: number
}

export const flexibilityWeights: Record<FlexibilityLevel, number> = {
  starter: 8,
  regular: 5,
  bench: 2,
  utility: 6,
  absent: -1000,
}

export function createOverrideKey(inning: number, position: Position) {
  return `${inning}:${position}`
}

export function isPosition(value: string): value is Position {
  return FIELD_POSITIONS.includes(value as Position)
}
