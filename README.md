# Topsqill.ai

Two separate projects that talk to each other over an API:

```
topsqill/
├── topsqill-backend/   NestJS + PostgreSQL + Redis   → port 8080
└── topsqill-web/       Next.js                       → port 3000
```

The browser only ever talks to the web app, and the web app only ever talks to the API.
Nothing in the browser touches the database or holds a secret key.

---

## Option A: one command (needs Docker)

```bash
docker compose up --build
```

Then, in another terminal, load the schema and demo data once:

```bash
docker compose exec api npm run db:migrate:prod
docker compose exec api npm run db:seed:prod
```

Open **http://localhost:3000**.

This starts PostgreSQL (with PostGIS), Redis, the API, the background worker and the web app.
Your data persists between restarts.

---

## Option B: your own PostgreSQL

**1. Prepare the database**

```sql
CREATE DATABASE topsqill;
\c topsqill
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

PostGIS is a separate install (`postgresql-16-postgis-3` on Ubuntu, `brew install postgis` on a
Mac). To skip it, delete the two `geom` lines near the end of
`topsqill-backend/drizzle/0000_init.sql`; everything except "listings near me" still works.

**2. Start Redis** (optional, but everything is faster with it)

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**3. Run the setup script**

```bash
DATABASE_URL="postgres://USER:PASSWORD@localhost:5432/topsqill" bash setup.sh
```

It installs both projects, writes their `.env` files, creates the schema, loads 1,000 demo
members and listings, and builds everything.

**4. Start the two services**

```bash
# Terminal 1
cd topsqill-backend && npm start

# Terminal 2
cd topsqill-web && npm start
```

Open **http://localhost:3000**.

---

## Signing in

Choose **Join** to create an account, or **Sign in** if you have one. Use an email address or a
10-digit mobile number. Nothing is sent locally: the code appears on screen ("Development mode")
and in the backend terminal, as `Email code for you@example.com is 123456`.

In production, email codes are sent over SMTP (set `smtp_host`, `smtp_user`, `email_from` in
`terraform.tfvars` and the `-smtp-password` secret). Mobile codes need WhatsApp
(`OTP_PROVIDER=whatsapp`). The sign-in screen only offers the methods that are configured.

To make yourself an admin:

```sql
UPDATE users SET is_admin = true WHERE phone = '+91YOURNUMBER';
```

Sign out and back in, and an **Admin** link appears in the top bar.

---

## What works locally

Sign-in, profiles, connections, the feed, listings and search, buyer requirements and matching,
real-time messaging, leads and the CRM board, jobs, and the full admin console.

## What needs real accounts

| Feature | What it needs |
|---|---|
| Photo and video uploads | Google Cloud Storage. The upload link is issued but the file has nowhere to go, so thumbnails stay empty |
| AI features | `ANTHROPIC_API_KEY` in `topsqill-backend/.env`. Without it, everything falls back to built-in rules and still works |
| WhatsApp, Meta, Google, LinkedIn | Real business accounts, connected after deployment |

---

## Useful commands

| Where | Command | What it does |
|---|---|---|
| backend | `npm run dev` | Rebuild and restart on every change |
| backend | `npm test` | 44 unit and integration tests |
| backend | `npm run db:seed` | Reload the demo data |
| backend | `npm run loadtest` | Performance check against a running API |
| web | `npm run dev` | Development server with hot reload |
| web | `npm run typecheck` | TypeScript check |

API documentation, while the backend is running in development: **http://localhost:8080/docs**

---

## Deploying to Google Cloud without a domain

If you have not bought the domain yet, set `use_custom_domain = false` in
`topsqill-backend/terraform/terraform.tfvars`. Cloud Run then serves the API on its own
`https://...run.app` address, and no load balancer or certificate is created. Switch it to
`true` later, add the DNS records and run `terraform apply` again.

Turn the APIs on before the first apply, because Google takes a minute to activate them:

```bash
gcloud services enable compute.googleapis.com secretmanager.googleapis.com \
  run.googleapis.com sqladmin.googleapis.com vpcaccess.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com --project YOUR_PROJECT_ID
```

## Going live

`topsqill-backend/terraform/` creates everything on Google Cloud in Mumbai: private VPC,
Cloud SQL with backups, Memorystore, storage buckets, CDN, load balancer, Cloud Run services
and alerts. See `topsqill-backend/README.md` for the steps.
