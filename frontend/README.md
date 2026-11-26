# Revenue Gate frontend

## Status as built, 26 Nov 2026

The sections below this one are Jackson's original brief and are partly out of date.

- Live mode is connected. `live.js` points at the page's own origin when the backend serves it, and at the hosted API when previewed with `npm start`.
- `live-view.js` was removed; `app.js` renders both demo and live modes from one set of views.
- The research flow has a Pay with MetaMask button (connect, switch to chain 97, send the quoted amount, verify once confirmed). Pasting a transaction hash remains as a fallback.
- The Gate page shows gate progress read from the contract, the payment list with each wallet score and reason, and the OpenFour token status.
- `logo.svg` is the project mark.
- Tests: `npm test` (5 passing).

## Original brief

Run from this directory with Node 22+: `npm start`; visit http://127.0.0.1:4173. No install or secret is needed. Run `npm test` for the demo adapter checks. Static hosting can serve index.html, styles.css, app.js, adapter.js, live.js and live-view.js together. Demo state resets on refresh.

## Integration handoff

The interface has an isolated in-memory adapter. A separate live mode and async adapter are now prepared; live configuration remains blank until the technical lead confirms routes. No demo fallback occurs. The following are **proposed data shapes**, not confirmed endpoints:

- Research quote: request ID, asset, chain ID 97, amount/denomination, recipient or transaction parameters, expiry.
- Payment status: request ID, transaction hash, confirmations, amount, assessment (pending/eligible/flagged/uncertain), reason and evidence. A testnet transaction is not evidence of independent demand.
- Report: title, summary, observations, actual source URLs and timestamps, status.
- Launch: eligible revenue, target, denomination, payment records, preset/contract addresses and actual chain state; distinguish informational milestone and enforced eligibility.

Use backend-provided payment instructions, require explicit wallet confirmation and verify chain 97. Never expose AWS, Claude or partner credentials. Do not create real-money transactions. Keep demo mode visibly separate; do not silently fall back to sample records after live failures.

OpenFour references: [Boost](https://github.com/four-meme-community/openfour-boost-launchpad) for frontend/backend boundaries; [developer toolkit](https://github.com/four-meme-community/openfour-docs/tree/main/developer) for preset and migration concepts. Original UI, no copied upstream code. Dependency-free implementation chosen to minimize setup friction before the deadline.

## Outstanding

API base URL and CORS, authentication, payment flow and report schema, testnet wallet integration, actual OpenFour preset/contract state and verification, browser/visual QA, production hosting.
