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

---

# Reference motion pass (v2 review build: `accord-crm-v6-ui-experiment-v2.zip`)

The reference screen recording (an Instagram reel of a dark CRM dashboard, 23.6 s) was received and analysed frame by
frame (cropped to the dashboard area, 15 fps, frame differencing to locate every motion event). Only motion
principles were taken; the reference's branding, colours, text and layout were not copied. The reel's own camera zooms
(about 3.2 s and 22.7 s) are video editing, not UI motion, and were ignored.

**What the reference does**:
* the shell and panel frames are present at once; the DATA carries the motion;
* numbers count up together, about 0.9 s on an expo-out curve (fast start, long settle);
* progress fills in step with the numbers;
* bars grow left → right, about 50 ms apart; lines draw left → right; donut arcs draw in sequence;
* rows enter top → bottom, about 35 ms apart;
* page change is a fast crossfade (about 0.15–0.2 s), then the figures count up again;
* drawers slide in from the side over a dimmed backdrop and slide out on close;
* a pipeline drag lifts the card and highlights the target lane; the card then settles and the counts update.

**What changed in v2 (frontend only)**:
* **Motion tokens**: `--dur-fast` 120 ms, `--dur-standard` 200 ms, `--dur-page` 180 ms, `--dur-panel` 320 ms and
  `--dur-data` 900 ms; easings `--ease-standard`, `--ease-out` (expo-out), `--ease-in`; phases `--t-kpi` 60 ms,
  `--t-chart` 160 ms, `--t-rows` 300 ms. JS count-up uses the same curve and duration.
* **One composition**: panels settle almost together (no long per-card cascade). The data choreography runs inside
  them: KPI numbers and meters from 60 ms, bars from 160 ms (≤ 50 ms stagger), donut arcs from 220 ms, rows from
  300 ms. Everything settles in about 1 s.
* **Dashboard opening**: the dashboard frame (KPI band and panels) shows at once while data loads, instead of a
  "Loading…" swap. Today's data is prefetched when the Management link is hovered or focused.
* **Period change**: no reset to zero. Numbers morph from the old value, and bars, stage bars, mixes and donut arcs
  resize from their old size. The view dims only slightly while fetching.
* **Navigation**: the shell stays; the page crossfades in 180 ms starting partly visible, so no frame is ever empty.
  Page code is prefetched when idle.
* **Gliding active indicator**: in the sidebar, period selector, tabs and segmented controls the highlight now moves
  between states. It handles RTL, re-measures on resize and costs nothing at rest.
* **Dialogs / drawers**: they enter, their content follows just after, and they exit along the reverse path. The
  dialog role is dropped immediately on exit.
* **Pipeline**: a dragged card leaves a dashed placeholder. The drag image is a tilted, raised copy. Only the
  destination lane highlights and lifts. The card settles via View Transition, and lane counts morph.
* **Micro-interactions**: buttons, tabs, inputs, focus rings, switches and badges all use the same tokens. Table and
  list rows enter in sequence.
* **Reduced motion**: all of the above is disabled. Values are immediate, indicators jump, and dialogs open and close
  instantly.

**Bugs found and fixed during verification**:
* the indicator's MutationObserver re-triggered itself (page freeze);
* the fixed actions menu sat inside animated table rows and was mispositioned, so it now renders through a portal;
* the source lane highlighted during a drag;
* the skeleton showed a misleading "0" under reduced motion.

**Reference comparison (side-by-side at matched offsets after the click)**:

| Aspect | Reference | v2 |
|---|---|---|
| Page swap | 0.07–0.13 s | about 0.13 s with page code prefetched; about 0.25 s on a cold first visit |
| Frame visible | immediately | the skeleton composition, no "Loading…" text |
| Values start counting | about 0.13 s | about 0.33 s (data fetched from the server; the reference has data locally) |
| Count curve and duration | about 0.9 s, expo-out | 0.9 s, expo-out |
| Settle | about 1.0–1.1 s | about 0.8–1.0 s after data arrives |
| Bars / lines / donut | staggered grow and draw | staggered grow and draw |
| Pipeline drag | lift, target highlight, settle | placeholder, target highlight and lift, view-transition settle, count morph (drag image not visible in recordings, see limitations) |
| Drawer / dialog exit | animated | animated |

**v2 verification**:
* typecheck pass; unit 30/30; SQL 268/268; end-to-end 72/72 (see final results);
* motion probe 6/6, which covers:
  * choreography timings;
  * count-up;
  * period morph with no spinner;
  * view-transition move;
  * real drag-and-drop (placeholder, destination highlight, confirmation, landed);
  * dialog exit (role dropped immediately, gone by 300 ms);
  * tab glide caught mid-transition;
  * 0 blank frames in 24 navigation samples;
  * reduced motion has no running animations;
* indicators at rest: 0 DOM mutations, 0 long tasks, steady 60 fps over 3 s on 3 pages;
* iPad emulation (4× CPU, software rendering, no GPU): animation phase 60 fps median in 2 of 3 runs (30 fps in 1),
  95th percentile 33–50 ms, one 130–165 ms mount task (page render, also present with motion off). Not measured on a
  physical iPad / Safari;
* Arabic RTL and light/dark checked at 1440 / 1024 / 390, including the indicators in RTL.

**Limitations**:
* the OS-level drag image (tilted card) is not captured by page screen recording;
* the dashboard's first values wait for the server round trip, unlike the reference's local data;
* motion was verified in Chromium only (Safari iPadOS untested);
* the reference itself is a low-resolution reel.
