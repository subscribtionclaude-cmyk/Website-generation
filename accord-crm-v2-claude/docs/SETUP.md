# ACCORD CRM V2 — Claude independent version: setup & deployment

> This implementation is **independent** of the Codex build. Never link, migrate or deploy to Supabase project
> `kqoodjnxcksejjeflelc` (forbidden). `scripts/provision.sh` refuses to run against it.

## 0. Status of this hand-over
Everything in the repo is built and tested locally (Postgres 16 + PostgREST + the real Edge Function code under Deno).
**The hosted Supabase project could not be created from the build session** (the connected organization hit its free-plan
limit of 2 projects). Follow sections 1–7; they take ~15 minutes.

## 1. Create the separate Supabase project
Supabase dashboard → *New project* → name **ACCORD CRM V2 - Claude** (region: eu-central-1 suggested). Use a plan/organization
that allows another project. Note the **Project ref**, **Project URL** and the **anon / publishable key** (Settings → API).

## 2. Apply the database (pick ONE)
**A. CLI (recommended):** `supabase login`, then
`PROJECT_REF=<ref> SITE_URL=https://<your-site>.shipstatic.com ./scripts/provision.sh` — links the project, runs
`supabase db push` (all migrations), sets function secrets and deploys both Edge Functions.

**B. SQL editor:** paste `supabase/apply-all.sql` into *SQL Editor* of the empty project and run it; then deploy the two functions
(`supabase functions deploy admin-users` / `google-sheet-sync`) and set secrets (section 5).

Migrations (in order): `core_schema` → `triggers` (rollups, timeline, audit) → `rls` → `functions` (RPCs, reports, sync importers) → `storage` → `seed`.

## 3. First administrator
1. Dashboard → Authentication → Users → **Add user** (auto-confirm), strong password of your choice.
2. Edit the email/name at the top of `supabase/bootstrap-first-admin.sql` and run it in the SQL editor.
All other users are created from the CRM: **Admin → Users & access** (invite email or temporary password).

## 4. Authentication settings (dashboard — cannot be set from SQL)
* Authentication → Sign In / Providers → Email: **turn OFF "Allow new users to sign up"** (public sign-up must be disabled).
  Even if it were on, a new Auth user has **no CRM access** without an active `profiles` row (RLS + Edge Functions both enforce this).
* Authentication → URL Configuration: **Site URL** = your ShipStatic URL; add `https://<site>/set-password/` to *Redirect URLs*
  (invitation + password-reset links land there).
* Password policy: minimum length 12. (Optional: enable leaked-password protection.)
* Edge Function secrets (Project Settings → Edge Functions → Secrets):
  `SITE_URL=https://<site>`, `ALLOWED_ORIGINS=https://<site>`. (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 5. Google Sheet access (read-only legacy source)
Required only for **Admin → Google Sheet sync**. Spreadsheet: *Accord New Data* (`127WeIut5Jjwbs6sS2w6fmqikrRlZbPZERElYh7eWclQ`).
1. Google Cloud console → create a project → enable **Google Sheets API** → *IAM → Service accounts → Create* (no roles needed) → *Keys → Add key → JSON*.
2. Open the Sheet → **Share** → paste the service account's `client_email` → role **Viewer**.
3. Add the secrets (use the CLI so nothing is pasted into chat):
   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL="<client_email>" --project-ref <ref>
   supabase secrets set GOOGLE_PRIVATE_KEY="$(jq -r .private_key key.json)" --project-ref <ref>
   ```
   Delete `key.json` afterwards. The private key never reaches the browser or the repo.
4. In the CRM: Admin → Google Sheet sync → **Scan**, then **Preview (dry run)**, then **Sync now**. Run it twice — the second run must report 0 inserted / 0 updated.

## 6. Frontend (ShipStatic)
1. Unzip `accord-crm-v2-claude-shipstatic-deploy.zip`. Open `config.js` and set
   ```js
   window.ACCORD_CONFIG = { supabaseUrl: 'https://<ref>.supabase.co', supabaseAnonKey: '<anon or publishable key>' };
   ```
   (only the **public** URL and anon/publishable key — never the service-role key). No rebuild needed.
   Or rebuild: `VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm run build && npm run package`.
2. Upload the folder contents to ShipStatic (all files, with `index.html` at the root). No server, rewrites or `/api` are needed:
   every route has its own `…/index.html`.
3. Set that URL as Site URL / redirect URL (section 4) and in the function secrets (`SITE_URL`, `ALLOWED_ORIGINS`).
4. iPad: Safari → Share → **Add to Home Screen** (ACCORD wordmark icon, standalone mode).

## 7. Smoke test after go-live
Sign in as the admin → Users & access → add a BD executive with a daily target → sign in as them → Leads → Call → Responded →
Dashboard shows 1 call, correct % and remaining → Admin → Reports → Daily shows the call.

## Commands (development)
| | |
|---|---|
| `npm run dev` | Vite dev server (needs `.env` with the two public values) |
| `npm run build` | typecheck + static build + per-route entry points → `dist/` |
| `npm test` | unit tests (parsers, Cairo calendar, metrics, milestones, CSV) |
| `npm run test:sql` | 127 SQL behaviour + security tests on a throw-away local Postgres |
| `npm run test:e2e` | full browser suites against a local stack (Postgres + PostgREST + real Edge Function code under Deno). Because `public/config.js` now carries the hosted project values, run it as `E2E_RUNTIME_CONFIG=1 npm run test:e2e` so the test build points at the local stack |
| `npm run scan:secrets` | secret scan of source **and** compiled output |
| `npm run package` | builds both ZIPs into `deliverables/` |

## Hosted project (ACCORD CRM V2 - Claude)

- Project ref: `olanalmpysrwjgfnbejq` (eu-central-1) — URL `https://olanalmpysrwjgfnbejq.supabase.co`
- Migrations 1–8 applied; Edge Functions `admin-users` and `google-sheet-sync` deployed (verify_jwt on).
- **Before deploying this frontend, apply migration 9** (`supabase/migrations/20261010000009_activity_order_seq.sql`, additive: adds
  `activities.seq` + an index for deterministic timeline order). The frontend falls back to the old ordering until it is applied.
- **Apply migration 10** (`supabase/migrations/20261011000010_export_audit.sql`, additive: one function `log_export`) before
  deploying the export feature (applied to the hosted project `olanalmpysrwjgfnbejq` on 2026-10-10 and verified). It enforces export permissions server-side and writes the export audit trail; without it exports
  still work for the roles the UI allows, but nothing is audited (the dialog says so).
- **Apply migration 11, then redeploy the `admin-users` Edge Function** (`supabase/migrations/20261012000011_user_delete_history.sql`).
  Migration 11 lets a user's login be deleted while their CRM profile stays as a "(Deleted user)" tombstone, so all
  history keeps its author. It drops the `profiles → auth.users` cascade, adds `deleted_at`/`deleted_by`, a guard trigger,
  the service-only helpers, `admin_user_signins()`, and changes one line of `admin_report` (deleted BD users drop out of
  the current team list). It changes no CRM rows. Until it is applied, Delete User reports "apply database migration 11 first"
  and nothing is changed.
- **User limits / invitation emails.** The CRM has no user cap. Supabase's built-in email sender allows only a few emails
  per hour; past that, invitations fail with "Invitation email limit reached…" (the hosted logs showed exactly this:
  `429 over_email_send_rate_limit`). Use **Temporary password** (no email involved) or configure Custom SMTP in
  Supabase → Authentication → Emails → SMTP settings to lift the limit.
- `public/config.js` carries only the public URL + anon key.

Manual steps still required (not possible through the available tooling):
1. Dashboard → Authentication → Sign In / Providers: turn **off** "Allow new users to sign up".
2. Authentication → URL Configuration: set Site URL to the ShipStatic URL and add `https://<site>/set-password/` to redirect URLs.
3. Edge Functions → Secrets: `SITE_URL`, `ALLOWED_ORIGINS`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `SPREADSHEET_ID` (share the Sheet with the service account as Viewer).
4. Create the first admin: create the user in Authentication → Users, then run `supabase/bootstrap-first-admin.sql` with that email.
