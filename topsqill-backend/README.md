# Topsqill.ai backend

NestJS (Fastify) + PostgreSQL + Redis, running on Google Cloud in Mumbai.

**The rule this codebase follows:** the browser only ever talks to this API. It never
reaches the database and never holds a secret key. Claude, WhatsApp, Meta, Google and
every other service is called from here.

---

## Progress

| Phase | Status |
|---|---|
| **0. Foundation** | Done: auth, profiles, network, listings, media, feed, infrastructure |
| **1. Core network** | Done: requirements and matching, search, saved items, admin console and moderation |
| **2. Business tools** | Done: real-time messaging, notifications, leads and CRM, lead source webhooks |
| **3. AI and growth** | Done: AI listing import, AI writing, Campaign Studio, jobs board |
| **4. Launch readiness** | Done: Meta, Google and LinkedIn ad APIs, WhatsApp sending with consent rules, campaign delivery tracking |

## What is in Phase 0

| Area | What it does |
|---|---|
| **Auth** | Phone OTP sign-in (WhatsApp or SMS), JWT access tokens, single-use refresh tokens, admin role |
| **Profiles** | Four member types, photo and cover, KYC/RERA fields, contact details hidden until you connect |
| **Network** | Connection requests, accept/ignore, follows, stored counters |
| **Listings** | Create, edit and search with keyset pagination, cached detail pages, buffered view counts |
| **Media** | Direct-to-storage uploads for photos, videos and 3D models, then background processing |
| **Feed** | Posts, likes, comments, and feeds pre-built in Redis |
| **Workers** | Image resizing, video to HLS, 3D compression, feed delivery, counter flushing |
| **Platform** | Health checks, structured logs, request timing, rate limits, Swagger docs |

## What is in Phase 1

| Area | What it does |
|---|---|
| **Requirements** | Buyers post what they want; the board is public and paginated |
| **Matching** | Scores every listing against a requirement (city, locality, bedrooms, budget, timeline). Runs in the background both ways: when a requirement is posted, and when a new listing goes live |
| **Search** | One search box across people, listings and localities, with full-text search and fuzzy name matching, plus locality price statistics |
| **Saved items** | Save listings, profiles, projects and jobs |
| **Reports** | Members report posts, listings and profiles |
| **Admin console** | Dashboard numbers, verification queue with automatic risk checks, approve/reject/request-info, moderation (hide and restore), member management (verify, suspend, remove) and a full audit log |

## What is in Phase 2

| Area | What it does |
|---|---|
| **Messaging** | One-to-one chat with attachments and shared listings, read receipts, typing indicators, unread counts. Delivered over WebSocket through Redis, so a message sent on one server reaches a phone connected to another |
| **Notifications** | In-app notifications for connections, messages, leads, matches and comments. The badge count comes from Redis, so it is a single fast read. Push and WhatsApp delivery run in the background |
| **Leads and CRM** | Capture, automatic scoring (0 to 100) and qualification, a board grouped by stage, assignment, activity timeline, notes and calls, and per-dealer statistics |
| **Duplicate merging** | The same buyer enquiring from several places becomes one lead with a re-enquiry note, not three phone calls |
| **Lead sources** | One webhook URL per source with its own secret key. Parsers for Meta Lead Ads (including the signature check and verification handshake), Google Ads, LinkedIn, 99acres, MagicBricks, Housing.com, call tracking and plain website forms |
| **Routing** | Leads go to the owner or round-robin across the team; every event is recorded in a log the member can inspect |

## What is in Phase 3

| Area | What it does |
|---|---|
| **AI listing import** | Paste a project link and its page text, and Topsqill.ai builds the whole project: name, builder, RERA number, towers and floors, configurations with sizes and prices, amenities, nearby places with distances, USPs, a summary and an honest risk report. Publishing creates one live listing per configuration |
| **Rules first, AI second** | A rule-based extractor always runs (square metres to square feet, Indian price formats, RERA numbers, "three 30-storey towers"). Claude refines it when a key is configured. Both paths give the same shape, so the product works either way |
| **AI writing** | Profile text, listing copy with a price check, posts (punchy, Hinglish, hashtags, grammar), comments, and WhatsApp, email or call follow-ups for leads |
| **Campaign Studio** | Builds a full plan from the listing and real demand: personas with budget shares, target pincodes (core, demand and HNI feeder areas), intent and negative keywords, channel split, schedule, lead qualification and compliance checks. Creatives for feed, carousel, reel, Google and WhatsApp. A forecast of reach, leads, qualified leads and cost per qualified lead |
| **Jobs board** | Write a job post from one line, search and apply, a match score with strengths and gaps, and an applicant list for employers ranked by fit |
| **AI safety rails** | The API key never leaves the server,every member has a daily limit, identical prompts are cached, usage and cost are recorded per feature, and any AI failure falls back to rules instead of breaking the request |

---

## Run it locally

**With Docker (one command):**
```bash
cp .env.example .env
docker compose up --build
npm run db:migrate && npm run db:seed     # once the database is up
```

**Without Docker:** start PostgreSQL 16 (with PostGIS) and Redis yourself, then:
```bash
npm install
cp .env.example .env            # set DATABASE_URL, REDIS_URL, JWT_SECRET
npm run db:migrate
npm run db:seed                 # demo data: members, listings, chats, leads, campaigns
npm run build && npm start      # API on http://localhost:8080
node dist/worker/main.js        # workers, in another terminal
```

API docs (development only): http://localhost:8080/docs

### Try it

```bash
curl localhost:8080/health
curl "localhost:8080/v1/listings?city=Noida&purpose=sale&limit=5"

# sign in (in development the code is returned instead of being sent)
curl -XPOST localhost:8080/v1/auth/otp/request -H 'content-type: application/json' \
     -d '{"phone":"9355135887"}'
curl -XPOST localhost:8080/v1/auth/otp/verify  -H 'content-type: application/json' \
     -d '{"phone":"9355135887","code":"123456"}'
curl localhost:8080/v1/me -H "authorization: Bearer <accessToken>"
```

---

## Deploy to Google Cloud

**Once, by your team:**

1. Create the project (`topsqill-prod`) and turn on billing.
2. Install the `gcloud` CLI and Terraform, then `gcloud auth application-default login`.
3. ```bash
   cd terraform
   cp terraform.tfvars.example terraform.tfvars   # set project_id and alert_email
   terraform init && terraform apply
   ```
   This creates: a private VPC, Cloud SQL (PostgreSQL 16, private IP, daily backups to Delhi,
   point-in-time recovery), a read replica in production, Memorystore Redis, three storage buckets,
   Cloud CDN, an HTTPS load balancer with a managed certificate, Cloud Armor, Cloud Run services for
   the API and workers, Secret Manager entries, and alerts for slow responses, errors and database load.
4. Point `api.topsqill.ai` and `cdn.topsqill.ai` at the IP address Terraform prints.
5. Add your API keys:
   ```bash
   echo -n "sk-ant-..." | gcloud secrets versions add topsqill-prod-anthropic-key --data-file=-
   ```
6. `gcloud builds submit --config cloudbuild.yaml`

After that, every push to `main` builds both images, runs the tests, applies migrations and
rolls out the new version.

### Demo data

`npm run db:seed` fills every screen with believable data: 150 members across seven cities,
about 270 listings with photos, requirements with matches, jobs and applicants, posts, comments
and likes, three published projects, and an admin queue. It is wired around one real account
(`SEED_OWNER_EMAIL`, default `contact@topsqill.com`), which gets connections and invitations,
chats with unread messages, alerts, a full lead board, lead sources, six listings, two
campaigns, a draft project and saved homes. The account is created if it does not exist.

| Setting | Meaning |
|---|---|
| `SEED_OWNER_EMAIL` | The account to build the demo around |
| `SEED_OWNER_ADMIN=true` | Also make that account an admin |
| `DEMO_MEMBERS` | How many demo members (default 150) |
| `SEED_RESET_ONLY=true` | Remove the demo data and add nothing |

It is safe to run again: each run first removes the previous demo data exactly (every row is
recorded in `_demo_seed`). Real members' own data is never touched. Demo members have unverified
`@demo.topsqill.ai` addresses, so nobody can sign in as them.

**On staging**, after a `gcloud builds submit` (the seed ships in the API image):

```bash
gcloud run jobs deploy topsqill-staging-seed \
  --image asia-south1-docker.pkg.dev/topsqill/topsqill/api:$(git rev-parse --short HEAD) \
  --region asia-south1 --vpc-connector topsqill-staging-vpc-con \
  --service-account topsqill-staging-app@topsqill.iam.gserviceaccount.com \
  --set-secrets DATABASE_URL=topsqill-staging-database-url:latest \
  --set-env-vars JWT_SECRET=seed-only-placeholder-value,SEED_OWNER_EMAIL=contact@topsqill.com,SEED_OWNER_ADMIN=true \
  --command node --args dist/scripts/seed.js \
  --project topsqill --execute-now --wait
```

To remove it later, run the same command with `SEED_RESET_ONLY=true` added to `--set-env-vars`.

---

## How it stays fast

**Measured on a 1 vCPU test machine** (Postgres, Redis, the API and the load generator all sharing
one core), with 1,000 members and 1,167 listings seeded:

| | Result |
|---|---|
| Single search request | **4 ms** |
| Search, 10 concurrent users | p50 **8 ms**, p97.5 **57 ms** |
| Search with the cache switched off | p50 **29 ms**, p97.5 **118 ms**, no errors |
| Seeding 1,000 members + 16,000 connections | **0.88 s** |
| Query plan for the search | index scan on `listings_published_idx`, no sequential scan |

Throughput numbers from that machine are not meaningful; production containers get 2 vCPU each
and Cloud Run scales to 100 of them. Latency per request is what matters, and it is well inside
the 200 ms target.

**What makes it fast**

- **Fastify** instead of Express: roughly twice the requests per second on the same CPU.
- **Keyset pagination** everywhere: page 100 costs the same as page 1.
- **Only the columns a screen needs.** No `SELECT *`.
- **No N+1 queries:** owners, cover photos and "did I like this" are one query per page, not per row.
- **Indexes built for real screens**, including partial indexes that only cover active listings.
- **Three cache layers:** Cloud CDN for public pages and media, Redis for listings, profiles and feeds,
  and HTTP caching so the app does not re-download unchanged data.
- **Counters stored on the row** and view counts buffered in Redis, written in one batched statement
  every 30 seconds.
- **Feeds pre-built in Redis** when someone posts, so opening Home is a single list read.
- **Everything slow runs in a queue:** image resizing, video conversion, 3D compression, notifications.
- **Time limits on every query** (10 s) so one bad query can never block the service.
- **A cache outage slows things down but never breaks them:** Redis commands fail fast and the
  request falls through to Postgres. This is tested by killing Redis mid-load-test.

Run the load test yourself against a deployed environment:
```bash
TARGET=https://api.topsqill.ai npm run loadtest
```

---

## Security

- The database has **no public IP**. Only Cloud Run, through a private VPC connector, can reach it.
- Secrets live in **Secret Manager** and are never in the repository or the browser.
- Refresh tokens are stored hashed and are **single-use**.
- OTP attempts are limited per number and per IP; codes are hashed in Redis and expire in 5 minutes.
- **Cloud Armor** blocks SQL injection and cross-site scripting, and bans abusive IPs.
- Containers run as a **non-root user**, and the service account has only the permissions it needs.
- Contact details are only returned to accepted connections.
- All data stays in India (Mumbai), with backups in Delhi.

---

## Project layout

```
src/
  common/      settings, IDs and cursors, error handling, request timing
  db/          schema, connection pools, migration runner
  redis/       cache helper
  queue/       background job queues
  auth/        OTP sign-in, JWT guard, phone number handling
  profiles/    profiles, connections, follows
  listings/    search, detail, create and edit
  media/       upload links and processed media
  feed/        posts, likes, comments, home feed
worker/        background processors
terraform/     all Google Cloud infrastructure
drizzle/       SQL migrations
scripts/       seed data and load tests
```

## Next phases

- **Phase 2:** real-time messaging, notifications, requirement matching, leads and CRM, and the
  WhatsApp webhook moved into NestJS.
- **Phase 3:** AI listing import, the Campaign Studio with the Meta, Google and LinkedIn ad APIs,
  jobs, map routes and the YouTube gallery.
- **Phase 4:** full load test at target traffic, security review, backup and recovery drills, launch.

## What is in Phase 4

| Area | What it does |
|---|---|
| **Ad accounts** | Members connect their own Meta, Google Ads and LinkedIn accounts. Tokens go to Secret Manager; the database only stores the secret's name |
| **Live campaign launch** | The plan's channel split becomes a real campaign on each platform, with one delivery record per platform created before the API call. Meta campaigns are created **paused** and declare the **HOUSING** special ad category, which Meta requires for property ads |
| **Honest failures** | If one platform rejects the campaign, the others still go live and the member sees exactly which failed and why, instead of a silent half-launch |
| **Spend tracking** | Impressions, clicks, spend and leads are pulled back from the platforms and rolled up to the campaign, so members see real numbers rather than the forecast |
| **WhatsApp sending** | Connect a WhatsApp Business number, send free-form messages or approved templates, with delivery status written back from the webhook |
| **Consent rules enforced in code** | Nothing is sent without a recorded opt-in; STOP opts a person out immediately; outside the 24-hour service window only approved templates may be used. These are enforced in the service, not left to callers, because getting them wrong gets a business number banned |
| **Inbound WhatsApp** | Incoming messages create or update a lead and are added to its timeline; messaging the business first counts as consent to reply |
| **Campaign lifecycle** | A worker completes campaigns once their run ends and pauses their platform deliveries, so nothing shows as "active" after its budget period |

## Testing

```bash
npm test          # unit and integration tests
npm run loadtest  # against a running API
```

The integration tests replace Meta, Google, LinkedIn and WhatsApp with a stub, so
the full path (consent rules, the 24-hour window, budget splits, partial failures)
runs on every build without touching a real account or spending money.
