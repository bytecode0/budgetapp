---
name: deploy
description: Deploy the app to production (budget.luisvespa.com on Vercel) by merging a pull request into main. Verifies the build, gates any production schema change behind the user's own `db push`, merges, waits for CI and the Vercel deployment, then smoke-tests production. Use when the user asks to deploy, ship to production, publish, merge a PR to production, or "subir a producción".
---

# Deploy to production

Production = `https://budget.luisvespa.com` (it may move to `app.luisvespa.com`, LPBETA-25 in `docs/tickets.md`: use whatever `APP_URL` production answers on). Vercel project linked to GitHub `bytecode0/budgetapp`. Vercel's Git integration deploys every push to `main` on its own. **Deploying = merging a pull request into `main`.** This skill makes that merge safe and confirms it landed.

Stop at the first failed step, say what failed, and don't work around it.

## 1. Preconditions

- The work is on its own branch, pushed, with a PR against `main` (one PR per ticket or block). If there is no PR yet: `gh pr create --base main --head <branch> --title … --body-file …` (PR body in Spanish, ends with the Claude Code attribution line).
- The branch is up to date with `origin/main` (rebase if not) and `npm run verify` passes on it (typecheck + tests + build). If the change touches money, households or the database, `npm run test:integration` also passes against a throwaway local Postgres (see the integration test files for the setup).
- `gh` and `vercel` talk to GitHub/Vercel over TLS: in the sandbox they fail with `x509: OSStatus -26276`; run them with the sandbox disabled.

## 2. Production schema changes (never automatic, never by Claude)

```bash
git fetch origin main
git diff origin/main...<branch> -- prisma/schema.prisma
```

If there's no diff, skip to step 3.

If there is one:
1. Show the diff and explain in one line per change what it does to the production database (new table/column = additive; removed/renamed/retyped = **data loss**). Additive changes are pre-approved (memory "autonomia-aprobada"); anything that removes or retypes needs the user's explicit OK, knowing what is lost.
2. **The user applies it before the merge**, so the new code never runs against the old schema (the generated Prisma client selects every column: a missing one breaks every query on that table). Production secrets never reach Claude, and Neon's Vercel variables are *Sensitive* (`vercel env pull` writes `[SENSITIVE]`), so the user runs it **in their own terminal, not with `!`**:
   ```
   cd ~/MyProject/BudgetApp
   DATABASE_URL='' npx prisma db push --schema <path-to-the-branch-checkout>/prisma/schema.prisma --skip-generate
   ```
   Between the quotes goes `DATABASE_URL_UNPOOLED` from Vercel → Storage → Neon. Give the recipe with the empty quotes exactly like that: **never** a realistic-looking placeholder URL (it once got pasted literally). `--schema … --skip-generate` lets the push use a branch that isn't checked out in the main folder. Check that the URL's `ep-…` endpoint is the same one `DATABASE_URL` in Vercel uses (on 23 Oct a push hit another Neon branch).
3. Use `db push` (CLAUDE.md: never migrations). Never `--force-reset`. `--accept-data-loss` only if the user confirmed that exact loss.
4. Wait for the user to say it's done before merging.

## 3. Merge

Only with the user's go-ahead for this PR (or a standing instruction to merge each ticket's PR):

```bash
gh pr merge <number> --merge
git fetch origin main
MERGE=$(gh pr view <number> --json mergeCommit -q .mergeCommit.oid)
```

## 4. Wait for CI and the deployment

```bash
gh run list --workflow verify --branch main --limit 5 --json databaseId,headSha,status,conclusion
gh run watch <databaseId> --exit-status
```

Use the run whose `headSha` equals `$MERGE` (right after the merge the newest run may still be the previous one: wait for it to appear).

Vercel deploys the merge whether or not CI passes. If CI fails, stop and check `vercel ls --prod`: if that commit is already live and broken, offer `vercel rollback`.

Then poll production until it reports the merge commit (up to ~5 minutes):

```bash
curl -s https://budget.luisvespa.com/api/health   # → {"ok":true,"commit":"<sha>"}
```

`commit` must equal `$MERGE`.

## 5. Smoke test

```bash
for p in / /api/debts /api/nope /api/banking/cron; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://budget.luisvespa.com$p)"
done   # 200 · 401 · 404 · 401 (the cron needs CRON_SECRET; 503 if banking is off in production)
vercel logs budget.luisvespa.com | grep -iE "error|P20[0-9]{2}" | head
```

A 500 on `/api/debts` usually means a missing environment variable or a schema not pushed (Prisma `P2022`, column missing). On the Hobby plan `vercel logs` only keeps ~30 minutes and rejects `--since`.

## 6. Report

- PR, merge commit and production URL.
- What was checked (CI, health commit, the status codes, logs) and what wasn't (screens in the browser, unless walked).
- Anything the user must still do (e.g. run a backfill script in their terminal).
- Rollback, if needed: `vercel rollback` (or "Instant Rollback" in the Vercel dashboard). A rollback does **not** undo a schema change from step 2.
