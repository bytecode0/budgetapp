
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

### Sync the database schema

Generate the Prisma client and push the schema to the database:

```bash
npm run prisma:generate
npx prisma db push
```

> ⚠️ **Do NOT run `npm run prisma:migrate` (`prisma migrate dev`).** The migration
> history is incomplete and fails on the shadow database (P3006/P1014: "the
> underlying table for model `Expense` does not exist"). This project syncs the
> schema with **`prisma db push`** (additive — adds new tables/columns without
> data loss). For a full wipe-and-recreate, see "Reset the database" below.

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

---

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, React Router, Recharts, i18next

**Backend:** Node.js, Express, TypeScript, Prisma ORM

**Database:** PostgreSQL

**Services:** Stripe (payments), Resend (email), Google OAuth (authentication)
