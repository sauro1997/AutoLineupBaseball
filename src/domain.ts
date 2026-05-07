export const FIELD_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const

export const POSITION_CATEGORIES = {
  P: 'utility',
  C: 'utility',
  '1B': 'infield',
  '2B': 'infield',
  '3B': 'infield',
  SS: 'infield',
  LF: 'outfield',
  CF: 'outfield',
  RF: 'outfield',
} as const

export const POSITION_SCORES = {
  primary: 100,
  secondary: 70,
  tertiary: 40,
  category: 30,
  incompatible: -1000,
} as const

export type Position = (typeof FIELD_POSITIONS)[number]
export type GeneralPositionGroup = 'infield' | 'outfield' | 'utility'
export type FlexibilityLevel = 'starter' | 'regular' | 'bench' | 'utility'

export type Player = {
  id: string
  name: string
  teamId: string
  positions: {
    primary: Position[]
    secondary: Position[]
    tertiary: Position[]
    general: GeneralPositionGroup[]
  }
  flexibilityLevel: FlexibilityLevel
  lockedPosition?: Position
}

export type MatchRules = {
  inningsCount: number
  pitcherId: string
  maxPitcherInnings: number
  fixedCenterField: boolean
  fixedCenterFieldPlayerId?: string
  prioritizeCatcher: boolean
  maxConsecutiveBench: number
}

export type Team = {
  id: string
  name: string
  logoUrl?: string
}

export type InningAssignment = {
  inning: number
  assignments: Record<Position, string>
  bench: string[]
  score: number
  notes: string[]
}

export type LineupResult = {
  innings: InningAssignment[]
  totals: Record<string, number>
}

export type ManualOverrideMap = Partial<Record<string, string>>

export type PersistedAppState = {
  team: Team
  players: Player[]
  rules: MatchRules
  manualOverrides: ManualOverrideMap
  lockedOverrides: string[]
}

export const flexibilityWeights: Record<FlexibilityLevel, number> = {
  starter: 8,
  regular: 5,
  bench: 2,
  utility: 6,
}

export function createOverrideKey(inning: number, position: Position) {
  return `${inning}:${position}`
}

export function isPosition(value: string): value is Position {
  return FIELD_POSITIONS.includes(value as Position)
}

export function getPositionCategory(position: Position): GeneralPositionGroup {
  return POSITION_CATEGORIES[position]
}
