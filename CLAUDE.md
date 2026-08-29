# dish-my-taste-job

A prospecting directory for hospitality workers looking for a job in Lyon. It lists
restaurants and filters them by **working rhythm** — no split shifts, free weekends,
consecutive days off.

The project reference lives in [`.specs/`](.specs/README.md). Read
[`.specs/DECISIONS.md`](.specs/DECISIONS.md) before changing anything structural: every
decision records the options that were rejected and why.

## Language rules — non-negotiable

**Code is English. Always.** Identifiers, comments, commit messages, CLI output, test
names, file names, database columns and enum values. No exceptions, including for domain
terms — write `splitShiftRisk`, not `risqueCoupure`.

**Product text is French.** Anything an end user reads stays in French: UI labels, and the
explanation strings the inference engine generates (`Coupure très probable — ouvert
12h-14h30 puis 19h-22h30, 3 à 5 salariés`). The audience is a French hospitality worker.

**Specs are French.** `.specs/` is project documentation, not code.

The boundary is the screen: if a human reads it in the browser, it is French. Everything
else is English.

### Domain vocabulary

Use these translations consistently — the domain terms have no obvious English equivalent
and inconsistency makes the codebase unsearchable.

| French | English | Meaning |
|---|---|---|
| coupure | split shift | The unpaid gap between lunch and dinner service |
| horaires d'ouverture | opening hours | When the restaurant is open to customers |
| fenêtre de service | service window | One continuous open period on one day |
| effectif | headcount | SIRENE staff bracket, used to infer split shifts |
| balayage | sweep | The monthly Google Places crawl |
| maillage / cellule | grid / cell | The search circles the sweep walks through |
| fiabilité | confidence | How much to trust an inferred verdict |
| candidature | application | A job application the user tracks |
| métier | trade | A hospitality job title, keyed by its ROME code |

## Cost constraints — read before touching `scripts/`

The project must run at **zero euro**. There is **no trial credit** on the billing account:
any overage bills a real card.

- **`Nearby Search` only.** `Place Details`, `Text Search`, `Autocomplete` and Photos are
  capped at **0/day** on the Google side. Calling them fails rather than bills.
- **`FIELD_MASK` is a single shared constant.** Never build it dynamically — billing
  follows the most expensive field requested.
- **Every script that spends quota is `--dry-run` by default** and needs an explicit flag
  to spend.
- Guard ordering is deliberate: script counter (900) < Google daily cap (1000) = free
  monthly quota. A single sweep can therefore never cause billing.

See [`.specs/technique/02-budget-google-et-garde-fous.md`](.specs/technique/02-budget-google-et-garde-fous.md).

**Never run `sweep:google` with `--go` without being asked to.** It spends real quota.

## Commands

```bash
npm run db:up            # local Postgres (docker, port 5434)
npm run db:push          # apply the Drizzle schema
npm run db:pull          # copy production into the local DB (public schema only, never auth)
npm run seed             # 37 fictional demo establishments
npm run dev              # Next.js
npm test                 # vitest
npx tsc --noEmit         # typecheck
```

Pipeline, in order. Only `sweep` costs money:

```bash
npm run ingest:sirene    # SIRENE registry via remote Parquet (DuckDB)
npm run ingest:geocode   # BAN batch geocoding
npm run plan:cells       # dry-run by default; --write to persist the plan
npm run sweep:google     # dry-run by default; --go to actually spend
npm run match:sirene     # link Google places to SIRENE headcount
npm run compute:profiles # recompute rhythm profiles offline, no network
```

Scripts need env vars, so they run through `node --env-file=.env.local --import tsx`.

## Conventions

- **Node 24** (pinned in `.nvmrc` and `engines`). Node 18 is end-of-life.
- Comments explain **why**, never **what**. Prefer no comment to a redundant one.
- Don't over-engineer. No speculative abstraction, no layer that isn't earned.
- **Fail loudly.** A sweep that returns a silently incomplete database is worse than one
  that errors: a missing restaurant is invisible in the UI. This is the project's main
  failure mode — see `.specs/technique/03-algorithme-de-balayage.md`.
- Data about establishments is **read-only**. Users only ever write their own applications.

## Gotchas that cost time

- **SIRENE codes Lyon by district** (`69381`-`69389`), never by the global commune code
  `69123` that the government geo API returns. Filtering on the API's list drops all of
  Lyon — 55% of the dataset — with no error raised.
- **Google `regularOpeningHours`**: `day` 0 is Sunday; a past-midnight close carries the
  *next* day; a 24/7 place returns an open period with **no close**.
- **Google Maps JS**: `loading=async` requires the `callback` parameter. The script's
  `load` event fires before the constructors exist.
- **A map load is billed per `new google.maps.Map()`**, not per pan or zoom. Instantiate
  once per visit and only swap markers.
- **Google referrer restrictions do not wildcard the port.** `http://localhost:*/*` looks
  like it covers every dev port; it covers none. The wildcard applies to subdomains and to
  the path, never to the port, so each port has to be listed on its own. And the failure is
  quiet from our side: a refused key does not reject the script, it loads and then Google
  paints its own panel over the map — only `gm_authFailure` surfaces it.
