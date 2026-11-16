# PSL Detailer

An offline-capable field detailing web app for medical representatives and administrators. Built with React, Express, IndexedDB, and SQLite. The repository contains the application, server, database initialization, automated tests, Docker configuration, and a manual acceptance checklist.

## Run locally

Use **Node.js 24 LTS** and npm. SQLite support is built into this Node version; no separate database installation is required.

```bash
git clone https://github.com/devjpapp/PSL_DETAILER_TEST.git
cd PSL_DETAILER_TEST
npm ci
npm run setup
npm run build
npm start
```

Open **http://localhost:3000**. Setup creates `admin@psl.local` and prints a randomly generated password once. Save that password. It does not reset an existing administrator.

Optional: run `npm run seed:demo` to add one **fictional** HCP and one demo sample SKU. No production HCP or Medretailers data is included. Administrators can add real testing accounts in **Settings → Add account**, import an approved masterlist in **HCP directory**, and maintain SKUs in **Sample catalog**.

To set the first administrator's email or password, supply `ADMIN_EMAIL` and `ADMIN_PASSWORD` as environment variables when running setup. A supplied password must contain at least 12 characters. The server has no default fixed password.

For development, run `npm run dev`. **Offline reloads require the production build (`npm run build` followed by `npm start`)**, because the service worker is intentionally disabled in development.

## Test offline sync

1. Start the production app, sign in online, and wait until Sync center shows a successful sync and **Offline app shell is ready**.
2. Create an HCP or import the approved masterlist; add active sample SKUs. Create a medrep account if desired and sign in with it.
3. Use browser developer tools to set the network to **Offline**, or disconnect the device. Keep site storage intact.
4. Add a non-masterlist HCP, plan a call, and record an engagement. Start the timer, enter the patient count, add a gallery photo, draw a signature, and optionally add sample quantities and order references.
5. Save the engagement. Verify it appears as pending in Sync center. Reload the page while still offline: saved work should remain available. Also test closing a draft before submission and reopening it.
6. Reconnect with the app open. Sync begins automatically on the online event, or on the periodic retry. Verify the queue clears and the engagement has separate actual and sync dates.
7. Sign in as administrator in another browser to verify the server received the record and attachments exactly once.

See [the full acceptance checklist](docs/ACCEPTANCE.md) for conflict, mobile, role, import, and failure testing.

## Implemented scope

| Area | Behavior |
| --- | --- |
| Accounts | Administrator and medrep roles; account creation, deactivation, sign-in, sign-out, password changes; secure HTTP-only session cookies. |
| HCP directory | Name, email, phone, address, dispensing status, classification, institution category, notes, masterlist/source ID, and explicit Medretailers HCP mapping. |
| Masterlist | Admin CSV template/import with preview, row validation, stable source-ID matching, unique source IDs, and approved HCPs shown first. No fuzzy name matching. |
| Non-masterlist HCPs | Medreps may add their own. Visible to the creator and admins; separated in reports. Admins can approve them into the masterlist. |
| Engagements | Patients seen, up to three gallery images, drawn signature, automatic actual timestamps, distinct server sync timestamp, notes, and measured detailing duration. |
| Detailing timer | Explicit start/stop; stopping automatically on submission if still running. Draft/timer survives reload. Elapsed wall time includes time away from the app; maximum 24 hours. |
| Planning | Dated calls, start times, duration, notes, rescheduling, cancellation, daily itinerary, seven-day calendar, daily Gantt planned/actual comparison, and completion links. |
| Samples | Admin SKU catalog with active/inactive state; multiple SKU/quantity lines per engagement; distribution exports. |
| Booked sales | Multiple manually entered Medretailers order references per engagement, marked **Unverified**. |
| Reporting | Date, representative, institution, masterlist, and sync filters; engagement totals, unique HCPs, detailing minutes, sample units, booked references; engagements, samples, orders, and plans CSV exports. |
| Offline | Precached application shell, per-user IndexedDB records, persisted drafts and attachments, transactionally written outbox, automatic reconnect/reopen sync, retry/backoff, idempotent writes, visible errors, explicit conflict resolution, local backup export. |

Institution categories: **Private Clinic / Residence**, **Standalone**, **Mall**, and **Wellness / Aesthetic Centre**.

## Assumptions and integration boundaries

The source requirements left six areas open. The implementation makes these explicit:

- **Masterlist source:** Admin-uploaded CSV is the initial source. Import matches exact `externalId`, never a person's name. Contact details are optional but available; name, dispensing status, classification, and institution category are required. An approved HCP requires a source ID.
- **Non-masterlist reporting:** These engagements are permitted, labeled, and included in reports. Targets and incentive rules are not assumed. Admin approval makes the HCP visible to all reps on their next sync.
- **Duration:** Measured by a persisted device start/end timer. No manual override or pause rule is assumed. Actual timestamps originate on the device and cannot be trusted as independently verified attendance evidence.
- **Sampling:** Tracks quantities distributed, not stock balances. Inventory allocation, returns, batch numbers, and stock reconciliation require additional business rules. SKUs are configured by the administrator; no real SKU list was supplied.
- **Booked sales:** Reference capture only. No external Medretailers API, credentials, validation feed, order amounts, or revenue calculation was supplied. The app does not label these references as externally verified sales.
- **Planning:** Medreps plan their own calls; admins can inspect and edit team plans. No approval chain, route optimization, target quotas, or cross-representative assignment workflow is assumed. Completed plans cannot be changed. Gantt shows a full local calendar day.

**This is a testable first implementation, not a claim that the missing integrations or business decisions have been resolved.**

## Offline behavior and practical limits

- Initial sign-in and initial data download require a working connection. Only previously downloaded records can be browsed offline. Admin account management requires a server connection.
- HTTPS is required for service workers on remote devices. `http://localhost` is accepted for local testing. Opening `http://<computer-LAN-IP>:3000` on a phone will not provide a reliable offline shell; use an HTTPS host or HTTPS reverse proxy.
- Sync runs when the app is open: after saving, when connectivity returns, when the tab becomes visible, and on retries (15 seconds, increasing to 2 minutes after failures). Reopening the app resumes sync. Closed-app background execution is **not guaranteed** by mobile browsers.
- A sync request contains one complete record with its images/signature. On a lost response, the same mutation ID is retried; the server returns the prior receipt. Accepted records are not duplicated.
- Multiple offline edits are queued in order. Conflicts retain the latest local changes until the user chooses the local or server version. Validation failures remain queued for correction or retry. Resolve dependencies (HCP, then plan, then engagement) before retrying dependent failures.
- The server snapshots HCP classification/masterlist status and sample details at sync. These snapshots do not change when catalog records are subsequently edited. Local pending reports use the captured local snapshot until sync.
- Submitted engagements are immutable in this version. Document corrections through a follow-up engagement with explanatory notes. Rejected, unsynced records can be corrected in Sync center.
- The app asks the browser for persistent storage, but browsers may still evict site data. Do not clear site data with unsynced work. Export a local backup before changing devices or troubleshooting storage. Backup JSON is a support/recovery artifact; automatic import is not implemented.
- Signing out requires a server connection and an empty outbox. It removes cached data and, after confirmation, saved drafts from this browser. Pending work cannot be silently discarded.
- Offline access uses the device's cached profile; it is not an offline password check. Local browser data is not separately encrypted by the app. Use device screen locks and individual browser/device profiles. Deactivating an account prevents server access immediately but cannot remotely erase an offline device.
- Gallery photos use a file picker without camera capture or camera permissions. The operating system may still offer its own camera entry within its file picker. PNG/JPEG/WebP only, maximum 2 MB each, up to three per engagement; signature and at least one photo are required.
- This initial sync implementation downloads the accessible dataset, including engagement attachments. It is suitable for evaluation and bounded pilots; large deployments should introduce incremental sync and separate attachment/object storage.

## Configuration and hosting

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port. |
| `DATA_DIR` | `./data` | Persistent SQLite directory. Must be writable by the app. |
| `COOKIE_SECURE` | `0` | Set to `1` behind HTTPS for secure session cookies. |
| `ADMIN_EMAIL` | `admin@psl.local` | First administrator email, used only by setup. |
| `ADMIN_PASSWORD` | Randomly generated | First administrator password, used only by setup. |

The supplied scripts read an optional local `.env` file. Copy `.env.example` to `.env` if needed. Never commit passwords or `.env` files.

**Docker option:**

```bash
docker compose up --build
```

The initial administrator is created automatically and the generated password is printed once in the container logs. The named volume `psl-data` persists the SQLite database across container restarts. To add fictional demo data:

```bash
docker compose exec app npm run seed:demo
```

For a shared test deployment, use a Node.js host with a persistent disk or Docker plus an HTTPS reverse proxy. Set `COOKIE_SECURE=1`. GitHub Pages cannot run the server/database. This repository push does **not** itself deploy a live website.

Use one app process with local SQLite storage for this version. Back up the complete SQLite database with an SQLite-aware backup tool, or stop the app before copying the data directory including WAL files. Do not place databases, backups, or real test captures in this public repository. Database tables are created automatically on startup; there is no destructive reset command.

## Verification

```bash
npm run check
```

Runs the automated server and IndexedDB tests, then builds the production app and offline service worker. GitHub Actions runs the same checks on pushes and pull requests.

Tests cover authentication, authorization, validation, snapshotting, timestamp preservation, sample/catalog integrity, account deactivation, idempotent retry, conflicting edits, local draft persistence, queue recovery, and user data isolation. Browser/device behavior remains subject to [manual acceptance testing](docs/ACCEPTANCE.md); automated IndexedDB tests use `fake-indexeddb` and do not establish real-browser service worker behavior.

## Project layout

```text
src/                 React UI, offline database, synchronization
server/              Express API, schemas, SQLite/auth, setup
public/              PWA manifest and icon
scripts-build-sw.js   Build-specific offline cache generation
test/                API and offline queue tests
docs/                Architecture and acceptance checklist
.github/workflows/   Test/build CI
```

See [architecture and API details](docs/ARCHITECTURE.md).
