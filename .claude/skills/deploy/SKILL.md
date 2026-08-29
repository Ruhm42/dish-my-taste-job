---
name: deploy
description: Ship dish-my-taste-job to production — preflight checks, push to GitHub, manual Vercel deploy from the local machine, then verify what actually landed. Use when the user asks to deploy, push to prod, ship, or release.
user-invocable: true
---

# /deploy — push to GitHub, then deploy to Vercel by hand

Two separate acts. **Pushing does not deploy anything.**

The Vercel GitHub App is not installed on this repository, so there is no deploy-on-push.
Every production deploy is a CLI deploy from this machine.

Two consequences worth holding on to:

- **`vercel deploy` uploads the working tree and builds remotely.** It does not build from a
  git ref, and it does not ship your local build. So the tree — including untracked files
  `.gitignore` does not cover — is what becomes production.
- **The deployed commit cannot be read back from Vercel.** `vercel inspect --json` carries no
  git fields at all (`id, name, url, target, readyState, createdAt, aliases, builds,
  contextName`). Stamp it yourself at deploy time, or you will never be able to say what is
  running.

---

## 1. Preflight — run each on its own, and read the output

### Am I deploying the right thing, to the right place?

```bash
git fetch origin
git rev-list --left-right --count origin/main...HEAD
```

Two numbers: **behind**, then **ahead**. Behind must be `0`. Because the deploy ships the
local tree rather than a git ref, deploying while behind origin silently reverts someone
else's commits, and no Vercel check will reveal it. A weekly `chore: keepalive` workflow
pushes to `main`, so being behind is normal, not exotic. If ahead is `0`, this is a redeploy
of an already-pushed tree — say so, and expect sections 2 and 3 to have nothing to report.

```bash
cat .vercel/project.json
npx vercel whoami
```

`projectName` must be `dish-my-taste-job`. `.vercel/` is gitignored, so on a fresh clone
`--yes` in section 4 would happily create a **new** project and deploy there, while every
check in section 5 keeps passing against the old, untouched production. If
`.vercel/project.json` is missing, stop and run `vercel link` deliberately.

```bash
git status --porcelain
```

Must print nothing — untracked (`??`) entries count, because there is no `.vercelignore` and
they will be uploaded. Do not commit files just to clear this gate: report them and ask.

### Does it build?

```bash
npx tsc --noEmit
```

```bash
npm test
```

```bash
npm run build
```

**Run the build alone and actually read what it prints.** Never write
`npm run build && vercel deploy`. Chaining those two once hid a failed build: the deploy step
was reached, the error scrolled past unread, and only luck kept production intact.

A clean build prints exactly this route table — `/`, `/_not-found`, `/api/etablissements`,
`/login`, `/recherche`, plus `Middleware`. A missing route means stop.

> This build is **local**, with `.env.local` and a warm `node_modules`. Vercel builds again,
> remotely, from the uploaded sources. A green build here does not prove the deployed
> artifact compiles — section 4 is where that is checked.

### Record the baseline

```bash
export PGURL=$(grep '^PROD_DATABASE_URL=' .env.local | cut -d= -f2-)
docker run --rm -e PGURL postgres:17-alpine sh -c \
  'psql "$PGURL" -tAc "SELECT '\''restaurant='\''||(SELECT count(*) FROM restaurant)||'\'' cell='\''||(SELECT count(*) FROM cell)||'\'' sirene='\''||(SELECT count(*) FROM sirene_establishment)"'
unset PGURL
```

Write the three numbers down. Section 5 compares against them; a single count taken *after*
the deploy has nothing to compare with and passes against any value.

**`-e PGURL` with no value is deliberate.** It tells docker to forward the variable from its
own environment, so the password never enters any command line. Writing `-e PGURL="$PGURL"`
instead puts it in `docker run`'s arguments, where `ps` exposes it to every user on the
machine for as long as the query runs — measured: one occurrence with the value form, zero
with the name-only form. The single quotes around the `sh -c` body matter for the same
reason: they stop the local shell expanding `$PGURL` before the container sees it.

### Is the schema ahead of the database?

This skill does not touch the schema, and `drizzle/` is not a record of production — the
checked-in migration predates the `cuisine` column production already has. If the change
being deployed touches `lib/db/schema.ts`, **stop**: the column or enum must exist in
production *before* the code reading it ships. That is a manual step outside this skill, and
never a reason to reach for `db:push`.

## 2. Secret scan — this repository is public

```bash
git ls-files -co --exclude-standard \
  | grep -vE '^(\.env\.example|\.claude/skills/)' \
  | xargs grep -inE "postgres(ql)?://[^\"']*:[^\"'@[:space:]]+@|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]{20,}"
```

Scan the **tree, not the diff** — the deploy uploads the tree, and a diff against a stale
`origin/main` can silently narrow to nothing and report a pass while reading zero bytes.
`.env.local` is gitignored and so excluded here; a key pasted into a script, a spec or a test
fixture is not.

`grep` exits 1 when it finds nothing: **exit 1 with no output is the pass.** Never chain this
with `&&`, and never run it under `set -e`.

Three details that are not cosmetic:

- **`postgres(ql)?://`** — this project's connection string uses the `postgresql://` scheme,
  which a bare `postgres://` pattern does not match. The most damaging leak would pass in
  silence.
- **The patterns match credential *shapes*, never variable names.** Matching `service_role`
  or `PGPASSWORD=` as text flags `.specs/` prose and this skill itself on every run, and a
  check that always cries wolf is a check nobody reads.
- **Two paths are excluded on purpose**: `.env.example` holds placeholder credentials by
  design, and this skill file contains the patterns themselves. If you widen the scan, widen
  the exclusions with it — and if a real secret is ever pasted into `.env.example`, this will
  not catch it.

## 3. Push

```bash
git log --oneline origin/main..HEAD
```

Show the user what is about to leave the machine, then:

```bash
git push origin main
```

A rejected push almost certainly means the weekly keepalive workflow committed. Resolve with
`git pull --rebase origin main`, then **re-run sections 1 and 2** — the tree changed.

GitHub may answer with a Dependabot vulnerability count. Report it, but **never run
`npm audit fix --force` as part of a deploy**: it pulls a major Next.js upgrade.

## 4. Deploy

```bash
npx vercel deploy --prod --yes --logs -m commit=$(git rev-parse HEAD)
```

`--logs` prints Vercel's **remote** build output. Read it, and require the same route table
as section 1. This is the only output that says whether the artifact about to serve
production actually compiled.

`-m commit=…` stamps the deployed SHA into deployment metadata — the only way to answer
"what is running?" later.

Keep the deployment hostname it prints, then assert the state machine-readably:

```bash
npx vercel inspect <deployment-hostname> --json | grep -E '"(readyState|target)"'
```

Expect `"readyState": "READY"` and `"target": "production"`. These are `inspect --json` field
names. `vercel deploy` never prints them, and plain `vercel inspect` prints `status ● Ready` /
`target production` instead.

## 5. Verify

### Read this before the green checkmarks

Everything past the login form is gated, and creating a test account is blocked. So
`/recherche`, the map, pagination, the API payload and anything needing a session **cannot**
be verified from here. Say that plainly rather than implying the app was checked.

### The alias, resolved the only way that proves anything

```bash
npx vercel inspect dish-my-taste-job.vercel.app 2>&1 | head -5
```

Pass the **alias hostname**, and keep the `2>&1` — this output goes to stderr. The line that
matters is `Fetched deployment "<hostname>"`; it must name the deployment you just published.

> **Do not use the `Aliases` block printed by `vercel inspect <deployment-url>`.** It lists
> aliases a deployment *may* serve, not the one currently bound — the previous production
> deployment prints the identical two aliases, so that block reports success even if the
> alias never moved.

> **`x-vercel-id` is not a deployment identity either.** It is a per-request id and differs
> on every call.

### The deployment hostname 302s to Vercel SSO — that is normal

`dish-my-taste-<hash>-hipopo-2684.vercel.app` sits behind Deployment Protection and answers
`302 → vercel.com/sso-api` on **every** path, static assets included. Only
`dish-my-taste-job.vercel.app` serves the real application. Do not read that as a broken
deploy, and do not try to defeat it.

### The gate, over plain HTTP

```bash
for p in / /recherche /login /api/etablissements; do
  printf '%s -> ' "$p"
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://dish-my-taste-job.vercel.app$p"
done
curl -s https://dish-my-taste-job.vercel.app/api/etablissements; echo
```

| path | expected |
|---|---|
| `/` | `307` → `/login` |
| `/recherche` | `307` → `/login?suite=%2Frecherche` |
| `/login` | `200` |
| `/api/etablissements` | **`401`**, body exactly `{"error":"non autorisé"}` |

The API path answering `3xx` instead of `401` is a real regression: `middleware.ts` returns
JSON for `/api/` on purpose so client-side `fetch` can react. Mojibake in place of `é` is a
regression too.

> **All four responses come from `middleware.ts`**, before any route handler, page render or
> database query. Passing 4/4 proves the middleware deployed and its Supabase env vars are
> present. It proves nothing about the database, the API payload, or any rendered page.

### Runtime logs

```bash
npx vercel logs dish-my-taste-job.vercel.app --since 10m --level error -x
npx vercel logs dish-my-taste-job.vercel.app --since 10m --status-code 500 -x
```

Zero rows from both is the pass. **`-x` is required**: without it each request is one summary
line with no message body, so `57014`, `statement timeout`, `ECONNREFUSED` or a digest could
never appear even if they had occurred. Run the curl loop first — an empty window 30 seconds
after a deploy only means nobody has used the site.

> **A single successful page load proves nothing — and neither does a hundred from here.**
> The outage recorded in D23 was intermittent: concurrent queries on a pooled connection,
> failing only sometimes. It was validated on one good load and shipped broken. But every
> path reachable without a session stops at the middleware, so repeating `curl /` measures
> the middleware, not the pool. **A D23-class regression cannot be verified from an
> unauthenticated shell.** If the deploy touched `lib/db/`, `app/recherche/` or
> `app/api/etablissements/`, say so and ask the user to reload `/recherche` several times in
> a logged-in browser. That check is theirs, not yours.

### Production data untouched

Re-run the baseline command from section 1. All three counts must be **identical** to the
numbers recorded there.

`PROD_DATABASE_URL` uses port `6543`, the transaction pooler — correct for the serverless
runtime, and `lib/db/client.ts` keys `prepare: false` off that port. `psql` works fine on
`6543`; only `pg_dump` requires the `5432` session pooler (see `scripts/pull-prod.ts`). Never
change the port in the value deployed on Vercel. `SELECT` only.

### What changed since the last deploy

```bash
files=$(git diff --name-only "$PREV"..HEAD) || echo "BAD REF — cannot say what changed"
printf '%s\n' "$files" | grep -E '^(app|components|lib|middleware|next\.config|package(-lock)?\.json|drizzle)' || echo "no runtime code changed"
```

`$PREV` is the SHA stamped by `-m commit=` on the previous deploy. **If no earlier deploy was
stamped, the previously deployed commit is unknown — say so and skip this.** Never guess a
ref: keep the two commands split, because `|| echo` on a single pipeline swallows git's
"unknown revision" and prints the reassuring message instead.

## 6. If it went wrong

`vercel rollback` takes the deployment you want to go back **to**.

> **Never pass the production alias.** It resolves to the deployment currently live — the
> broken one — so the command reverts to itself. **And never run it bare:** with no argument
> the CLI substitutes the `status` sub-command and rolls nothing back.

```bash
npx vercel ls --prod
```

Pick a row that is `● Ready` (the list includes `● Error` rows, which cannot be promoted) and
is not the deployment you just published. Then:

```bash
npx vercel rollback <previous-deployment-hostname> --yes
npx vercel rollback status
npx vercel inspect dish-my-taste-job.vercel.app 2>&1 | head -5
```

The last line must name the deployment you rolled back to. `npx vercel promote
<previous-deployment-hostname>` is the equivalent forward-facing form.

If you had already pushed, say so: `origin/main` is now ahead of production. Do not
force-push — revert forward instead.

## Never, during a deploy

- **Never run `npm run sweep:google -- --go` or `npm run cron:refresh -- --go`**, nor their
  raw forms. They spend real Google quota against a billing account with no trial credit, and
  have nothing to do with deploying.
- **Never run `npm run db:push` or `npm run db:pull`.** `drizzle.config.ts` targets whatever
  `DATABASE_URL` holds; pointed at production, `drizzle-kit push` will ALTER and DROP.
- **Never `npm audit fix --force`.**
- **Never chain build and deploy in one command.**
- **Never deploy from a dirty or behind-origin working tree.**
