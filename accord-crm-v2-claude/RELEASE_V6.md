# ACCORD CRM V6 — Production Release (frozen baseline)

| | |
|---|---|
| Release date | 2026-10-11 |
| Git branch | `claude/accord-crm-v2-claude` |
| Git commit (application code) | `47cc26f` (V6) + `ca02655` (security freeze: Management Viewer raw CRM rows hard-denied) |
| Supabase project ref | `olanalmpysrwjgfnbejq` |
| Packages | `accord-crm-v6-production-source.zip`, `accord-crm-v6-production-shipstatic-deploy.zip` |
| Status | Release candidate — **not deployed** |

## Migrations

| # | File | Production state |
|---|---|---|
| 1–10 | `20261009000001_core_schema` … `20261011000010_export_audit` | Applied (recorded in migration history) |
| 11 | `20261012000011_user_delete_history.sql` | **Applied manually in the Supabase SQL Editor** — verified (schema + function logic identical to the file), but it has **no migration-history row**. Do not re-run it. |
| **12** | **`20261013000012_roles_permissions.sql`** | **New in V6 — NOT yet applied.** Additive; changes no business rows. |

Pre-flight checks already made read-only against production: every RLS policy migration 12 replaces exists under
the expected name, none of migration 12's new objects exist yet, and migration 11's columns are present.

## Deployment order

1. Supabase → SQL Editor → paste and run **the whole** `supabase/migrations/20261013000012_roles_permissions.sql` (one run).
2. Verify (read-only): `select count(*) from permission_catalog;` → 25, and `select role, count(*) from role_permissions group by role;`
   → bd_executive 12, viewer 11.
3. Edge Functions: **none to deploy** (the deployed `admin-users` v2 is current; V6 adds no Edge Function change).
4. Deploy `accord-crm-v6-production-shipstatic-deploy.zip` to ShipStatic (contents at ZIP root).
5. Smoke test in the browser (below).

If the frontend is ever deployed before step 1, it falls back to the pre-V6 behaviour by role (no management pages)
instead of breaking.

## Roles

| Role (canonical key) | Default display label | Purpose |
|---|---|---|
| `admin` | Admin | Full control. Protected: cannot be reduced; last-admin and self protections unchanged. |
| `bd_executive` | Sales | Operational CRM team member (leads, calls, follow-ups, meetings, forms, proposals, pipeline). |
| `viewer` | Management Viewer | Management / Senior Management / HR / authorised observers. Read-only. |

Display labels (English + Arabic) are editable in Admin → Terminology and never change keys or data.

## Permission model

* **Catalog** (`permission_catalog`): 25 permissions in 6 sections — Dashboard, People / performance, Reporting,
  Operational data, Export, Administration. Each has a per-role mode: `config` (admin-configurable), `on` (always) or
  `off` (never grantable — hard rule) and an optional dependency.
* **Role templates** (`role_permissions`) for Sales and Management Viewer; **user overrides** (`user_permission_overrides`).
* **Resolution** (deterministic, deny by default): inactive / deleted / anonymous → DENY · admin → ALLOW · mode `off` → DENY ·
  mode `on` → ALLOW · explicit user override · role template · otherwise DENY · then every dependency must hold.
* **Hard rules** (not configurable): Management Viewer can never get raw CRM rows (leads, contacts, calls, meetings,
  follow-ups, proposals/forms, timeline, files — and so never notes, meeting minutes, contact emails or phones), colleagues'
  profiles, user management, permission administration, configuration, sync, audit, system, dataset exports or the full CRM export; Admin cannot be reduced; anonymous,
  inactive and deleted users are always denied; Sales operational data is always on.
* **Enforcement is server-side**: raw-table RLS is staff-only (Admin + Sales), so no permission row — even one forged
  past the RPCs — can expose a raw record to a Viewer; `management_report()` builds the payload from the caller's
  effective permissions (department aggregates; employee KPI rows — calls, response rate, meetings, proposals,
  follow-ups due/completed/overdue, won/lost — only with *Individual employee performance*; names only with *Employee names*; individual targets only with *Individual
  targets*; never notes, minutes, contact details, lead names or auth data). Admin RPCs re-check `is_admin()`.
* **Defaults**: Management Viewer = management dashboard, department totals/trends/target, daily/weekly/monthly/board
  reports, management summary export; **department only** (no employee-level data), no raw rows, no full export.
  Sales = current operational behaviour + dataset exports; no management dashboard, no other employees' performance.
* **Audit**: every role-template change, user override, reset and terminology change is written to `audit_logs`
  (actor, target, permission, old → new, timestamp); audit rows are immutable.
* **Preview as role** (Admin → Roles & Permissions): UI-only; the identity and JWT never change, and every write is
  answered locally with a 403 while previewing.

## Test results (local stack: Postgres 16 + PostgREST + mock GoTrue + real Edge Functions)

| Suite | Result |
|---|---|
| Typecheck | pass |
| Unit (vitest) | 30 / 30 |
| SQL behaviour + RLS + permissions | 268 / 268 (95 for migration 12, incl. forged-permission-row hard-deny tests) |
| End-to-end (Playwright) | 72 / 72 on 3 consecutive full runs (new governance spec: viewer privacy in API + page, reports/exports without names, role templates + dependencies, user overrides + reset, preview read-only, terminology EN/AR, role-change summary, direct API bypass attempts, Viewer raw-row hard deny on every raw table/view, admin + sales raw access unchanged) |
| Responsive | 1440 / 1024 / 768 / 390 for every route incl. Management, Roles & Permissions, Terminology; Arabic RTL light + dark checked at all four widths for the Management Dashboard (individual mode) and Roles page, no horizontal overflow |
| Static build | 31 route entry points + 404, every route and asset HTTP 200 |
| Secret scan | clean (only the public anon key in `config.js`) |

## Known limitations

* PDF reports use the browser's "Save as PDF" (exact Arabic shaping); not a direct file download.
* Migration 11 has no row in Supabase's migration history (applied through the SQL Editor).
* Live (hosted) HTTP tests of the Edge Function and of V6 could not run from the build environment (outbound access to
  `*.supabase.co` is blocked there); all behaviour above was verified on the local stack.
* Public sign-up must remain disabled in Supabase → Authentication (not changed by V6; not re-verifiable from here).

## Browser smoke test after deployment

1. Admin: Management Dashboard shows the Sales Team table with names; Admin → Roles & Permissions loads.
2. Management Viewer: lands on the Management Dashboard, sees department totals only, no Leads/Calls/… pages.
3. Admin → Roles & Permissions → *Preview as Management Viewer* → banner shows; *Exit preview*.
4. Sales: normal operational CRM, no Management Dashboard.
5. Admin → Terminology: change a label, confirm it shows, then clear it again.
