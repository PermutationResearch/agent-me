# Public submissions and review

**Current delivery mode: localhost only.** The owner requested no public launch.
The public test endpoint was disabled on October 25, 2026; it returns 404.
Cloudflare resources are retained for a future launch. Use `http://localhost:5181/`.
Do not re-enable public routing or intake until the owner explicitly requests it.

Agent-Me’s public service uses Cloudflare Workers for the React application and intake API, with a separate D1 database for submitted activity. It runs independently of the owner's Mac, encrypted history vault, private knowledge, and personal optimization runtime. No existing personal history is copied into production.

## Contributor experience

The homepage explains what is being offered: selected AI-agent activity for review, with a possible price and intended-use offer. Contributors review and redact locally, select records, choose acceptable uses, and explicitly confirm submission. An exported JSON file is also accepted through `/submit`. The deployed upload limit is **4 MiB of pretty-printed selected activity**, advertised by the service. Browser-local extraction and download continue to support 25 MiB exports. Select fewer records if an export is too large for hosted intake.

The server verifies the shared portable schema, selected-record counts, provenance references, event hashes, and overall checksum. A private receipt grants access to that one submission; the server stores only a hash of its access code. Identical retries return the original submission. Contributor access never includes private reviewer notes or an inbox listing.

Offers state an exact currency amount and intended uses within the contributor's choices. Acceptance is `accepted_pending_agreement` with `payment_status: not_started`. This release does not execute a purchase, payment, final license, email notification, optimization run, or model training.

## Reviewer access

Open `/buyer` on the public site and enter the **production** buyer key. It is distinct from the local review key. The browser keeps the key only in memory; locking or leaving clears it. Store the production key in a trusted private location and configure it with Wrangler's secret command. Never place a key in a URL, Git, public assets, a `VITE_*` variable, or a deployment log.

The buyer workspace supports selected-record inspection, search, private review notes, declines, price/use offers, and response status. Unknown, owner-profile, personal-memory, chat, optimization, and documentation APIs are not part of the public Worker. A public build also removes access to the legacy `/workspace` interface. Local builds preserve the personal workspace.

## Deployment

The `wrangler.jsonc` identifies the Worker, existing account, dedicated D1 database, assets, and rate-limit binding. It contains no secret. Use Node 24 for the Worker test suite and Wrangler 4.93.0 (the launch version):

```bash
npm --prefix frontend ci
npx wrangler@4.93.0 d1 migrations apply agent-me-submissions --remote
npx wrangler@4.93.0 secret put TRACE_BUYER_TOKEN
npx wrangler@4.93.0 deploy --dry-run
npx wrangler@4.93.0 deploy
```

The checked-in configuration keeps `workers_dev=false`, `preview_urls=false`,
and hosted `TRACE_SUBMISSIONS_ENABLED=false`. Only after a new explicit launch
request should public routing and hosted intake be enabled.

Enter the secret through stdin when prompted. If automating, supply stdin from private runtime storage without printing it. The build command sets `VITE_PUBLIC_MARKET=true`. Only `frontend/dist` and the public Worker are uploaded; private directories, external archives, local databases, backend personal modules, and `.env` files are not deployment assets.

The Worker is named `agent-me`. Submission acceptance requires `TRACE_SUBMISSIONS_ENABLED=true`, a runtime buyer key at least 32 characters long, and a D1 binding. `TRACE_SUBMISSION_STORAGE_LIMIT_BYTES=268435456` caps logical activity at 256 MiB; D1 encoding and metadata consume additional storage. Upload requests are bounded at 5 MiB; other request bodies remain bounded at 256 KiB. The submission limiter allows 20 attempts per minute per connecting IP per Cloudflare location. This is an initial abuse control, not a strict worldwide or identity quota; people sharing an IP may share its counter.

D1 stores activity in bounded chunks to respect its row-size limit. Metadata and chunks are committed in one transaction, including quota admission. Offer responses use version checks so concurrent changes produce a refreshable conflict instead of silently overwriting a newer proposal. Withdrawing deletes active chunks, closes open offers, and releases logical intake capacity. Minimal receipt metadata, notes, and proposal history remain.

All API responses use `Cache-Control: no-store`. Static hosting supplies HTTPS and restrictive response headers. Owner and contributor secrets are never embedded in the frontend. Request-body logging is not enabled.

## Persistence, backups, and rollback

D1 survives Worker versions and restarts. Cloudflare Time Travel is automatically enabled for production D1 databases: its retention is 7 days on Free and 30 days on Paid. Withdrawal removes active content; operational backups may retain deleted records during that provider window. Restoring a backup can restore previously withdrawn records, so reconcile withdrawals before reopening restored intake.

```bash
npx wrangler@4.93.0 d1 info agent-me-submissions
npx wrangler@4.93.0 d1 time-travel info agent-me-submissions
npx wrangler@4.93.0 deployments list --name agent-me
```

To roll back application code, select the verified previous version from the deployment list and use Wrangler's rollback command. Do not drop or recreate the submission database. Migrations are append-only after application. Do not restore production data merely to test a backup; perform recovery drills on an isolated database.

Provider references: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Workers rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), and [static asset routing](https://developers.cloudflare.com/workers/static-assets/binding/).

## Verification

```bash
npm --prefix frontend test
npm --prefix frontend run lint
VITE_PUBLIC_MARKET=true npm --prefix frontend run build
frontend/node_modules/.bin/vitest run cloudflare/worker.test.ts --root . --config frontend/vite.config.ts
```

Backend public-mode tests also cover the self-hosted Python boundary: `TRACE_MARKET_PUBLIC=true` fails startup if personal mode is enabled, a buyer key is missing, intake is disabled, or CORS is wildcard. That mode exposes only health/readiness and submission/review APIs. The Cloudflare Worker is a separate public adapter sharing the browser's schema validator; it never imports the personal backend.

Before declaring a deployment ready, verify real public HTTPS requests for a fictional selected-only submission, receipt recovery, role isolation, private notes, offers, pending-agreement acceptance, and withdrawal. Verify a multi-chunk submission and repeat reads after a new Worker deployment. Do not upload real owner history as a smoke test.
