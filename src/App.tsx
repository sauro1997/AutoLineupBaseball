import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { demoPlayers, demoRules, demoTeam } from './data/demo'
import {
  FIELD_POSITIONS,
  createOverrideKey,
  isPosition,
  type FlexibilityLevel,
  type ManualOverrideMap,
  type MatchRules,
  type PersistedAppState,
  type Player,
  type Position,
  type Team,
} from './domain'
import { generateLineup, summarizeLineup } from './lib/lineupEngine'

const STORAGE_KEY = 'autolineup-state-v1'

function parsePositionList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(isPosition)
}

function parseGeneralGroups(value: string) {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is Player['positions']['general'][number] => ['infield', 'outfield', 'utility'].includes(item))
}

function encodeShareState(state: PersistedAppState) {
  return `#share=${window.btoa(encodeURIComponent(JSON.stringify(state)))}`
}

function decodeShareState(hash: string) {
  if (!hash.startsWith('#share=')) return undefined

  try {
    const encoded = hash.replace('#share=', '')
    const decoded = decodeURIComponent(window.atob(encoded))
    return JSON.parse(decoded) as PersistedAppState
  } catch {
    return undefined
  }
}

function nextPlayerId(players: Player[]) {
  return `player-${players.length + 1}`
}

function App() {
  const [initialState] = useState<PersistedAppState>(() => {
    const sharedState = decodeShareState(window.location.hash)
    if (sharedState) return sharedState

    const persisted = window.localStorage.getItem(STORAGE_KEY)
    if (persisted) {
      try {
        return JSON.parse(persisted) as PersistedAppState
      } catch {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    }

    return {
      team: demoTeam,
      players: demoPlayers,
      rules: demoRules,
      manualOverrides: {},
      lockedOverrides: [],
    }
  })

  const [team, setTeam] = useState<Team>(initialState.team)
  const [players, setPlayers] = useState<Player[]>(initialState.players)
  const [rules, setRules] = useState<MatchRules>(initialState.rules)
  const [manualOverrides, setManualOverrides] = useState<ManualOverrideMap>(initialState.manualOverrides)
  const [lockedOverrides, setLockedOverrides] = useState<string[]>(initialState.lockedOverrides)
  const [status, setStatus] = useState('MVP prêt à générer un alignement intelligent.')

  useEffect(() => {
    const state: PersistedAppState = { team, players, rules, manualOverrides, lockedOverrides }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [team, players, rules, manualOverrides, lockedOverrides])

  const lineup = useMemo(
    () => generateLineup(players, rules, manualOverrides, lockedOverrides),
    [players, rules, manualOverrides, lockedOverrides],
  )

  const playerNames = useMemo(
    () => Object.fromEntries(players.map((player) => [player.id, player.name])),
    [players],
  )

  const summary = useMemo(() => summarizeLineup(lineup, players), [lineup, players])

  function updatePlayer(playerId: string, updater: (player: Player) => Player) {
    setPlayers((currentPlayers) => currentPlayers.map((player) => (player.id === playerId ? updater(player) : player)))
  }

  function addPlayer() {
    const newPlayer: Player = {
      id: nextPlayerId(players),
      name: 'Nouveau joueur',
      teamId: team.id,
      positions: { primary: ['1B'], secondary: [], tertiary: [], general: ['utility'] },
      flexibilityLevel: 'bench',
    }

    setPlayers((currentPlayers) => [...currentPlayers, newPlayer])
    setStatus('Joueur ajouté au roster.')
  }

  function removePlayer(playerId: string) {
    setPlayers((currentPlayers) => currentPlayers.filter((player) => player.id !== playerId))
    setManualOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([, value]) => value !== playerId)),
    )
    setLockedOverrides((current) => current.filter((key) => manualOverrides[key] !== playerId))

    if (rules.pitcherId === playerId) {
      const replacement = players.find((player) => player.id !== playerId)
      if (replacement) {
        setRules((currentRules) => ({ ...currentRules, pitcherId: replacement.id }))
      }
    }

    if (rules.fixedCenterFieldPlayerId === playerId) {
      setRules((currentRules) => ({ ...currentRules, fixedCenterFieldPlayerId: undefined }))
    }

    setStatus('Joueur retiré du roster.')
  }

  function updateOverride(inning: number, position: Position, playerId: string) {
    const key = createOverrideKey(inning, position)
    setManualOverrides((current) => {
      const next = { ...current }
      if (playerId) {
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

  async function copyShareLink() {
    const shareState: PersistedAppState = { team, players, rules, manualOverrides, lockedOverrides }
    const link = `${window.location.origin}${window.location.pathname}${encodeShareState(shareState)}`
    await window.navigator.clipboard.writeText(link)
    setStatus('Lien de match copié dans le presse-papiers.')
  }

  async function copySummary() {
    await window.navigator.clipboard.writeText(summary)
    setStatus('Résumé du lineup copié.')
  }

  function printLineup() {
    window.print()
    setStatus('Utilisez le dialogue d’impression pour exporter en PDF.')
  }

  function resetDemo() {
    setTeam(demoTeam)
    setPlayers(demoPlayers)
    setRules(demoRules)
    setManualOverrides({})
    setLockedOverrides([])
    window.localStorage.removeItem(STORAGE_KEY)
    setStatus('Démo restaurée.')
  }

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">MVP — Baseball intelligent</p>
          <h1>AutoLineup Baseball</h1>
          <p className="lede">
            Gérez votre équipe, configurez un match, générez un lineup par manche et ajustez-le manuellement
            sans perdre les contraintes clés du match.
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={copyShareLink}>
            Copier le lien du match
          </button>
          <button type="button" onClick={copySummary}>
            Copier le résumé
          </button>
          <button type="button" onClick={printLineup}>
            Export PDF
          </button>
          <button type="button" className="ghost" onClick={resetDemo}>
            Réinitialiser la démo
          </button>
        </div>
      </header>

      <section className="grid two-columns">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">1. Dashboard équipe</p>
              <h2>Équipe & roster</h2>
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
              Logo URL (optionnel)
              <input
                value={team.logoUrl ?? ''}
                onChange={(event) => setTeam((current) => ({ ...current, logoUrl: event.target.value }))}
                placeholder="https://..."
              />
            </label>
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
                      <option value="starter">starter</option>
                      <option value="regular">régulier</option>
                      <option value="bench">remplaçant</option>
                      <option value="utility">utility</option>
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
                        }))
                      }
                    >
                      <option value="">Aucun</option>
                      {FIELD_POSITIONS.map((position) => (
                        <option key={position} value={position}>
                          {position}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Primary
                    <input
                      value={player.positions.primary.join(', ')}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          positions: { ...current.positions, primary: parsePositionList(event.target.value) },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Secondary
                    <input
                      value={player.positions.secondary.join(', ')}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          positions: { ...current.positions, secondary: parsePositionList(event.target.value) },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Tertiary
                    <input
                      value={player.positions.tertiary.join(', ')}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          positions: { ...current.positions, tertiary: parsePositionList(event.target.value) },
                        }))
                      }
                    />
                  </label>
                  <label>
                    General
                    <input
                      value={player.positions.general.join(', ')}
                      onChange={(event) =>
                        updatePlayer(player.id, (current) => ({
                          ...current,
                          positions: { ...current.positions, general: parseGeneralGroups(event.target.value) },
                        }))
                      }
                    />
                  </label>
                </div>
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">2. Création match</p>
              <h2>Paramètres du match</h2>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Nombre de manches
              <input
                type="number"
                min="1"
                max="12"
                value={rules.inningsCount}
                onChange={(event) =>
                  setRules((current) => ({ ...current, inningsCount: Number(event.target.value) || 1 }))
                }
              />
            </label>
            <label>
              Lanceur
              <select
                value={rules.pitcherId}
                onChange={(event) => setRules((current) => ({ ...current, pitcherId: event.target.value }))}
              >
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Manches max du lanceur
              <input
                type="number"
                min="1"
                max={rules.inningsCount}
                value={rules.maxPitcherInnings}
                onChange={(event) =>
                  setRules((current) => ({ ...current, maxPitcherInnings: Number(event.target.value) || 1 }))
                }
              />
            </label>
            <label>
              Max banc consécutif
              <input
                type="number"
                min="1"
                max="3"
                value={rules.maxConsecutiveBench}
                onChange={(event) =>
                  setRules((current) => ({ ...current, maxConsecutiveBench: Number(event.target.value) || 1 }))
                }
              />
            </label>
          </div>

          <div className="toggle-list">
            <label className="toggle">
              <input
                type="checkbox"
                checked={rules.fixedCenterField}
                onChange={(event) =>
                  setRules((current) => ({ ...current, fixedCenterField: event.target.checked }))
                }
              />
              CF fixe
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={rules.prioritizeCatcher}
                onChange={(event) =>
                  setRules((current) => ({ ...current, prioritizeCatcher: event.target.checked }))
                }
              />
              Receveur prioritaire
            </label>
          </div>

          <label>
            Joueur fixe au CF
            <select
              value={rules.fixedCenterFieldPlayerId ?? ''}
              onChange={(event) =>
                setRules((current) => ({
                  ...current,
                  fixedCenterFieldPlayerId: event.target.value || undefined,
                }))
              }
              disabled={!rules.fixedCenterField}
            >
              <option value="">Sélectionner</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rule-summary">
            <h3>Contraintes gérées</h3>
            <ul>
              <li>Hard constraints: pitcher dédié, locks globaux, CF fixe, overrides verrouillés.</li>
              <li>Soft constraints: scoring primary → tertiary, équilibre temps de jeu, retour du banc.</li>
              <li>Fallback: catégorie infield/outfield/utility si aucune position stricte n’est disponible.</li>
            </ul>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">3. Générateur lineup</p>
            <h2>Alignements par manche</h2>
          </div>
          <p className="status-chip">{status}</p>
        </div>

        <div className="lineup-grid">
          {lineup.innings.map((inning) => (
            <article key={inning.inning} className="inning-card">
              <div className="inning-card-header">
                <h3>Manche {inning.inning}</h3>
                <span>Score {inning.score}</span>
              </div>
              <table>
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
                        <td>{position}</td>
                        <td>
                          <select
                            value={manualOverrides[overrideKey] ?? inning.assignments[position]}
                            onChange={(event) => updateOverride(inning.inning, position, event.target.value)}
                          >
                            {players.map((player) => (
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
              <p className="bench-line">
                Banc: {inning.bench.map((playerId) => playerNames[playerId]).join(', ') || 'Aucun'}
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

      <section className="grid two-columns">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">4. Éditeur manuel</p>
              <h2>Réaffectation rapide</h2>
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
                <span>{lineup.totals[player.id] ?? 0} manches jouées</span>
                <span>Lock global: {player.lockedPosition ?? 'aucun'}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">5. Roadmap produit</p>
              <h2>Vision de plateforme</h2>
            </div>
          </div>
          <div className="roadmap">
            <div>
              <h3>MVP</h3>
              <ul>
                <li>Gestion équipe / roster</li>
                <li>Scoring primary-secondary-tertiary</li>
                <li>Pitcher, catcher, CF fixe, banc</li>
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
    </div>
  )
}

export default App
