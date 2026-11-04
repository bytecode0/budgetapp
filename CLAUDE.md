# LifePlan BudgetApp — Project Guidelines for Claude

## What this is

LifePlan is an authenticated budgeting app (every API route behind `requireAuth`) for **families who earn well, get to the end of the month just barely, and never learned a system to save**. They may have debts (cards, car, installments), but debt does not drown them; what they lack is a method, not money (decided 4 Nov 2026, `docs/vision-y-plan-beta.md`).

The app is the tool of a system: **see** where the money goes and how much of the next paycheck is already committed; **order** a monthly budget where every euro has a destination; **get out of debt** with a dated plan (snowball/avalanche); **save with purpose** (named plans, always an emergency fund, a fixed "pay yourself first" % that each user chooses); and **save to invest**. The **"futuro comprometido"** (share of income already committed to debt) stays as the entry diagnosis, not the headline.

- **The app does not teach.** The company teaches, through workshops and social media; the app is where people apply it. Don't add lessons, courses or content screens.
- **It is moldable to each user's method**, not tied to the workshop's: users choose their own percentages.
- **It does not give investment advice**: no products, no managing money. Projections are labelled as simulations, not promises (LPBETA-06).
- Generosity is a budget line type (`generosity`) that cannot be deleted, only set to 0.

Plans: `docs/vision-y-plan-beta.md` (client, beta, growth), `docs/plan-deudas-y-onboarding.md` (epics done), backlog in `docs/tickets.md`.

The Radiografía Financiera (a public lead magnet) was abandoned and deleted on 21 Oct 2026; it lives only in git history.

### How debts work (read before touching money code)

- **A credit card is an account** (type `card`). Its debt is created and kept in step by the server (`server/lib/cardDebt.ts`) — the user never creates it in Debts. Loans and installment plans are created in Debts.
- **Balances are derived, never stored** (`server/lib/debtBalance.ts`): live balance = anchor (`Debt.currentBalance` at `balanceAsOf`) + card purchases + dated adjustments − payments. Never read `Debt.currentBalance` raw as "what's owed".
- **A card payment only counts as spending for the part that pays pre-existing debt**; the rest pays purchases already counted in their own category. Every place that sums expenses must use `countedAmounts()` / `budgetAmount`, or groceries get counted twice.

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
- **Services**: Stripe (payments), Cloudflare Email Sending (email), Google OAuth
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
| `JWT_SECRET`, `ENCRYPTION_KEY` | Auth sessions / the bank session id, stored encrypted |
| `EMAIL_PROVIDER` | Which transport sends email (see Emails below): `resend` for the beta, `cloudflare`, or `console` for local dev (prints instead of sending; allowed only with `NODE_ENV` exactly `development` or `test` and no `VERCEL`/`VERCEL_ENV`). Read at send time; missing or unknown makes every send fail with a clear error, never a silent fallback |
| `EMAIL_FROM` | Sender for every provider: `"LifePlan <contact@luisvespa.com>"` or a bare address. Its domain must be verified with the provider. No fallback sender |
| `RESEND_API_KEY` | Only with `EMAIL_PROVIDER=resend`. Free plan: 3,000/month, 100/day, any recipient once the domain is verified |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN` | Only with `EMAIL_PROVIDER=cloudflare`. Needs the Workers Paid plan and a verified sending domain; the token only needs the send-email permission |
| `LOGO_URL` | Optional hosted logo for the email header |
| `APP_URL` | The production URL (CORS origin and links in emails), not localhost |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_CALLBACK_URL` | Google sign-in; the callback URL must also be registered in Google Cloud Console |
| `STRIPE_SECRET_KEY`, `STRIPE_PREMIUM_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Premium subscription; webhook points at `/api/stripe/webhook`. **Test mode** during the beta. If any is missing, the Stripe routes answer 503; the rest of the app runs |
| `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY` | Bank connection via Enable Banking (`server/lib/banking/`): the application id (JWT `kid`) and its RS256 private key, the full PEM (one-line values with literal `\n` are accepted). The `.pem` never goes in the repo |
| `BANKING_CALLBACK_URL` | Must equal a redirect URL registered at Enable Banking: `https://budget.luisvespa.com/api/banking/callback` (prod), `http://localhost:3002/api/banking/callback` (local) |
| `BANKING_ALLOWED_EMAILS` | Comma-separated. While the Enable Banking app is in restricted mode, only these users see or use bank connection (enforced on the server and hidden in the UI). Unset = nobody |
| `ANTHROPIC_API_KEY` | AI expense classification — see cost note below |
| `CRON_SECRET` | Authenticates scheduled jobs: Vercel Cron calls `GET /api/banking/cron` (daily, `vercel.json`) with `Authorization: Bearer $CRON_SECRET` |

Bank connection is on only when `ENABLE_BANKING_APP_ID`, `ENABLE_BANKING_PRIVATE_KEY`, `BANKING_CALLBACK_URL`, `ENCRYPTION_KEY` and `CRON_SECRET` are all set (read at call time); any missing one turns it off: `/api/banking/status` says `enabled: false` and every other banking route answers 503.

The frontend calls the API with relative `/api/...` paths: frontend and backend are served from the same origin.

- **Never** write a secret into source code. Never commit `.env`.
- If a required env var is missing, **stop and ask**. Do not invent a fallback value or a placeholder key.

### Emails (`server/lib/email/`)

Two independent layers: transports know nothing about templates, templates nothing about transports.

- **Send:** `sendEmail({ to, subject, html, text, replyTo? })` from `server/lib/email/index.ts` picks the transport from `EMAIL_PROVIDER` at send time. Transports live in `transports/` (`resend.ts`, `cloudflare.ts`, `console.ts`); all share a 10 s timeout and never put recipient addresses, tokens or keys in errors. Every send rejects on failure; callers decide whether that is fatal.
- **Add a provider:** one file in `transports/` implementing `EmailTransport` (`types.ts`) plus one line in the registry in `index.ts`. Swapping provider is env-only.
- **Look:** `theme.ts` (product name, colours, fonts, radii, logo, support email, app URL, Premium price). **Copy:** `locales/es.ts` (source of truth) and `locales/en.ts`, same keys (a test enforces it). Never hardcode text or a currency symbol in a template; money is integer cents formatted by `format.ts`. Copy only describes what the code really does (Premium gates no feature today, so no feature list). Emails that ask the user to reply set `replyTo` to the theme's `supportEmail`. A bad `APP_URL`/`LOGO_URL` drops the logo or footer link (logged once) instead of blocking an OTP; CTA links still throw.
- **Templates:** `templates/*.ts`, one pure function per email, `(data, locale) => { subject, html, text }`, built from `components.ts` (table-based, inline-styled, escaped; each block has a plain-text twin). The senders called by routes are thin wrappers in `server/lib/mailer.ts` and `server/lib/subscriptionEmails.ts`; pass the user's `UserSettings.language` (`resolveLocale`), default Spanish.
- **Add an email:** a template file + its keys in both locales + a sample in `samples.ts` + a wrapper in `mailer.ts`/`subscriptionEmails.ts`.
- **Preview:** `npm run email:preview [dir]` renders every template in both locales with sample data to `./.email-preview/index.html` (gitignored). No network, no DB. Locally, `EMAIL_PROVIDER=console` prints emails (OTPs included) to the server log.

### ⚠️ Cost: AI calls (`ANTHROPIC_API_KEY`)

Expense classification calls the Anthropic API. It sits behind `requireAuth` — keep it that way: never expose a route that spends money per request without auth.

---

## Money handling — non-negotiable

This is a financial app. Rounding bugs here destroy user trust faster than anything else.

- **Amounts are stored as integer cents (`Int`).** Convert at the API boundary (`server/lib/money.ts`, `toCents`). **Never `Float` for money.** The existing `Float` fields (`Debt.apr`, `Expense.scopeConfidence`) are rates/scores, not amounts.
- Do all arithmetic on integers. Convert to display format only at the render layer.
- Round only when displaying, never mid-calculation.
- Currency symbol must come from i18n, not hardcoded. The `€` in the input example below is a placeholder and violates this rule — fix it when touched.

---

## Git workflow

- One branch per epic, e.g. `feature/deudas-pagos`, `feature/onboarding`
- Commit style: `type(scope): message` — e.g. `feat(debts): register a payment against a debt`
- Never commit directly to `main`
- Never commit `.env`, credentials, or generated build output

---

## UI/UX Patterns — follow these in every new module

**The app's design is Remanso (LPBETA-18, approved 4 Nov 2026).** The reference is the design system at https://claude.ai/artifact/WMDkSACG5weNQxzPB6KyB5 (logo, tokens, components, voice); the tokens live in `src/styles/theme.css`. Principles: each screen answers "¿vamos bien?" first, with **one** big number; calm over data (lots of air, few numbers at once); **going over budget is not an error**: it is `sun-ink` on `sun-soft` ("vas justo"), never red; red (`alert`/`destructive`) is only for real errors and deleting. No gradients, no emoji as decoration, no bouncy or spinning motion.

Screens built before the redesign still use the old patterns (gradients, `emerald`/`red`/`amber` classes); phase 2 of LPBETA-18 moves them over screen by screen. **New or touched UI follows the rules below.**

**Light/dark theme:** always available from the `ThemeToggle` (`src/app/components/shared/ThemeToggle.tsx`) in the top bar, the sidebar and the onboarding header, never only in Settings. The choice is the person's own (`UserSettings.darkMode` of `req.authUserId`, never the household pool) so it follows them to every device; `src/app/lib/theme.ts` keeps a device copy only to paint before load (`index.html`). Design every screen in both themes.

### 1. Floating Action Button (FAB) — primary create/add action

Applies to **list-based modules where the user creates or adds items**. Does **not** apply to linear wizards such as the onboarding, which use "Back" / "Next". Never put the primary create action in a header button or inside a card.

```tsx
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';

<motion.button
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 0.3, duration: 0.2, ease: 'easeOut' }}
  onClick={() => setShowAdd(true)}
  aria-label={t('module.add')}
  className="fixed right-6 bottom-6 w-16 h-16 bg-primary text-primary-foreground rounded-full shadow-soft hover:-translate-y-0.5 transition-transform flex items-center justify-center z-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
>
  <Plus className="w-7 h-7" />
</motion.button>
```

**Rules:**
- Size: `w-16 h-16` (64 px); position `fixed right-6 bottom-6 z-40` (plus the phone's safe-area insets)
- Flat `bg-primary` (the `pool` colour) with `shadow-soft`, never a gradient
- Calm entrance (fade and 8 px up, 200 ms); no spring, no scale-on-hover, no rotating icon
- Always an `aria-label`

**Where it's used today:** Activity, Plans (PlanningDashboard), Allocations (AllocationFlow) — still in the old style until phase 2.

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

**Onboarding note:** keep step transitions fast (≤200 ms). Slow animations on a multi-step wizard add up and increase abandonment.

---

### 4. Cards

```tsx
// Standard card: no shadow, only the border
<div className="bg-card border border-border rounded-3xl p-6">

// CalmCard: the one answer of the Home screen (replaces the old gradient hero). One per screen, one big number.
<div className="bg-pool text-on-pool rounded-3xl p-8 relative overflow-hidden">
  <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{t('home.paidYourselfLabel')}</p>
  <p className="text-5xl font-display">{fmt(paidCents)}</p>
  <p className="text-sm">{t('home.paidYourselfOf', { goal: fmt(goalCents) })}</p>
</div>

// Status: always an icon AND a word, never colour alone
// good ("vas bien", contribution made)
<div className="bg-reed-soft text-reed rounded-2xl p-5">
// watch ("vas justo", over budget on a line) — NOT red
<div className="bg-sun-soft text-sun-ink rounded-2xl p-5">
// error (only real errors)
<div className="bg-alert-soft text-alert rounded-2xl p-5">
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


---

### 6. Month selector — global context

The active month is global state managed by `MonthContext` (`src/app/context/MonthContext.tsx`). The selector lives in the sidebar — **never add per-module month navigation arrows** inside a page.

```tsx
import { useMonth } from '../context/MonthContext';

const { selectedMonth, isCurrentMonth, isFutureMonth } = useMonth();
```

Allowed range: one month back (unlimited) ↔ one month ahead of today.


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

**Numeric inputs:** accept `0`, show thousands separators, use `inputMode="decimal"` so mobile shows the numeric keypad. Currency symbol from `t('currency.symbol')`, never a literal `€`.

---

### 10. Typography scale

Fonts: **Fraunces** (soft serif, `font-display`) for headings and numbers, **Figtree** for everything else (`src/styles/fonts.css`).

| Usage | Class |
|---|---|
| Page title | `text-4xl tracking-tight font-display` |
| Section heading | `text-2xl font-display` |
| Card heading | `text-lg font-semibold` |
| Body | `text-sm` |
| Caption / label | `text-xs text-muted-foreground` (uppercase labels: `font-semibold uppercase tracking-wider`) |
| Hero number | `text-5xl font-display` — one per screen |
| Stat number | `text-2xl font-display` |

Amounts in columns: `tabular-nums`.

---

## Internationalisation

- All text must use `useTranslation()` → `t('section.key')`
- Keys live in `src/locales/en.json` and `src/locales/es.json`
- Always add both locales when adding a new key — never leave one missing
- Use i18next interpolation for dynamic values: `t('key', { amount: n })`
- **Spanish is the primary language** and the reviewed source of truth; English must exist for every key.

---

## API conventions

- Routes: `GET /api/<resource>`, `POST /api/<resource>`, `PATCH /api/<resource>/:id`, `DELETE /api/<resource>/:id`
- Batch operations use named sub-routes placed **before** `/:id`: e.g. `PATCH /api/allocations/reorder`
- All responses: `{ data }` on success, `{ error: string }` on failure
- Auth: every route uses `requireAuth` middleware — `req.userId` is always available inside
- **Exceptions (no session):** the auth endpoints themselves, `GET /api/health`, and the Stripe webhook (verifies its own signature).

## Colour palette (Tailwind tokens)

Brand tokens (Remanso, `src/styles/theme.css`, light and dark):

| Token | Usage |
|---|---|
| `pool` (= `primary`) | The brand: the one primary action per view, active states, links. Text on it: `on-pool` |
| `pool-soft` | Tinted backgrounds behind `pool` text (chips, selected rows) |
| `sun` (= `accent`) | Warm accent, small fills only: a milestone reached, the Generosity line, the logo's sun. As text: `sun-ink` |
| `sun-ink` / `sun-soft` | The "watch" state: going over budget, "vas justo" |
| `reed` / `reed-soft` (= `secondary`) | The "good" state: on track, contribution made |
| `alert` / `alert-soft` (= `destructive`) | Real errors and deleting only |
| `surface` (= `background`), `surface-raised` (= `card`), `surface-sunk` (= `muted`) | Page, cards and sheets, sunk areas (progress tracks) |
| `ink` (= `foreground`), `ink-muted` (= `muted-foreground`) | Text |
| `line` (= `border`), `line-strong` | Hairlines; borders of inputs and controls (3:1) |
| `scrim` | Behind sheets and modals |

Every text/background pair above passes WCAG AA in both themes. Status is never colour alone: each one carries an icon and a word.

---
