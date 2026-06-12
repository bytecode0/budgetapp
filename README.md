
# BudgetApp

A full-stack personal finance and life planning application with budget tracking, goal management, expense tracking, and Stripe subscription support.

The original design is available at https://www.figma.com/design/5xVR2S7yf3yMESFbxi2OKA/BudgetApp.

---

## Prerequisites

Make sure the following are installed on your machine before proceeding:

- [Node.js](https://nodejs.org/) v18 or later
- [npm](https://www.npmjs.com/) v9 or later
- [PostgreSQL](https://www.postgresql.org/) v14 or later (running locally or via a hosted provider)

---

## 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd BudgetApp
npm install
```

---

## 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with the following variables:

```env
# Server
SERVER_PORT=3002
APP_URL=http://localhost:5173

# Database (PostgreSQL)
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/budgetapp

# JWT Authentication
JWT_SECRET=your-secret-key-here

# Email Service (Resend — https://resend.com)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
SENDER_EMAIL=noreply@yourdomain.com

# Stripe (https://dashboard.stripe.com)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# AI expense classification (optional — Phase J)
# When set, enables "Classify with AI" during bank-statement import.
# Without it, the feature is hidden and import works exactly as before.
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
# Optional model override (default: claude-haiku-4-5)
AI_MODEL=claude-haiku-4-5

# Frontend (exposed to browser via Vite)
VITE_API_URL=http://localhost:3002/api
```

---

## 3. Set Up the Database

### Create the PostgreSQL database

```bash
createdb budgetapp
```

Or connect to your PostgreSQL instance and run:

```sql
CREATE DATABASE budgetapp;
```

### Run Prisma migrations

Generate the Prisma client and apply all migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

### Reset the database (start from scratch)

To wipe **all data** and rebuild a clean database that matches the Prisma schema —
useful for testing onboarding / cold-start flows (e.g. a fresh import with no
categorization rules yet):

```bash
npm run db:reset
```

(equivalent to `npx prisma db push --force-reset`.) This drops every table and recreates them directly from `prisma/schema.prisma`,
then regenerates the Prisma client. After it finishes you have **0 users, 0
expenses, 0 rules, 0 categories**; the default allocations are re-created on your
next sign-up/login.

> ⚠️ **Destructive and irreversible** — it deletes the entire database. Only run
> it against a local/dev database. Take a `pg_dump` first if you need the data.

> 🍪 **Log out afterwards.** The reset wipes the users table, but your browser
> keeps its session cookie — which now points to a deleted user. Clear the site
> cookies (DevTools → Application → Cookies) or log out, then register again,
> before using the app. (The server now returns a clean 401 for such stale
> tokens instead of erroring, but you still need a fresh login.)

> 📝 **Why `db push` and not `prisma migrate reset`?** The migration history is
> currently incomplete (some tables are created via `db push` rather than by a
> migration file), so `migrate reset` fails partway through. `db push` syncs
> straight from the schema and always works. Regenerating a clean migration
> baseline is tracked separately.

---

## 4. Run the Application

### Development (frontend + backend together)

Start both the Vite dev server and the Express API server concurrently:

```bash
npm run dev:all
```

| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:5173      |
| Backend  | http://localhost:3002      |

### Run services individually

**Frontend only:**

```bash
npm run dev
```

**Backend only:**

```bash
npm run dev:server
```

---

## 5. Production Build

Build the frontend for production:

```bash
npm run build
```

The compiled output will be in the `dist/` directory. Serve it with a static file server or your hosting provider, and ensure the backend is running separately on the configured `SERVER_PORT`.

---

## 6. Stripe Webhooks (optional)

To test Stripe subscription events locally, use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks to your local server:

```bash
stripe listen --forward-to localhost:3002/api/stripe/webhook
```

Copy the displayed webhook signing secret and set it as `STRIPE_WEBHOOK_SECRET` in your `.env`.

---

## Available Scripts

| Script                  | Description                                      |
|-------------------------|--------------------------------------------------|
| `npm run dev`           | Start the Vite frontend dev server               |
| `npm run dev:server`    | Start the Express backend dev server             |
| `npm run dev:all`       | Start both frontend and backend concurrently     |
| `npm run build`         | Build the frontend for production                |
| `npm run prisma:generate` | Generate the Prisma client from the schema     |
| `npm run prisma:migrate`  | Apply pending database migrations               |
| `npm run db:reset`        | Wipe all data and rebuild the DB from the schema (dev only) |

---

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, React Router, Recharts, i18next

**Backend:** Node.js, Express, TypeScript, Prisma ORM

**Database:** PostgreSQL

**Services:** Stripe (payments), Resend (email), Google OAuth (authentication)
