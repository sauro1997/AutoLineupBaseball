import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

type Position = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF'
type GeneralGroup = 'infield' | 'outfield' | 'utility'
type FlexibilityLevel = 'starter' | 'regular' | 'bench' | 'utility'

type Player = {
  id: string
  name: string
  positions: {
    primary: Position[]
    secondary: Position[]
    tertiary: Position[]
    general: GeneralGroup[]
  }
  flexibilityLevel: FlexibilityLevel
  lockedPosition?: Position
}

type Rules = {
  inningsCount: number
  pitcherId: string
  maxPitcherInnings: number
  fixedCenterField?: boolean
  fixedCenterFieldPlayerId?: string
  prioritizeCatcher?: boolean
  maxConsecutiveBench: number
}

const FIELD_POSITIONS: Position[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
const POSITION_CATEGORIES: Record<Position, GeneralGroup> = {
  P: 'utility',
  C: 'utility',
  '1B': 'infield',
  '2B': 'infield',
  '3B': 'infield',
  SS: 'infield',
  LF: 'outfield',
  CF: 'outfield',
  RF: 'outfield',
}

function scorePlayer(player: Player, position: Position) {
  if (player.positions.primary.includes(position)) return 100
  if (player.positions.secondary.includes(position)) return 70
  if (player.positions.tertiary.includes(position)) return 40
  if (player.positions.general.includes('utility')) return 30
  if (player.positions.general.includes(POSITION_CATEGORIES[position])) return 30
  return -1000
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const { players, rules } = (await request.json()) as { players: Player[]; rules: Rules }
  const innings = [] as Array<{ inning: number; positions: Array<{ position: Position; playerId: string; score: number }> }>
  const pitcherUsage: Record<string, number> = {}

  for (let inning = 1; inning <= rules.inningsCount; inning += 1) {
    const used = new Set<string>()
    const positions = [] as Array<{ position: Position; playerId: string; score: number }>

    for (const position of FIELD_POSITIONS) {
      const ranked = players
        .filter((player) => {
          if (used.has(player.id)) return false
          if (player.lockedPosition && player.lockedPosition !== position) return false
          if (position === 'P' && player.id !== rules.pitcherId) return false
          if (position === 'P' && (pitcherUsage[player.id] ?? 0) >= rules.maxPitcherInnings) return false
          if (position === 'CF' && rules.fixedCenterField && rules.fixedCenterFieldPlayerId) {
            return player.id === rules.fixedCenterFieldPlayerId
          }
          return scorePlayer(player, position) > -1000
        })
        .sort((left, right) => scorePlayer(right, position) - scorePlayer(left, position))

      const selected = ranked[0]
      if (!selected) {
        return new Response(JSON.stringify({ error: `No candidate available for ${position}` }), { status: 422 })
      }

      used.add(selected.id)
      positions.push({ position, playerId: selected.id, score: scorePlayer(selected, position) })
      if (position === 'P') {
        pitcherUsage[selected.id] = (pitcherUsage[selected.id] ?? 0) + 1
      }
    }

    innings.push({ inning, positions })
  }

  return new Response(JSON.stringify({ lineup: innings }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})
