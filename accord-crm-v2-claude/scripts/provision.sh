#!/usr/bin/env bash
# One-shot provisioning of the CLAUDE Supabase project using the Supabase CLI.
# Prereqs: `supabase login` done by YOU (never paste tokens into chat), a NEW empty project created in your Supabase org.
# Usage: PROJECT_REF=abcdefghijklmnop SITE_URL=https://your-site.shipstatic.com ./scripts/provision.sh
set -euo pipefail
: "${PROJECT_REF:?set PROJECT_REF to the Claude project ref}"
: "${SITE_URL:?set SITE_URL to the ShipStatic URL (https://…)}"
[ "$PROJECT_REF" != "kqoodjnxcksejjeflelc" ] || { echo "REFUSING: that is the forbidden Codex project"; exit 1; }
cd "$(dirname "$0")/.."
supabase link --project-ref "$PROJECT_REF"
supabase db push                                    # applies supabase/migrations/*.sql in order
supabase secrets set SITE_URL="$SITE_URL" ALLOWED_ORIGINS="$SITE_URL" --project-ref "$PROJECT_REF"
supabase functions deploy admin-users --project-ref "$PROJECT_REF"
supabase functions deploy google-sheet-sync --project-ref "$PROJECT_REF"
echo "Done. Next: (1) run supabase/bootstrap-first-admin.sql, (2) Auth settings in docs/SETUP.md §4, (3) Google secrets §6."
