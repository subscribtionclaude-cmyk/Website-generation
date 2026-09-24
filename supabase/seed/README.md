# Seeds

| File       | Kind                                                                                                                                              | Source                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `base.sql` | **Real** owner-supplied configuration (store details, navigation, SEO defaults, feature toggles). Idempotent — never overwrites published values. | `data/base/site-settings.json`            |
| `demo.sql` | **Demo** sample data for previews. Every row is `is_demo = true`; remove with `select public.delete_all_demo_data();`. Empty until Phase 02.      | `data/demo/manifest.json` + dataset files |

Both SQL files are **generated** — edit the JSON, then run `npm run seed:generate`
(`npm run seed:check` fails if they are stale). The same JSON is bundled into the frontend
(base settings as the fallback, demo data for demo mode), so the database and the app never drift.

Rules:

- Never put secrets or personal data in seed files.
- Demo content must not be presented as verified real-world facts (prices, specs, availability).
- Owner-supplied campaign names (e.g. iPhone 18 Pro, iPhone 18 Pro Max, iPhone Duo) are used as
  given; missing details stay as clearly-marked, editable demo placeholders.
