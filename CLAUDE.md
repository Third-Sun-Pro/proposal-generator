# Proposal Generator

Proposal content generator for Third Sun Productions. Jocelyn uploads Zoom transcripts / discovery notes and the tool drafts proposal sections she pastes into Proposify.

## What It Does

- Extracts client info (company, contact, project type, scope) from uploaded transcripts/notes (PDF or text)
- Suggests similar past projects from the portfolio for reference
- Calculates pricing using Third Sun's standard rates
- Generates editable proposal sections that match the existing Proposify template format

## Tech Stack

Node.js + Express 5, Anthropic SDK, multer (file uploads), pdf-parse (transcript extraction). Vanilla HTML/CSS/JS frontend. Vitest + Supertest for tests.

## How to Run

```bash
npm install
node server.js          # Starts on port 3000 (override with PORT env var)
npm test                # Run all tests
npm run test:watch      # Watch mode
```

## Environment Variables (.env)

- `ANTHROPIC_API_KEY` — required (Claude API)
- `APP_PASSWORD` — required (team login)
- `SESSION_SECRET` — required (HMAC cookie signing — must be a random secret)
- `PORT` — optional, defaults to 3000
- `NODE_ENV` — set to `production` on deploy

## Key Files

- `server.js` — Express app, auth, upload routes, calls into `generate.js`
- `generate.js` — Anthropic calls, client info extraction, similar-project lookup, pricing, proposal section formatting
- `portfolio.json` — Past projects for similar-project matching
- `public/index.html` — Single-page web UI
- `uploads/` — multer drop directory for uploaded transcripts (gitignored)
- `tests/` — `generate.test.js` and `server.test.js`

## Endpoints

- `POST /login` / `GET /check-auth` — auth (HMAC cookie, 24h expiry)
- `GET /portfolio` — list past projects
- `POST /similar-projects` — find portfolio matches for a description
- `POST /calculate-pricing` — compute pricing breakdown
- `POST /extract-client-info` — multer-uploaded files → Claude extracts client details
- `POST /generate` — multer-uploaded files → Claude generates full proposal sections

## Important Context

- Output is meant to be **pasted into Proposify** — sections match Third Sun's existing Proposify template structure
- Pricing uses Third Sun's standard rates (in `generate.js`)
- File uploads max 20 MB, up to 10 files per request
- Hub integration: tool can be launched from Client Hub with `?hubClient=ID&clientName=...` URL params and writes data back to the hub

## Deployment

Deployed at **proposalgen.tsapp.us** on Hostinger (auto-deploy from GitHub push).

`.env` is created **manually** on the server — never commit it. Hostinger wipes the app directory on each deploy, so any persistent data must live outside the deploy folder.

## Git

- Remote: github.com/Third-Sun-Pro/proposal-generator (public — required for scheduled remote agents)
