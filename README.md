# Carbon.Terminal — CSRD Scope 3 Compliance Platform

Multi-tenant B2B SaaS for aggregating supply-chain Scope 3 (CO₂e) data from supplier documents and producing audit-ready ESRS E1 disclosures.

Built on **TanStack Start** (not Next.js — this project's stack) + Supabase (native, BYO) + Google Gemini 2.5 Pro. Architecturally identical to a Next.js implementation: `createServerFn` and file-based server routes fill the same role as Next.js API routes.

## Views

- **Buyer dashboard** — `/dashboard`, `/suppliers`, `/reports`
- **Supplier upload portal** — `/upload?supplierId=<token>` (unauthenticated, token-scoped)
- **Sign in** — `/auth`

The UI is fully built and interactive on **mock data** so you can demo before wiring the backend.

## Wire-up checklist

### 1. Supabase project

1. Create a Supabase project.
2. Open the SQL editor and run `docs/supabase-schema.sql` — it creates `companies`, `suppliers`, `emissions_data`, RLS policies, and the `supplier-documents` storage bucket.
3. In Auth → Providers enable **Email** and **Google** (add your OAuth client ID/secret and set the redirect URL to `<your-domain>/auth`).

### 2. Environment variables

Add these secrets (Lovable Settings → Secrets, or your host's env):

| Key | Where |
|---|---|
| `VITE_SUPABASE_URL` | client + server |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client |
| `SUPABASE_URL` | server |
| `SUPABASE_SERVICE_ROLE_KEY` | server (for `/api/audit-document`) |
| `GEMINI_API_KEY` | server |

### 3. Replace mock data

`src/lib/mock-data.ts` is the only shim. Swap it for Supabase queries — the shape matches the schema.

### 4. Audit pipeline

`POST /api/audit-document` (see `src/routes/api/audit-document.ts`):

1. Fetches file from Supabase Storage → base64
2. Calls Gemini `gemini-2.5-pro` with `responseSchema` (native JSON mode) to extract `{ energy, materials, isEstimated, confidenceScore }`
3. Applies static conversion factors (`src/lib/carbon-factors.ts`) — e.g. `liters diesel × 2.68 kg CO₂e`
4. Inserts into `emissions_data`

Trigger it from the supplier portal after a successful storage upload (client-side `fetch('/api/audit-document', { method: 'POST', body: JSON.stringify({ supplierId, storagePath }) })`).

## Design system

Bloomberg-terminal density — charcoal surfaces (`oklch(0.14 …)`), amber primary (`oklch(0.82 0.17 78)`), green/red/cyan semantic accents. JetBrains Mono for tabular numerics, Inter for body. All tokens live in `src/styles.css`; no ad-hoc colors in components.

## Notes

- **Not Next.js.** This template uses TanStack Start. `src/routes/api/*.ts` = serverless API routes. Same functionality, different framework.
- **Google OAuth** is stubbed in the UI until you provide credentials; the "SKIP AUTH" link at the bottom of `/auth` takes you straight into the demo.
