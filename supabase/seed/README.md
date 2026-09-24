# Seeds

| File       | Kind                                                                                                                                                                                                              | Source                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `base.sql` | **Real** owner-supplied configuration (store details, navigation, SEO defaults, feature toggles, trust items) and base page layouts. Idempotent — never overwrites published values or edited sections.           | `data/base/site-settings.json`, `data/base/page-sections.json` |
| `demo.sql` | **Demo** sample data for previews. Every row is `is_demo = true`; remove with `select public.delete_all_demo_data();`. Phase 02: 7 brands, 10 categories, 28 products, 116 variants, 7 offers, 7 content entries. | `data/demo/manifest.json` + dataset files                      |

Both SQL files are **generated** — edit the JSON, then run `npm run seed:generate`
(`npm run seed:check` fails if they are stale). The same JSON is bundled into the frontend
(base settings as the fallback, demo data for demo mode), so the database and the app never drift.

Rules:

- Never put secrets or personal data in seed files.
- Demo content must not be presented as verified real-world facts (prices, specs, availability).
- Owner-supplied campaign names (e.g. iPhone 18 Pro, iPhone 18 Pro Max, iPhone Duo) are used as
  given; missing details stay as clearly-marked, editable demo placeholders.

Demo catalog pipeline (Phase 02): `scripts/seed/demo-catalog.source.mjs` (hand-written demo source) →
`scripts/seed/build-demo-data.mjs` → `data/demo/catalog.json` + `public/demo/media/*.svg` (generated
device illustrations — not product photos) → `demo.sql`. Prices, stock and specs are illustrative;
the owner-named iPhone 18 Pro / Pro Max / iPhone Duo carry "to be confirmed" specs only.
