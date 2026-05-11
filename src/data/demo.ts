import { type MatchRules, type Player, type Team } from '../domain'

export const demoTeam: Team = {
  id: 1,
  name: 'Entre Tout Le Match',
}

export const demoPlayers: Player[] = [
  {
    id: 1,
    name: 'Francis Lavoie',
    teamId: 1,
    // Lanceur #1, peut jouer au 2e but
    positions: { primary: ['P'], secondary: ['2B'], tertiary: [], general: ['all_fields'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 2,
    name: 'Simon Sauro',
    teamId: 1,
    // Receveur #1, peut aussi lancer
    positions: { primary: ['C'], secondary: ['P'], tertiary: [], general: ['all_fields'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 3,
    name: 'Tristan Gervais',
    teamId: 1,
    // Champ droit principal, receveur de secours
    positions: { primary: ['RF'], secondary: ['C'], tertiary: [], general: ['outfield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 4,
    name: 'Olivier Berthiaume',
    teamId: 1,
    // 2e but principal, 3e but secondaire, receveur de secours
    positions: { primary: ['2B'], secondary: ['3B'], tertiary: ['C'], general: ['infield_catcher'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 5,
    name: 'Kevin Allard',
    teamId: 1,
    // 1re but principal, peut jouer au 3e
    positions: { primary: ['1B'], secondary: ['3B'], tertiary: [], general: ['infield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 6,
    name: 'Dan Provost',
    teamId: 1,
    // 1re but alternatif, peut jouer au 2e
    positions: { primary: ['1B'], secondary: ['2B'], tertiary: [], general: ['infield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 7,
    name: 'Marc-André Brière',
    teamId: 1,
    // 3e but principal, peut jouer à l'arrêt-court
    positions: { primary: ['3B'], secondary: ['SS'], tertiary: [], general: ['infield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 8,
    name: 'Nicolas Blau',
    teamId: 1,
    // Arrêt-court principal
    positions: { primary: ['SS'], secondary: [], tertiary: [], general: ['infield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 9,
    name: 'Antony Gamelin',
    teamId: 1,
    // Champ gauche — rotation au champ
    positions: { primary: ['LF'], secondary: [], tertiary: [], general: ['outfield'] },
    flexibilityLevel: 'starter',
  },
  {
    id: 10,
    name: 'Samuel Bernier',
    teamId: 1,
    // Champ centre — rotation au champ
    positions: { primary: ['CF'], secondary: [], tertiary: [], general: ['outfield'] },
    flexibilityLevel: 'starter',
  },
]

export const demoRules: MatchRules = {
  inningsCount: 6,
  pitcherId: 1,
  maxPitcherInnings: 5,
  pitcherChanges: {},
  fixedCenterField: false,
  fixedAssignments: [],
  prioritizeCatcher: true,
  maxConsecutiveBench: 2,
}
