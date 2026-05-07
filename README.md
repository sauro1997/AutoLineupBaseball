# AutoLineupBaseball

Application web MVP pour générer des alignements de baseball intelligents par manche.

## Fonctionnalités livrées

- gestion d’équipe et de roster
- système de positions `primary / secondary / tertiary / general`
- création de match avec règles pitcher / catcher / CF fixe / banc consécutif
- moteur d’alignement local avec scoring et équilibrage du temps de jeu
- édition manuelle par manche avec verrouillage des overrides
- export PDF via impression navigateur et partage via lien encodé
- schéma Supabase (sans RLS) + contrat d’Edge Function
- CI frontend GitHub Actions + configuration Netlify

## Stack

- React 19
- TypeScript
- Vite
- ESLint
- Supabase (migration SQL + Edge Function)

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

## Variables d’environnement

Copier `.env.example` et renseigner :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_USERNAME` — identifiant de connexion (défaut : `admin`)
- `VITE_APP_PASSWORD` — mot de passe de connexion (défaut : `password`)

L’authentification est gérée côté frontend uniquement avec un simple formulaire username/password.
La session est conservée en `sessionStorage` et aucun RLS Supabase n’est utilisé.

## Structure principale

- `src/App.tsx` : dashboard, roster, match setup, lineup generator, éditeur manuel
- `src/domain.ts` : types métier et constantes de positions
- `src/lib/lineupEngine.ts` : moteur de génération et résumé de lineup
- `supabase/migrations/20260507211000_init.sql` : schéma SQL (sans RLS)
- `supabase/functions/generate-lineup/index.ts` : endpoint Edge Function du moteur
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
