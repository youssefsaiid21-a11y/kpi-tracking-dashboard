# KPI Tracking Dashboard

A full-stack dashboard for outreach activity, conversion, team targets, attribution, anomalies and data quality. Uses Next.js 14, React 18, TypeScript, PostgreSQL/Prisma, NextAuth, TanStack Query and Recharts, with Microsoft Graph and HubSpot integration modules.

**Status: development prototype.** This portfolio version replaces contact identifiers with synthetic examples and excludes internal deployment instructions. It does not contain a live company dataset or verified business-performance results.

## Review the implementation

- `src/lib/services/`: KPI calculations, attribution, anomaly detection, classification and external data synchronization.
- `src/app/`: dashboard pages, settings, authentication and API routes.
- `prisma/`: schema, migrations and illustrative seed generation.
- `src/**/*.test.ts`, `e2e/`: unit/service tests and Playwright browser scenarios.

## Local development

Use Node.js 22, npm and a dedicated PostgreSQL development database.

```sh
npm ci
cp .env.example .env
# Set a local database URL, a generated NEXTAUTH_SECRET and your own test configuration.
npm run db:generate
npm run db:migrate
npm run dev
```

The development server uses port 3456. Check `.env.example` for optional integration settings. Microsoft Graph and HubSpot flows require your own development registrations/accounts; do not connect production company systems during review.

The optional `npm run db:seed` writes synthetic demo data into the configured database and requires an explicit `SEED_PASSWORD`. Use it only with an isolated local database. Browser authentication also requires `E2E_TEST_PASSWORD` configured for that demo account.

## Validation

```sh
npm run lint
npx tsc --noEmit
npm test
```

For browser tests, install Playwright Chromium, configure the local app and test account, then run `npm run test:e2e`. These commands are review instructions, not a claim that live integrations or browser flows passed during portfolio preparation.

## Data boundaries

Credentials, real employee/contact identifiers, operational runbooks and generated database/build state belong outside Git. Demo identifiers are synthetic. Review integration permissions and data handling before any deployment.
