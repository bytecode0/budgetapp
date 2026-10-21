---
name: deploy
description: Deploy LifePlan to production (budget.luisvespa.com on Vercel). Verifies the build, gates any production schema change behind explicit confirmation, has the user push main, waits for CI and the Vercel deployment, then smoke-tests production. Use when the user asks to deploy, ship to production, publish, or "subir a producción".
---

# Deploy to production

Production = `https://budget.luisvespa.com`, Vercel project linked to GitHub `bytecode0/budgetapp`. Vercel's Git integration deploys every push to `main` on its own; this skill makes that push safe and confirms it landed. Plan: `docs/plan-deudas-y-onboarding.md` §2.

Stop at the first failed step, say what failed, and don't work around it.

## 1. Preconditions

- On `main`, working tree clean (untracked tool folders like `.agents/`, `.codex/` don't count), and `main` contains everything the user meant to ship. If the user is on a feature branch, ask whether to merge it first — don't assume.
- `npm run verify` passes (typecheck + tests + build). If it fails, stop and report the output.

## 2. Production schema changes (never automatic)

Compare the schema with what GitHub has:

```bash
git fetch origin main
git diff origin/main..HEAD -- prisma/schema.prisma
```

If there's no diff, skip to step 3.

If there is one:
1. Show the diff and explain in one line per change what it does to the production database (new table/column = additive; removed/renamed/retyped = **data loss**).
2. **Ask for explicit confirmation.** Any removal or type change needs the user to say so knowing data is lost.
3. Apply it **before** the push, so the new code never runs against the old schema. The user runs it (production secrets never reach Claude):
   ```
   ! vercel env pull .env.production.local --environment=production
   ! set -a; source .env.production.local; set +a; DATABASE_URL="$DATABASE_URL_UNPOOLED" npx prisma db push; rm .env.production.local
   ```
   Use `db push` (CLAUDE.md: never migrations). Never `--force-reset`. `--accept-data-loss` only if the user confirmed that exact loss.

## 3. Push

The auto-mode classifier blocks Claude from pushing; the user runs it:

```
! git push origin main
```

## 4. Wait for CI and the deployment

```bash
gh run list --workflow verify --branch main --limit 1 --json databaseId,headSha,status
gh run watch <databaseId> --exit-status
```

Vercel deploys the push whether or not CI passes. If CI fails, stop and check `vercel ls --prod`: if that commit is already live and broken, offer `vercel rollback`. (Step 1 ran the same checks locally, so this should be rare.)

Then poll production until it reports the pushed commit (up to ~5 minutes):

```bash
curl -s https://budget.luisvespa.com/api/health   # → {"ok":true,"commit":"<sha>"}
```

`commit` must equal `git rev-parse HEAD`.

## 5. Smoke test

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://budget.luisvespa.com/            # 200
curl -s -o /dev/null -w "%{http_code}\n" https://budget.luisvespa.com/api/debts   # 401 (not 500)
curl -s -o /dev/null -w "%{http_code}\n" https://budget.luisvespa.com/api/nope    # 404
```

A 500 on `/api/debts` usually means a missing environment variable or a database problem: check `vercel logs` for the deployment and report.

## 6. Report

- Commit deployed and its URL.
- What was checked (CI, health commit, the three status codes) and anything not checked.
- Rollback, if needed: `vercel rollback` (or "Instant Rollback" in the Vercel dashboard). A rollback does **not** undo a schema change from step 2.
