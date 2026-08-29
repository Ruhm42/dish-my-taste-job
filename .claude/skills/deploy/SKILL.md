---
name: deploy
description: Ship dish-my-taste-job to production. Pushing to main deploys through GitHub Actions; this covers what to check before pushing, what the pipeline cannot verify, and how to roll back. Use when the user asks to deploy, push to prod, ship, release, check a deploy, or roll back.
user-invocable: true
---

# /deploy — pushing to `main` is the deploy

**One act, not two.** `git push origin main` runs `.github/workflows/ci.yml`, and if `check`
passes — secret scan, `tsc`, `npm test`, `npm run build` — the `production` job deploys and
verifies. Nothing is run from this machine.

Two consequences of that, both improvements on the manual deploy this replaces:

- **Production is the pushed commit.** The workflow checks out that SHA and uploads it.
  A CLI deploy from a laptop uploaded the *working tree* instead, so untracked files that
  `.gitignore` did not cover became production, and a tree behind `origin/main` silently
  reverted someone else's commits. Neither is possible now, so this skill no longer asks for
  a clean tree or a `git fetch`.
- **A red build cannot reach production.** `production` declares `needs: check`. That is
  structural: there is no order of operations that deploys a failing tree.

What the pipeline **cannot** do is section 3. That is most of what is left here.

---

## 1. Before you push

### Stop the dev server first — this one bites often

Only relevant because you will likely want to build locally first. `next dev` and `next build`
write to the **same `.next` directory**. Building while the dev server runs overwrites the
client manifest underneath it, and the dev server starts throwing 500s that have nothing to do
with your code:

```
Could not find the module ".../segment-explorer-node.js#SegmentViewNode"
  in the React Client Manifest
TypeError: __webpack_modules__[moduleId] is not a function
GET /login 500
```

Nothing is broken in the source — `npx tsc --noEmit` stays green throughout, which is what
makes this so confusing. Only `.next` is corrupt.

```bash
for pid in $(pgrep -f 'next dev' 2>/dev/null); do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [ "$cwd" = "$PWD" ] && echo "dev server for THIS repo: pid $pid"
done
```

**Compare the working directory, do not just match `next dev`.** This project is often open in
several Claude Code worktrees at once, each with its own `.next`; those are harmless and
stopping them is pure collateral damage. Only a dev server whose cwd is *this* checkout shares
the directory being written.

If one is found, stop it before building — `preview_stop` when it was started through the
browser pane, otherwise `kill <pid>`. **Restart it afterwards, and expect to**: once
`npm run build` has run, `.next` holds a production build and the dev server has to regenerate
it. `rm -rf .next` first if the 500s persist.

### Is the schema ahead of the database?

**If the change touches `lib/db/schema.ts`, stop.** The column or enum must exist in production
*before* the code reading it ships. `drizzle/` is not a record of production — the checked-in
migration predates the `cuisine` column production already has — and `db:push` pointed at
production will ALTER and DROP.

The workflow enforces this too: the `production` job refuses a push whose diff touches that
file. Applying the column by hand and then re-running is section 5.

### Running the checks locally is optional now

`npx tsc --noEmit`, `npm test` and `npm run build` all run in CI on every push, to every
branch. Running them here first is a faster feedback loop, not a gate. If you do build, read
what it prints rather than chaining it into anything.

---

## 2. Push, and watch the run

```bash
git log --oneline origin/main..HEAD
git push origin main
```

A rejected push almost certainly means the weekly keepalive workflow committed. Resolve with
`git pull --rebase origin main`. GitHub may answer with a Dependabot vulnerability count.
Report it, but **never run `npm audit fix --force` as part of a deploy**: it pulls a major
Next.js upgrade.

Then follow the run. The `production` job asserts, in order:

| Step | What it proves |
|---|---|
| `vercel pull` + `projectName` assertion | it is deploying into **this** project, not a new one `--yes` invented |
| `vercel deploy --prod --logs` | the artifact compiled **remotely**, which a local build never proves |
| `inspect --json` → `readyState` / `target` | the deployment is `READY` and targets production |
| `inspect <alias>` → `Fetched deployment` | the **alias moved** to the new deployment |
| four `curl` probes | `middleware.ts` deployed and its Supabase variables are present |

If the run is red, the job summary carries the rollback commands. Section 4 explains them.

---

## 3. What the pipeline cannot verify — this is the part that needs you

### Everything past the login form

The four probes CI runs (`/` → 307, `/recherche` → 307 with `?suite=`, `/login` → 200,
`/api/etablissements` → 401 `{"error":"non autorisé"}`) **all come from `middleware.ts`**,
before any route handler, page render or database query. Passing 4/4 proves the middleware
deployed and its Supabase env vars are present. It proves nothing about the database, the API
payload, or any rendered page.

Creating a test account is blocked (D14: signup disabled, accounts are the allowlist). So
`/recherche`, the map, pagination and the API payload **cannot be checked from a shell at
all**. Say that plainly rather than implying the app was checked.

> **A single successful page load proves nothing — and neither does a hundred from here.**
> The outage recorded in D23 was intermittent: concurrent queries on a pooled connection,
> failing only sometimes. It was validated on one good load and shipped broken. But every path
> reachable without a session stops at the middleware, so repeating `curl /` measures the
> middleware, not the pool.
>
> **A D23-class regression cannot be verified from an unauthenticated shell.** If the deploy
> touched `lib/db/`, `app/recherche/` or `app/api/etablissements/`, say so and ask the user to
> reload `/recherche` several times in a logged-in browser. That check is theirs, not yours.

### Runtime logs

CI does not read these: they need a time window and a human.

```bash
npx vercel logs dish-my-taste-job.vercel.app --since 10m --level error -x
npx vercel logs dish-my-taste-job.vercel.app --since 10m --status-code 500 -x
```

Zero rows from both is the pass. **`-x` is required**: without it each request is one summary
line with no message body, so `57014`, `statement timeout`, `ECONNREFUSED` or a digest could
never appear even if they had occurred. An empty window 30 seconds after a deploy only means
nobody has used the site — get the user to load a page first.

### Production data untouched

Optional, and only worth it if something looks wrong: a deploy does not write to the database,
and CI holds no `PROD_DATABASE_URL`. To confirm by hand, run this **before** the push and again
after, and compare — a single count taken afterwards has nothing to compare with and passes
against any value.

```bash
export PGURL=$(grep '^PROD_DATABASE_URL=' .env.local | cut -d= -f2-)
docker run --rm -e PGURL postgres:17-alpine sh -c \
  'psql "$PGURL" -tAc "SELECT '\''restaurant='\''||(SELECT count(*) FROM restaurant)||'\'' cell='\''||(SELECT count(*) FROM cell)||'\'' sirene='\''||(SELECT count(*) FROM sirene_establishment)"'
unset PGURL
```

**`-e PGURL` with no value is deliberate.** It tells docker to forward the variable from its own
environment, so the password never enters any command line. Writing `-e PGURL="$PGURL"` instead
puts it in `docker run`'s arguments, where `ps` exposes it to every user on the machine for as
long as the query runs — measured: one occurrence with the value form, zero with the name-only
form. The single quotes around the `sh -c` body matter for the same reason.

`PROD_DATABASE_URL` uses port `6543`, the transaction pooler — correct for the serverless
runtime, and `lib/db/client.ts` keys `prepare: false` off that port. `psql` works fine on
`6543`; only `pg_dump` requires the `5432` session pooler. `SELECT` only.

### What changed since the previous deploy

```bash
PREV=$(npx vercel ls --prod --json 2>/dev/null | python3 -c "
import json,sys
d = json.load(sys.stdin)['deployments']
print(next((x['meta'].get('githubCommitSha') or x['meta'].get('commit','') for x in d[1:] if x['state']=='READY'), ''))")
echo "previous production commit: ${PREV:-unknown}"
```

```bash
files=$(git diff --name-only "$PREV"..HEAD) || echo "BAD REF — cannot say what changed"
printf '%s\n' "$files" | grep -E '^(app|components|lib|middleware|next\.config|package(-lock)?\.json|drizzle)' || echo "no runtime code changed"
```

`d[1:]` skips the deployment just published; the first `READY` entry after it is the one that
was live before. Filtering on `READY` matters — `vercel ls --prod` lists `● Error` rows too, and
those never served anything. If `PREV` comes back empty, say the previously deployed commit is
unknown and skip the diff rather than guessing a ref. Keep the last two commands split: `|| echo`
on a single pipeline swallows git's "unknown revision" and prints the reassuring "no runtime code
changed" instead.

### Checking the alias by hand

Only needed if you are diagnosing something; CI asserts it on every deploy.

```bash
npx vercel inspect dish-my-taste-job.vercel.app 2>&1 | head -5
```

Pass the **alias hostname**, and keep the `2>&1` — this output goes to stderr. The line that
matters is `Fetched deployment "<hostname>"`.

> **Do not use the `Aliases` block printed by `vercel inspect <deployment-url>`.** It lists
> aliases a deployment *may* serve, not the one currently bound — the previous production
> deployment prints the identical two aliases, so that block reports success even if the alias
> never moved. **`x-vercel-id` is not a deployment identity either**: it is a per-request id and
> differs on every call.

> **The deployment hostname 302s to Vercel SSO — that is normal.**
> `dish-my-taste-<hash>-hipopo-2684.vercel.app` sits behind Deployment Protection and answers
> `302 → vercel.com/sso-api` on **every** path, static assets included. Only
> `dish-my-taste-job.vercel.app` serves the real application. Preview URLs behave the same way,
> which is why the workflow runs no probes against them. Do not read that as a broken deploy,
> and do not try to defeat it.

---

## 4. If it went wrong

**The workflow never rolls back on its own** — deliberately. `vercel rollback` takes the
deployment you want to go back **to**, and has two ways of turning on you.

> **Never pass the production alias.** It resolves to the deployment currently live — the broken
> one — so the command reverts to itself. **And never run it bare:** with no argument the CLI
> substitutes the `status` sub-command and rolls nothing back.

```bash
npx vercel ls --prod
```

Pick a row that is `● Ready` (the list includes `● Error` rows, which cannot be promoted) and is
not the deployment just published. Then:

```bash
npx vercel rollback <previous-deployment-hostname> --yes
npx vercel rollback status
npx vercel inspect dish-my-taste-job.vercel.app 2>&1 | head -5
```

The last line must name the deployment you rolled back to. `npx vercel promote
<previous-deployment-hostname>` is the equivalent forward-facing form.

`origin/main` is now ahead of production. Do not force-push — **revert forward instead**, which
also re-runs the pipeline.

---

## 5. Re-running a deploy, and getting past the schema guard

**Redeploy the current `main` without a commit**: Actions tab → *CI* → *Run workflow* on `main`.
A `workflow_dispatch` on `main` runs `check` and then `production`, exactly like a push.

**Ship a schema change**, once the column or enum exists in production:

1. Apply it to the production database by hand. Never `db:push`.
2. Push the code. The `production` job fails on the schema guard — expected.
3. Re-run via *Run workflow* on `main`. The guard is skipped on `workflow_dispatch`, because
   dispatching it is the deliberate statement that step 1 happened.

**A commit that should not deploy at all**: put `[skip ci]` in the message. The weekly keepalive
commit needs nothing — `.github/last-activity.txt` is in the workflow's `paths-ignore`.

---

## Never, during a deploy

- **Never run `npm run sweep:google -- --go` or `npm run cron:refresh -- --go`**, nor their raw
  forms. They spend real Google quota against a billing account with no trial credit, and have
  nothing to do with deploying.
- **Never run `npm run db:push` or `npm run db:pull`.** `drizzle.config.ts` targets whatever
  `DATABASE_URL` holds; pointed at production, `drizzle-kit push` will ALTER and DROP.
- **Never `npm audit fix --force`.**
- **Never force-push `main` to undo a bad deploy.** Revert forward.
- **Never deploy by hand with `npx vercel deploy --prod`** unless the pipeline itself is broken
  and the user asked for it. It uploads the working tree rather than a commit, which is the
  failure mode moving to CI removed.
