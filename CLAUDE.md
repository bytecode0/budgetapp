# LifePlan BudgetApp — Project Guidelines for Claude

## ⚠️ READ FIRST: the BudgetApp is the product

**Updated 21 Oct 2026:** the Radiografía Financiera (`src/radiografia/`, public no-login lead magnet) has been **abandoned** and will not launch. **All work now targets the LifePlan BudgetApp** (authenticated, `requireAuth`): a tool to get out of over-indebtedness from fragmented installments, built around the "futuro comprometido" metric.

The Radiografía code is still in the repo and its public routes are still mounted. Until it is removed:
- **Do not extend or fix it.** Don't spend effort on `src/radiografia/`, `server/lib/radiografia/`, `server/routes/radiografia.ts` or `server/lib/xray/` beyond what removing it requires.
- **Do not import from it** in BudgetApp code. If something in there is worth keeping (e.g. the statement parsers), move it out deliberately — don't reach in.
- The sections below marked **(legacy — Radiografía)** describe that code; they're kept only so it isn't broken by accident before removal.

> **TODO (Luis):** decide whether to delete the Radiografía code and unmount `/api/radiografia` (public, unauthenticated, rate-limited only by IP — dead public surface is still attack surface).

### Feature flag

`VITE_ENABLE_BUDGETAPP` — `true` in local dev. It was `false` in production to hide the BudgetApp while the Radiografía launched; with the Radiografía abandoned, this flag must be `true` (or removed) wherever the BudgetApp is deployed.

When `false`:
- Frontend: BudgetApp routes are **not registered in the router**. Not a hidden menu link — the route must not exist in the production bundle.
- Backend: BudgetApp routes are **not mounted**. `/api/plans` must return **404, not 401** — a 401 confirms something is there.

---

## Do not modify without asking

- `prisma/schema.prisma` — propose the change, do not apply it silently. Apply with `db push`, never with migrations (see Prisma workflow).
- The database. Never run `npm run db:reset` or any `--force-reset`.
- Auth middleware, Stripe integration, OAuth setup.

---

## Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Radix primitives), Motion (Framer Motion v12)
- **Backend**: Node.js, Express, TypeScript (`tsx watch`), Prisma ORM
- **Database**: PostgreSQL
- **Services**: Stripe (payments), Resend (email), Google OAuth
- **i18n**: i18next — all user-facing strings must use `t('key')`, never hardcode text

---

## Commands

```bash
npm run dev:all          # frontend (5173) + backend (3002) together
npm run dev              # frontend only
npm run dev:server       # backend only
npm run build            # production build of the frontend → dist/
npm run prisma:generate  # regenerate the Prisma client
```

**Type check:** `npm run typecheck` (server + app).
**Tests:** `npm run test` (`server/**/*.test.ts`, node test runner). If it fails in the sandbox on the IPC socket, run one file at a time: `node --import tsx --test <file>`.
**All checks:** `npm run verify` = typecheck + test + build.
**Lint:** there is no lint script in this project.

UI changes still need a manual pass: run `npm run dev:all` and walk the flow in the browser at http://localhost:5173. State what you verified and what you could not.

Production: `npm run build` outputs `dist/`, served statically. The backend runs separately on `SERVER_PORT`. **The feature flag must be enforced in both** — a disabled frontend route with a live API endpoint is not disabled.

### Prisma workflow — READ THIS, IT IS NOT STANDARD

**Never run `prisma migrate dev` or `npm run prisma:migrate`.** The migration history in this project is incomplete and fails on the shadow database (P3006/P1014). Instinct will reach for migrations. It breaks here.

Schema changes are applied with `db push`:

```bash
npx prisma db push      # additive: adds tables/columns without data loss
npm run prisma:generate # regenerate the client afterwards
```

**Never run `npm run db:reset`.** It is `db push --force-reset`: it drops every table and deletes the entire database, irreversibly. It is a human-only command. If you believe a reset is needed, stop and ask.

After any schema change: `db push`, then `prisma:generate`, then verify the app still boots.

### Project structure

> **TODO (Luis): paste the output of `tree -L 2 src`.** Still the last real gap. Without it an agent guesses where files go, and in a repo with two products that guess is the one that re-entangles them.

### Environment variables

Documented in `.env.example`. Relevant ones:

| Var | Note |
|---|---|
| `DATABASE_URL` | PostgreSQL |
| `JWT_SECRET` | Auth — BudgetApp only |
| `RESEND_API_KEY`, `SENDER_EMAIL` | **Report delivery depends on these.** Must be set in production with a verified sending domain |
| `APP_URL` | Must point to the production URL, not localhost, or report links will break |
| `VITE_API_URL` | Must point to the production API |
| `STRIPE_*`, `GOOGLE_*` | BudgetApp only. Not needed for launch |
| `ANTHROPIC_API_KEY` | AI expense classification — see cost warning below |
| `VITE_ENABLE_BUDGETAPP` | `false` in production |

- **Never** write a secret into source code. Never commit `.env`.
- If a required env var is missing, **stop and ask**. Do not invent a fallback value or a placeholder key.

### ⚠️ Cost: AI calls (`ANTHROPIC_API_KEY`)

Expense classification and the statement column-mapping fallback (`aiColumnMap.ts`) call the Anthropic API. In the BudgetApp they sit behind `requireAuth` — keep it that way: never expose a route that spends money per request without auth. The Radiografía's public `/extracto` route shares the same key gate; while `/api/radiografia` is still mounted, that public route can spend money too (see the TODO at the top).

---

## Money handling — non-negotiable

This is a financial app. Rounding bugs here destroy user trust faster than anything else.

- **Amounts are stored as integer cents (`Int`).** Convert at the API boundary (`server/lib/money.ts`, `toCents`). **Never `Float` for money.** The existing `Float` fields (`Debt.apr`, `Expense.scopeConfidence`) are rates/scores, not amounts.
- Do all arithmetic on integers. Convert to display format only at the render layer.
- Round only when displaying, never mid-calculation.
- Currency symbol must come from i18n, not hardcoded. The `€` in the input example below is a placeholder and violates this rule — fix it when touched.

### The 10/50/20/20 framework (legacy — Radiografía)

The BudgetApp's rules come from the Método Ruta (`metodo-ruta-reglas.md`, referenced as R1…R7 in code comments), not from this table.

The diagnostic framework and its thresholds are the domain core. They live in **one place** (`src/radiografia/domain/`) and are imported from there. Never re-derive or re-hardcode a threshold inside a component.

| Area | Target |
|---|---|
| Generosity / tithe | 10% |
| Essentials (incl. housing) | 50% |
| Saving + investing | 20% |
| Enjoyment | 20% |

---

## Radiografía-specific rules (legacy — Radiografía)

The general conventions below were written for the authenticated BudgetApp. The Radiografía is a public, single-session funnel tool, so four of them do **not** apply:

**1. No auth.** Radiografía endpoints are the only public routes in the project. They must be listed explicitly and visibly, not treated as an implicit exception. Rate-limit them by IP.

**2. No FAB.** The manual form is a linear step-by-step wizard. It uses "Back" / "Next" buttons, not a floating action button. The FAB rule applies to create/add actions in list-based modules only.

**3. No `MonthContext`.** The Radiografía is a point-in-time snapshot, not a monthly view. Do not wire it to the global month selector.

**4. No Tailwind in email templates.** The report email uses **tables and inline CSS**. Email clients do not support modern CSS. A Tailwind-styled email looks perfect in the browser and broken in Outlook. This is the single most common mistake here.

### Privacy: what gets persisted

**Revoked 18 ago:** "percentages only, never amounts" made the report too thin to be worth asking for a bank statement ("you're spending 600€/year on restaurants" needs an amount, not a percentage). The rule that replaced it:

- **Aggregates with amounts are fine** — spending by category, gastos hormiga, subscriptions, health index, archetype. What's still never allowed is **raw movements**: no individual transaction (date + concept + amount) ever reaches a database row. Only numbers `analyze()` already aggregated across the whole statement.
- **`health` is never itemized**, in amount or in name, even in aggregate form — a euro figure next to a pharmacy/insurer is health data under GDPR Article 9 whether or not a merchant name is attached. Its spend is simply dropped from the category breakdown, not folded elsewhere.
- **Giving movements (diezmo, iglesia, ONG) never carry a merchant name** into the report — the "who" of a tithe is religious-belief data (Article 9). The amount stays in a generic `giving_monthly` bucket, exactly as before.
- **Merchant names for ant-expenses/subscriptions ARE persisted, under explicit consent** (revoked "never persisted", 18 ago — same reasoning as the amounts above: "600€/year on restaurants" without naming Glovo and Netflix is a report nobody acts on, and a resend or the permanent link showing less than the first email read as a bug every time). They live in the browser's `sessionStorage` from the moment the statement is read until `/email/verify`, and are written into `Radiografia.resultado` there — the first point where the consent checkbox at the email step is backed by a confirmed address. Never at `/profile/extracto`: nothing carries a merchant name before consent exists. The consent copy (`radiografia.onboarding.email.consentLabel`) says so explicitly, and must keep saying so.
- Nothing above relaxes `health` or giving: they never reach the snapshot at all, in amount or in name.

See `server/lib/radiografia/snapshot.ts` (what gets built) and `server/lib/radiografia/report.ts` (what gets shown) for where each of these is enforced — both, not just one, since a future code path that reads `Radiografia.resultado` without going through the writer must still never surface `health`.

---

## Git workflow

- One branch per epic, e.g. `feature/deudas-pagos`, `feature/onboarding`
- Commit style: `type(scope): message` — e.g. `feat(debts): register a payment against a debt`
- Never commit directly to `main`
- Never commit `.env`, credentials, or generated build output

---

## UI/UX Patterns — follow these in every new module

### 1. Floating Action Button (FAB) — primary create/add action

Applies to **list-based modules where the user creates or adds items**. Does **not** apply to linear wizards (see Radiografía rule 2). Never put the primary create action in a header button or inside a card.

```tsx
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';

<motion.button
  initial={{ scale: 0 }}
  animate={{ scale: 1 }}
  transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
  onClick={() => setShowAdd(true)}
  whileHover={{ scale: 1.1 }}
  whileTap={{ scale: 0.9 }}
  className="fixed right-6 bottom-6 w-16 h-16 bg-gradient-to-br from-primary to-secondary text-white rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center z-40 group"
>
  <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform" />
</motion.button>
```

**Rules:**
- Size: `w-16 h-16` (64 px) — never smaller, never larger
- Position: `fixed right-6 bottom-6 z-40`
- Gradient: always `from-primary to-secondary` — never a flat color
- Icon: `Plus` with `group-hover:rotate-90 transition-transform`
- Spring entrance: `delay: 0.5, type: 'spring', stiffness: 200`
- `whileHover: scale 1.1`, `whileTap: scale 0.9`

**Where it's used today:** Activity, Plans (PlanningDashboard), Allocations (AllocationFlow) — all BudgetApp.

---

### 2. Modal / sheet — triggered by the FAB

Create/edit actions open a **bottom sheet on mobile, centered modal on desktop** using `AnimatePresence` + `motion.div`.

```tsx
<AnimatePresence>
  {showAdd && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
      >
        {/* content */}
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
```

**Rules:**
- Backdrop click closes the modal
- `rounded-2xl`, `bg-card border border-border`, `p-6`, `max-w-md`
- Always include a close button (`X` icon, top-right)

---

### 3. Page entrance animations

Every new screen/module starts with a staggered fade-in pattern.

```tsx
// Page title
<motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
  <h1 className="text-4xl tracking-tight">{t('module.title')}</h1>
  <p className="text-muted-foreground">{t('module.subtitle')}</p>
</motion.div>

// Cards stagger: delay increases by 0.05–0.1 per card
<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
```

**Radiografía note:** keep step transitions fast (≤200 ms). Slow animations on a 7-step wizard add up and increase abandonment.

---

### 4. Cards

```tsx
// Standard card
<div className="bg-card border border-border rounded-2xl p-6">

// Hero / gradient card (income, plan header, month summary)
<div className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-3xl p-8 shadow-2xl relative overflow-hidden">
  <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
  <div className="relative z-10">
    {/* content */}
  </div>
</div>

// Status card — positive (green)
<div className="bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800 rounded-2xl p-5">

// Status card — negative (red)
<div className="bg-red-50 dark:bg-red-950/20 border-2 border-red-200 dark:border-red-800 rounded-2xl p-5">

// Status card — warning (amber)
<div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5">
```

---

### 5. List items with drag-and-drop reordering

When a list of items can be reordered by the user, use `react-dnd` + `HTML5Backend` (already installed). Always include a `GripVertical` handle on the left and a `sortOrder` field in the database model.

```tsx
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { GripVertical } from 'lucide-react';

// Handle — attach drag ref here, not to the whole row
<div
  ref={handleRef}
  className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0 touch-none select-none"
>
  <GripVertical className="w-4 h-4" />
</div>
```

Persist order with a `PATCH /api/<resource>/reorder` endpoint that accepts `{ order: [{id, sortOrder}] }` and does a transaction batch update. The GET endpoint should always sort by `sortOrder ASC`.

The debt list in the Radiografía is **not** reorderable — order carries no meaning there. Do not add drag-and-drop to it.

---

### 6. Month selector — global context

The active month is global state managed by `MonthContext` (`src/app/context/MonthContext.tsx`). The selector lives in the sidebar — **never add per-module month navigation arrows** inside a page.

```tsx
import { useMonth } from '../context/MonthContext';

const { selectedMonth, isCurrentMonth, isFutureMonth } = useMonth();
```

Allowed range: one month back (unlimited) ↔ one month ahead of today.

**BudgetApp only.** The Radiografía does not use this.

---

### 7. Toasts — feedback after actions

Use `sonner` via `toast.success()` / `toast.error()`. Never use browser `alert()`.

```tsx
import { toast } from 'sonner';

toast.success(t('module.savedOk'));
toast.error(t('module.saveFailed'));
```

---

### 8. Empty states

When a list has no items, show a centered empty state with an icon, a short message, and — if appropriate — a prompt to use the FAB.

```tsx
<div className="text-center py-16 space-y-3">
  <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto">
    <SomeIcon className="w-8 h-8 text-muted-foreground" />
  </div>
  <p className="font-display text-lg">{t('module.emptyTitle')}</p>
  <p className="text-sm text-muted-foreground">{t('module.emptyDesc')}</p>
</div>
```

---

### 9. Form inputs — consistent style

```tsx
// Text / number input
<input className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm" />

// With currency prefix — symbol must come from i18n, not hardcoded
<div className="relative">
  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currencySymbol}</span>
  <input className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary" />
</div>

// Primary action button
<button className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">

// Secondary / ghost button
<button className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm">

// Destructive button
<button className="border border-destructive/20 text-destructive hover:bg-destructive/5 rounded-lg transition-colors">
```

**Numeric inputs in the Radiografía:** accept `0`, show thousands separators, use `inputMode="decimal"` so mobile shows the numeric keypad.

---

### 10. Typography scale

| Usage | Class |
|---|---|
| Page title | `text-4xl tracking-tight` |
| Section heading | `text-2xl font-display` |
| Card heading | `font-display text-lg` |
| Body | `text-sm` |
| Caption / label | `text-xs text-muted-foreground` |
| Hero number | `text-5xl font-display` |
| Stat number | `text-2xl font-display` |

`font-display` is used for numbers and headings. Plain `font-sans` for body text.

---

## Internationalisation

- All text must use `useTranslation()` → `t('section.key')`
- Keys live in `src/locales/en.json` and `src/locales/es.json`
- Always add both locales when adding a new key — never leave one missing
- Use i18next interpolation for dynamic values: `t('key', { amount: n })`
- **Public-facing Radiografía copy is Spanish-first.** English keys may exist but Spanish is the reviewed source of truth for launch.

---

## API conventions

- Routes: `GET /api/<resource>`, `POST /api/<resource>`, `PATCH /api/<resource>/:id`, `DELETE /api/<resource>/:id`
- Batch operations use named sub-routes placed **before** `/:id`: e.g. `PATCH /api/allocations/reorder`
- All responses: `{ data }` on success, `{ error: string }` on failure
- Auth: every route uses `requireAuth` middleware — `req.userId` is always available inside
- **Exception:** Radiografía routes are public. Maintain the explicit list below.

### Public routes (the only ones without `requireAuth`) (legacy — Radiografía)

The full list, kept in sync with `server/routes/radiografia.ts` — this went stale once before (it listed two routes; the file has ten), so re-check against the file rather than trusting this list blindly:

```
POST   /api/radiografia/profile          # bootstrap/resume an anonymous profile
GET    /api/radiografia/profile          # current state (by cookie or Bearer token)
PATCH  /api/radiografia/profile/step     # record which onboarding step was reached
POST   /api/radiografia/profile/extracto # analyze an uploaded statement (mandatory step)
POST   /api/radiografia/profile/fields   # save the manual gap-filling fields
POST   /api/radiografia/email/request    # send the 6-digit confirmation code
POST   /api/radiografia/email/verify     # confirm the code, deliver the report
POST   /api/radiografia/report/resend    # retry report delivery
GET    /api/radiografia/report/:token    # permanent report page — the token IS the authorization
DELETE /api/radiografia/profile          # delete-my-data, Bearer-token authenticated
```

All rate-limited by IP (`rateLimited()` in the same file). None of these ever accept a client-supplied `profileId` for authorization — every one resolves "who is this" from the anon cookie or Bearer token, never from the request body.

---

## Colour palette (Tailwind tokens)

| Token | Usage |
|---|---|
| `primary` | Main brand colour, CTAs |
| `secondary` | Accent / success |
| `accent` | Tertiary highlight |
| `destructive` | Delete / error actions |
| `muted` | Backgrounds, disabled states |
| `card` | Card backgrounds |
| `border` | All borders |
| `muted-foreground` | Labels, captions |

Status colours follow the same semantic pattern across the app:
- **Green** (`emerald`) = good / under budget / contributed
- **Amber** = warning / pending / out of sync
- **Red** = over budget / missed / error

---

## Analytics events (legacy — Radiografía)

Plausible, no cookies, no consent banner needed. Fire from `src/radiografia/`:

```ts
plausible('radiografia_iniciada');
plausible('paso_completado', { props: { paso: 3 } });
plausible('radiografia_completada');
plausible('email_capturado');
```

Never send financial amounts or email addresses as event properties.
