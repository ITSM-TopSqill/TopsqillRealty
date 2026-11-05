# Topsqill.ai web app

Next.js front end for Topsqill.ai. It talks **only** to the Topsqill.ai API: no database
access, no secret keys, and no tokens in JavaScript.

## How the pieces fit

```
Browser ──► Next.js (this app) ──► Topsqill.ai API ──► PostgreSQL / Redis
             • renders pages on the server
             • holds the session in httpOnly cookies
             • /api/proxy attaches the token and forwards
```

- **Public, server-rendered and indexed:** home, listings search, listing pages,
  requirements, jobs. Each listing and job page carries its own title, description,
  Open Graph image and structured data, so Google can show the price and location.
- **Private:** feed, network, leads, messages, notifications and onboarding. These
  require a session and are excluded in `robots.txt`.

## Sessions

Sign-in sends a one-time code to the member's phone. The API returns an access token and a
single-use refresh token, and this app stores both as **httpOnly** cookies, so a cross-site
script cannot read them. When the access token expires, `/api/proxy` refreshes it once and
retries the request, so members are not signed out mid-action.

## Run it

```bash
cp .env.example .env     # point API_URL at the backend
npm install
npm run dev              # http://localhost:3000
```

With the backend running on port 8080, the whole product works end to end: sign in with a
code, browse real listings, contact a seller (which opens a chat and creates a lead on their
side), post to the feed, and manage the CRM board.

For production: `npm run build && npm start`, behind the same load balancer as the API.

## Pages

| Route | What it does |
|---|---|
| `/` | Landing page for visitors; the feed for members |
| `/listings`, `/listings/[id]` | Public search and listing pages with structured data |
| `/listings/new` | Add a listing, with an AI assist that fills the form from one sentence |
| `/requirements` | Buyer requirements board with AI-matched listings |
| `/network` | Invitations and suggestions |
| `/profile/[id]` | Public profile; contact details appear only to connections |
| `/messages` | Real-time chat |
| `/leads` | CRM board with stages and AI follow-ups |
| `/jobs`, `/jobs/[id]` | Job board with match scoring and applications |
| `/notifications` | Alerts |
| `/onboarding` | Three-step profile setup with AI-written headline and About |
| `/profile/edit` | Edit the profile, including avatar and cover photo |
| `/admin` | Admin console: overview, approvals, moderation, members, audit log |

## Uploads

Photos and videos go **straight from the browser to Cloud Storage**. The API issues a
short-lived signed link, the browser uploads to it with a progress bar, then tells the API
the upload finished, which queues resizing or video conversion. Large files never pass
through our servers, so the API stays free to answer other requests. The uploader polls
until each file is ready, and only finished files are attached when a listing is published.

## Admin console

`/admin` has its own dark layout and no member navigation. Access is checked on the server
by calling the API, so every page beneath it is protected by default and non-admins see a
plain "Admins only" page. It is excluded in `robots.txt`.

| Page | What it does |
|---|---|
| Overview | Member, listing and queue numbers, plus a 14-day signup chart |
| Approvals | KYC and RERA queue with automatic risk checks, then approve, reject or ask for more |
| Moderation | Reported posts, comments and listings; hiding is reversible, nothing is deleted |
| Members | Search and filter, toggle KYC and RERA, suspend, reinstate or remove |
| Audit log | Every admin action, with the reason and when it happened |

## Notes for the team

- **Images** are served from the CDN in AVIF, WebP or JPEG at four sizes; the app picks the
  right one for each slot.
- **Chat** polls every five seconds. The backend already publishes over WebSocket, so this can
  be swapped without changing the screen.
- **Dark mode** follows the device setting through CSS variables.
- **No Tailwind or component library**: one stylesheet of design tokens taken from the approved
  prototype, which keeps the bundle small and the look consistent.
