# AutoLineupBaseball

Application web MVP pour générer des alignements de baseball intelligents par manche.

## Fonctionnalités livrées

- gestion d’équipe et de roster
- système de positions `primary / secondary / tertiary / general`
- création de match avec règles pitcher / catcher / CF fixe / banc consécutif
- moteur d’alignement local avec scoring et équilibrage du temps de jeu
- édition manuelle par manche avec verrouillage des overrides
- export PDF via impression navigateur et partage via lien encodé
- schéma Supabase + politiques RLS
- CI frontend GitHub Actions + configuration Netlify

## Stack

- React 19
- TypeScript
- Vite
- ESLint
- Supabase (migration SQL)

## Démarrage local

```bash
npm install
npm run dev
```

## Validation

```bash
npm run lint
npm run build
```

## Structure principale

- `src/App.tsx` : dashboard, roster, match setup, lineup generator, éditeur manuel
- `src/domain.ts` : types métier et constantes de positions
- `src/lib/lineupEngine.ts` : moteur de génération et résumé de lineup
- `supabase/migrations/20260507211000_init.sql` : schéma SQL + RLS
- `.github/workflows/frontend-ci.yml` : pipeline CI frontend

## Roadmap

### MVP

- roster et équipe
- match configurable
- génération intelligente par manche
- overrides manuels et locks

### V1

- persistance Supabase branchée au frontend
- éditeur drag & drop
- export PDF enrichi et vue mobile coach

### V2

- templates de règles
- multi-ligues
- optimisation plus avancée

### V3

- moteur multi-sport
- SaaS multi-équipes
- coaching assisté par IA
