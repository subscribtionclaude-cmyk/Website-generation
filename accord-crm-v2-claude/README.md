# ACCORD CRM V2 — CLAUDE INDEPENDENT VERSION
ACCORD Property & Facility Management · Business Development CRM + management control centre.

Static React app (ShipStatic) + its **own** Supabase project (Postgres/Auth/Storage/Edge Functions). Independent of the Codex build.

* Setup & deployment: [`docs/SETUP.md`](docs/SETUP.md)
* Architecture, access model, limitations: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
* Database: `supabase/migrations/*.sql` (also `supabase/apply-all.sql`) · Edge Functions: `supabase/functions/*`
* Tests: `npm test` · `npm run test:sql` · `npm run test:e2e` · `npm run scan:secrets`

Brand assets used (from the supplied pack): `accord-logo-light-transparent.png`, `accord-logo-dark-transparent.png` (UI logos) and PWA icons composed from the
original wordmark on white by `scripts/make-icons.py`. No generated or redrawn artwork; storyboards/app-icon explorations were deliberately not used.
The dark-mode logo and the compact "A" mark are recolour/crop derivatives of the supplied logo (`scripts/make-brand-variants.py`).

UI: Light / Dark / System theme and English / العربية (RTL) — see *UI: theme, language, design tokens* in `docs/ARCHITECTURE.md`.
