# LifePlan BudgetApp — Project Guidelines for Claude

## Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Radix primitives), Motion (Framer Motion v12)
- **Backend**: Node.js, Express, TypeScript (`tsx watch`), Prisma ORM
- **Database**: PostgreSQL
- **Services**: Stripe (payments), Resend (email), Google OAuth
- **i18n**: i18next — all user-facing strings must use `t('key')`, never hardcode text

---

## UI/UX Patterns — follow these in every new module

### 1. Floating Action Button (FAB) — primary create/add action

Every module that lets the user create or add something uses a **fixed FAB** at bottom-right. Never put the primary create action in a header button or inside a card.

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

**Where it's used today:** Activity, Plans (PlanningDashboard), Allocations (AllocationFlow).

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

// With currency prefix
<div className="relative">
  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
  <input className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary" />
</div>

// Primary action button
<button className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">

// Secondary / ghost button
<button className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm">

// Destructive button
<button className="border border-destructive/20 text-destructive hover:bg-destructive/5 rounded-lg transition-colors">
```

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

---

## API conventions

- Routes: `GET /api/<resource>`, `POST /api/<resource>`, `PATCH /api/<resource>/:id`, `DELETE /api/<resource>/:id`
- Batch operations use named sub-routes placed **before** `/:id`: e.g. `PATCH /api/allocations/reorder`
- All responses: `{ data }` on success, `{ error: string }` on failure
- Auth: every route uses `requireAuth` middleware — `req.userId` is always available inside

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
