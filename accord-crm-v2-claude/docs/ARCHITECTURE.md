# Architecture & decisions

**Stack:** static React 18 + TypeScript SPA (Vite) → Supabase (PostgreSQL, Auth, Storage, Edge Functions). Timezone **Africa/Cairo**.
No Vercel, no Node server, no secrets in the frontend.

## Experiences
* **Normal CRM** (`/dashboard/ /leads/ /leads/view/?id= /calls/ /pipeline/ /follow-ups/ /meetings/ /proposals/ /settings/`) — daily BD work.
* **Admin control centre** (`/admin/…`) — users, targets, daily/weekly/monthly/board/custom reports, analytics, Google sync, audit, configuration, status.
  Protected by RLS + server-side checks, not just hidden navigation.

## Static hosting
Every client route is emitted as its own `…/index.html` (`scripts/postbuild.mjs`), so refresh / bookmark / Home-Screen launch work on a plain
static host with no rewrites. Dynamic lead pages use `/leads/view/?id=<uuid>`. Public URL/anon key come from `/config.js` (runtime) or build env.

## UI: theme, language, design tokens
* **Theme** — one source of truth: `src/lib/theme.tsx` (`ThemeProvider`, preference `light | dark | system` in `localStorage['accord-theme']`).
  The *resolved* theme is always written to `<html data-theme>`; CSS reads only that attribute. `index.html` resolves the same key before
  first paint (no flash), sets `color-scheme`, and the provider keeps `<meta name="theme-color">` in sync. "System" follows OS changes live.
* **Logo** — `Logo` in `components/Layout.tsx` always follows the active theme. `public/brand/accord-logo-dark.png` is a high-contrast
  recolour of the supplied artwork (`scripts/make-brand-variants.py`; the original dark file is kept, not deployed, as `assets-src/accord-logo-dark-original.png`);
  `accord-mark-*.png` (the wordmark's "A") is used in the collapsed tablet sidebar.
* **Language** — `src/lib/i18n.tsx`: English is the source; `t('English phrase', vars)` looks the phrase up in `src/lib/i18n-ar.ts`
  (missing keys fall back to English). Preference in `localStorage['accord-lang']`; `<html lang dir>` set before first paint and on change.
  Arabic = RTL via CSS logical properties (no per-component overrides). Emails / phones / URLs / IDs / codes stay LTR (`bdi`, `.ltr`,
  `input[type=email|tel|url]`). **Only UI labels are translated** — DB keys (`labels.ts` maps, stage/outcome keys) are unchanged;
  admin-edited stage labels are shown as entered. Dates use `ar-EG` with Latin digits.
* **Design tokens** — `src/index.css` `:root` (light) and `:root[data-theme='dark']` (layered navy surfaces: bg → sidebar → surface →
  surface-2 → surface-3). Components use tokens only (`--primary-text` for links/active states, `--ring` for focus).
* **Settings** — `/settings/?section=profile|appearance|language|security|about`; Admin → Configuration exposes working days, optional call
  outcomes, stage display labels and the company display name — all writes go through admin-only RLS and the existing audit trigger.

## Data model (public schema)
`profiles` · `leads` (+`lead_rollups` denormalised, trigger-maintained) · `contacts` · `call_sessions` · `call_attempts` · `user_targets` ·
`follow_ups` · `meetings` · `commercial_forms` · `proposals` · `attachments` · `projects` (Sheet2) · `activities` (timeline) ·
`sync_runs` / `sync_errors` · `audit_logs` (append-only) · `settings` · `pipeline_stages` · `call_outcomes` · `activity_types`.

* **Temperature** (`cold/warm/hot/lost/closed`) and **pipeline stage** are independent columns; nothing infers one from the other.
* **Calls**: every attempt is a row (`log_call` RPC). Outcomes come from `call_outcomes` (responded / did_not_respond active; busy, voicemail, … switchable later).
  "Today" is derived from timestamps on Cairo day boundaries — nothing is reset or deleted at midnight.
* **Targets**: effective-dated, non-overlapping (exclusion constraint); `set_user_target` retires/closes rows, history preserved.
  Achievement is never capped. Period targets = Σ daily targets over **working days** (`settings.working_days`, default Sun–Thu); a single-day report uses that day's target.
* **Meetings**: status (`requested/scheduled/completed/missed/cancelled/rescheduled`) · confirmation · attendance (explicit, never inferred).
  Not-attended / reschedule creates a **new linked meeting**; the original is preserved. Minutes are only accepted after "Attended".
* **Forms / proposals**: CHECK constraints refuse "sent/completed" without the real date; "no response" never means lost; accepted/rejected only via an explicit response.
* **Pipeline suggestions** (`lead_list_v.suggested_stage`) are advisory; the UI applies a stage only after confirmation.
* **Timeline** (`activities`) is written only by SECURITY DEFINER triggers from verified events; users cannot insert fabricated events.
* **Audit**: generic trigger on all business tables records actor, entity, action, old/new JSON diff. Append-only (UPDATE/DELETE/TRUNCATE blocked, even for admins).
  High-volume call *inserts* are not individually audited (edits/deletes are); sync imports are audited once per run.

## Access model (RLS — default deny, anon has no table access)
| Role | Access |
|---|---|
| admin | full management (all tables, reports, users via Edge Function) |
| bd_executive | reads the shared lead pool; logs own calls; edits/deletes **own calls of the current Cairo day**; owns/edits own follow-ups, meetings, forms, proposals; edits leads they own or that are unassigned; own metrics only |
| viewer | read-only |
| inactive / no profile / anonymous | nothing (`is_member()` is false → every policy denies) |

Design choice: leads/contacts/call history are a **shared readable pool** (prevents duplicate outreach); writes are ownership-scoped. Team analytics are admin-only RPCs.

## Edge Functions (service role; JWT verified + active admin profile checked server-side; role in the request body is never trusted)
* `admin-users` — create/invite, update role/active/target, reset email, temporary password (never stored/logged/returned), last-admin & self-lockout guards, deactivation also bans the Auth user.
* `google-sheet-sync` — `scan | preview | sync`; spreadsheet id is fixed server-side (cannot be chosen by the browser); read-only Sheets scope.

## Google sync rules (`sync_apply_leads` / `sync_apply_projects`)
Match order: **Lead ID** → **Company + Email** → **Company + Phone**; name-only match is used only when it cannot be a different organisation; otherwise a **conflict** is logged (never merged).
A Lead ID that points at a *manually created* lead with a different company name is a conflict. Multi-value cells (emails, phones, LinkedIn, `Name | Title` contacts) are parsed into one company-level contact + one contact per named person.
Sheet `Status` seeds Temperature only on first import; CRM-owned fields (temperature, stage) are never overwritten afterwards. Legacy `Called/Sent/Contacted` flags are kept as legacy data — **they do not create call history**.
Sheet2 → `projects` (never creates leads, never auto-links to companies). Repeated runs are idempotent (unique keys + comparison before update).

## Known limitations / assumptions
* Hosted Supabase project **not provisioned by the build session** (free-plan limit) — see SETUP.md. Auth "allow sign-ups" and redirect URLs are dashboard settings.
* Initial pipeline stage for imported leads: `outreach` if the sheet shows Sent/Contacted/Called, else `research` (editable; never auto-advanced).
* Working week default Sun–Thu (Egypt) — configurable in Admin → Configuration.
* Calling Sessions are implemented (start/stop, session totals); daily totals always include all attempts.
* Report export = CSV (Excel-compatible, UTF-8 BOM) and browser Print/PDF; no server-side PDF.
* Edge Function tests ran under Deno 2.9 against a mocked GoTrue/Google; they have not been executed on hosted Supabase.
* No realtime subscriptions: dashboard metrics update after each successful write and refresh every 60 s.
* UI translation covers the shell, auth, settings, dashboard, all lists, dialogs, reports and admin pages. Free-text data, activity
  summaries written by the database (timeline) and server error messages are shown as stored (English).
