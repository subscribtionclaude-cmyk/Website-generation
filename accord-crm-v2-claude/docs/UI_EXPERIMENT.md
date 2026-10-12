# ACCORD CRM — UI command-centre experiment (review build, NOT production)

| | |
|---|---|
| Experiment branch | `ui-command-center-experiment` |
| Frozen V6 baseline | `3a0ab97` on `claude/accord-crm-v2-claude` (untouched; local tag `v6-frozen-baseline`) |
| Scope | Frontend presentation and motion only. No change to Supabase, schema, migrations, RLS, RPCs, Edge Functions, auth, roles, permissions, reports maths, exports, terminology engine, PWA or `config.js` values. |
| Review package | `accord-crm-v6-ui-experiment.zip` (ShipStatic-ready, for visual review only) |

**Discard the experiment:** deploy V6 again from `claude/accord-crm-v2-claude` (or `git checkout 3a0ab97`). Nothing on the server depends on this branch.

**Reference video:** the screen recording mentioned in the brief never reached the build environment (no video file was present), so the design and motion follow the written brief only.

## What changed

* **Design system**: warm off-white canvas, white planes, deep-navy actions and ACCORD purple/gold accents; deep navy and charcoal layers in dark mode. Elevation comes from contrast, not shadows. Compact typography with tabular numerals. Tables are lighter, with stronger headers and compact rows. Status colours are muted. Approved ACCORD wordmark and transparent compact icon are unchanged.
* **Shell**: slimmer sidebar (220 px, 64 px icon rail ≤ 1100 px), smaller nav items, gold active marker. Page content crossfades on navigation and the shell never reloads. Navigation runs as a transition (the current page stays until the next is ready). Page bundles are prefetched when the browser is idle.
* **Management Dashboard**:
  * command strip (period, Cairo live state, access scope, report shortcuts);
  * one 6-figure KPI band for the period;
  * department target / calls-per-day trend;
  * conversion, meetings (confirmation and outcome as two separate partitions), follow-ups and commercial panels;
  * snapshot with pipeline distribution (now, share, entered in the period), lead health, proposal status donut and meetings;
  * team performance table with comparison bars (only when individual mode is allowed);
  * the department-only Viewer gets no employee data, exactly as in V6.
* **Admin overview**: KPI band and Sales Team performance. Today's calls, target achievement and response rate show as bars beside the exact values, plus meetings, proposals, follow-ups and won/lost. Order is the server's (most calls first). Neutral colours are used, never red/green rankings.
* **Reports** (daily / weekly / monthly / board): KPI band, trend chart, team table, then meetings, follow-ups, commercial, pipeline, wins and losses, and critical follow-ups as a dense executive layout. The daily breakdown table is collapsible. The calculations and CSV/PDF/board exports are unchanged.
* **Pipeline**: compact cards (company, temperature, last activity, next follow-up, form and proposal state, subtle stage selector), lane share bars and animated lane counts. A confirmed move glides the card to its new column (View Transitions).
* **Calls / Meetings / Follow-ups / Proposals**:
  * **Calls**: KPI band with an outcome split and a trend chart on the weekly/monthly tab.
  * **Meetings**: agenda layout with a time column and a state rail.
  * **Follow-ups**: urgency tiles (overdue, due today, tomorrow, week, upcoming, completed) and dated rows with an urgency rail.
  * **Proposals**: status mix and commercial value (in the current view) with refined status pills.
* **Motion**:
  * staged entrance (header → KPIs → meters → charts → lower sections);
  * headline figures count up;
  * bars grow, lines draw and donut arcs draw;
  * a period/filter change keeps the old figures, dims briefly, then morphs to the new values (no spinner);
  * route crossfade, drawer and sheet slide-ins, subtle micro-interactions;
  * `prefers-reduced-motion` removes all of it.

## Old V6 vs experiment (same demo data, light theme; full-page height in px = scrolling needed)

| Page | 1440 | 1024 (iPad landscape) | 768 (iPad portrait) | 390 (mobile) |
|---|---|---|---|---|
| Management (Viewer) | 2208 → **1599** | 3437 → **2154** | 3455 → **2841** | 3885 → **3537** |
| Management (Admin) | 2452 → **1784** | 3681 → **2339** | 3700 → **3026** | 4111 → **3722** |
| Admin overview | 1578 → **1135** | 1904 → **1529** | 2164 → **1668** | 2422 → **2040** |
| Sales dashboard | 1115 → **909** | 1393 → **1142** | 1393 → **1142** | 1865 → **1646** |
| Daily report | 1969 → **1563** | 2612 → **2069** | 2759 → **2358** | 3240 → **2950** |
| Board report | 2169 → 2143 | 2812 → 2631 | 3074 → 3022 | 3632 → 3671 |
| Proposals | 900 → 900 | 828 → 1052 | 1024 → 1098 | 1007 → 1257 (adds the status mix + value panels) |

* **Dashboard density**: the management view needs 28–37 % less scrolling at 1440 / 1024 while adding a trend chart, a pipeline distribution, a donut and proportion bars that V6 did not have.
* **Management readability**: in V6 it was about 35 identical tiles; the experiment shows one KPI band followed by grouped panels. Snapshot and period are labelled separately.
* **Pipeline readability**: cards are shorter, last activity is visible, and lane share bars and animated counts were added.
* **Report presentation**: the board report keeps a similar length but adds the trend chart, distributions and mixes. The daily report is 20 % shorter.
* **iPad**: at 1024 px the period KPIs, the department target and four panels fit in the first two screens (V6: KPI tiles only).
* **Dark mode**: layered navy/charcoal with restrained accents, verified on every page.

## Verification

* **Typecheck**: pass.
* **Unit tests**: 30/30.
* **SQL / RLS**: 268/268 (unchanged backend).
* **End-to-end**: 72/72 on three consecutive runs and once more after the final change, using the existing V6 suite unchanged. It covers Admin, Sales, Management Viewer, privacy, permissions, reports, exports, Arabic, dark mode, PWA and every static route.
* **Responsive**: no horizontal overflow on any route at 1440 / 1024 / 768 / 390.
* **Screenshots**: 12 pages × 4 widths × light/dark in English, plus Arabic RTL (192 screenshots) reviewed.
* **Motion**, measured in Chromium:
  * stagger timing: header 0 ms → KPIs 60–285 ms → period panels 260–520 ms → snapshot 520–735 ms → team 700 ms;
  * count-up samples 0 → 3 → 4;
  * period switch morphs 4 → 6 → 8 → 9 with no loading flash;
  * a pipeline move triggers one view transition and the lane count updates;
  * reduced motion gives instant values and no running animations.
* **iPad-class performance** (4× CPU throttling, software rendering, no GPU): the animation phase runs at a 60 fps median with the 95th percentile at 33–50 ms. One ~250 ms frame at mount is page rendering and also occurs with motion disabled. Not measured on a physical iPad.

## Known limitations

* Motion fidelity to the reference recording can't be judged because the recording was not received.
* Proposal value and status-mix figures on the Proposals page cover the proposals in the current view (latest 200), which is labelled on screen.
