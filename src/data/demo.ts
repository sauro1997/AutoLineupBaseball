import { type MatchRules, type Player, type Team } from '../domain'

export const demoTeam: Team = {
  id: 'team-1',
  name: 'AutoLineup Baseball Club',
}

export const demoPlayers: Player[] = [
  {
    id: 'player-1',
    name: 'Nicolas Blau',
    teamId: 'team-1',
    positions: { primary: ['SS'], secondary: ['2B'], tertiary: ['3B'], general: ['infield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 'player-2',
    name: 'Charles Gagnon',
    teamId: 'team-1',
    positions: { primary: ['P'], secondary: ['1B'], tertiary: ['LF'], general: ['utility'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 'player-3',
    name: 'Maxime Roy',
    teamId: 'team-1',
    positions: { primary: ['C'], secondary: ['1B'], tertiary: ['3B'], general: ['utility'] },
    flexibilityLevel: 'regular',
  },
  {
    id: 'player-4',
    name: 'Samuel Drouin',
    teamId: 'team-1',
    positions: { primary: ['CF'], secondary: ['LF'], tertiary: ['RF'], general: ['outfield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 'player-5',
    name: 'Olivier Parent',
    teamId: 'team-1',
    positions: { primary: ['2B'], secondary: ['SS'], tertiary: ['3B'], general: ['infield'] },
    flexibilityLevel: 'regular',
  },
  {
    id: 'player-6',
    name: 'Alex Tremblay',
    teamId: 'team-1',
    positions: { primary: ['3B'], secondary: ['1B'], tertiary: ['2B'], general: ['infield'] },
    flexibilityLevel: 'regular',
  },
  {
    id: 'player-7',
    name: 'Philippe Cote',
    teamId: 'team-1',
    positions: { primary: ['LF'], secondary: ['RF'], tertiary: ['CF'], general: ['outfield'] },
    flexibilityLevel: 'regular',
  },
  {
    id: 'player-8',
    name: 'Julien Landry',
    teamId: 'team-1',
    positions: { primary: ['RF'], secondary: ['LF'], tertiary: ['CF'], general: ['outfield'] },
    flexibilityLevel: 'bench',
  },
  {
    id: 'player-9',
    name: 'David Paquet',
    teamId: 'team-1',
    positions: { primary: ['1B'], secondary: ['C'], tertiary: ['3B'], general: ['infield'] },
    flexibilityLevel: 'regular',
  },
  {
    id: 'player-10',
    name: 'Mathieu Blais',
    teamId: 'team-1',
    positions: { primary: ['SS'], secondary: ['2B'], tertiary: ['CF'], general: ['utility'] },
    flexibilityLevel: 'utility',
  },
  {
    id: 'player-11',
    name: 'Eric Ouellet',
    teamId: 'team-1',
    positions: { primary: ['LF'], secondary: ['1B'], tertiary: ['RF'], general: ['utility'] },
    flexibilityLevel: 'bench',
  },
]

export const demoRules: MatchRules = {
  inningsCount: 6,
  pitcherId: 'player-2',
  maxPitcherInnings: 5,
  fixedCenterField: true,
  fixedCenterFieldPlayerId: 'player-4',
  prioritizeCatcher: true,
  maxConsecutiveBench: 1,
}
