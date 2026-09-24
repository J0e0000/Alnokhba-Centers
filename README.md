# ALNOKHBA — Centers & Academia Platform

Multi-tenant center management platform built with Next.js, featuring student
management, QR/scan & code-based attendance, payments & receipts, accounting,
and the ALNOKHBA ACADEMIA academic management layer (subjects, groups,
schedules, sessions, exams, grades).

## Tech Stack

- **Next.js** (App Router) + **React** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** components, **next-themes** (dark / light mode)
- **Prisma** ORM + **SQLite** (`db/custom.db`)
- **next-auth** based authentication with role-based access
  (admin / manager / reception / teacher / student)

## Quick Start

```bash
# 1. Install dependencies
bun install        # or: npm install

# 2. Environment
cp .env.example .env

# 3. Generate the Prisma client
npx prisma generate

# 4. Run the dev server
npm run dev        # http://localhost:3000
```

> A pre-seeded SQLite database is included at `db/custom.db`, so the app runs
> immediately with demo data. To rebuild it from scratch:
> `rm db/custom.db && npx prisma db push && npx tsx prisma/seed.ts`

## Demo Accounts

All passwords: `nokhba123`

| Username     | Role          |
|--------------|---------------|
| `admin`      | Administrator |
| `manager`    | Center manager |
| `manager2`   | Center manager |
| `reception`  | Reception     |
| `reception2` | Reception     |

Demo student attendance codes start at `10001`.

## Data Conventions

- All monetary amounts are stored as **INTEGER PIASTRES** (1 EGP = 100 piastres)
  to guarantee exact financial math.
- Business dates use `YYYY-MM-DD` strings.
- Multi-tenant: every record is scoped to a `Center`.

## Production Build

```bash
npm run build
npm start          # serves the standalone build on the configured port
```

## Deployment Notes

The project uses SQLite for simplicity. For serverless hosting (e.g. Vercel),
switch the Prisma datasource to a hosted database (Postgres / Turso) and set
`DATABASE_URL` in the host's environment variables — the `.env` file is not
committed to the repository by design.
