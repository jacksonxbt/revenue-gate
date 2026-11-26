# Live integration contract

## Status as built, 26 Nov 2026

The backend implements the four operations below as `POST /api/quote`, `/api/payment`, `/api/report` and `/api/launch`. Differences from the proposal:

- Transport is same-origin HTTP with a 30-second timeout (the AI calls can take several seconds). HTTPS is not set up on the hosted server.
- `payment` also returns `confidence` (0 to 100) and `onChainTx` (the gate-contract write). A transfer that is not found yet returns `status: pending`; a failed check returns `status: failed`; both carry a `reason`.
- `report` returns HTTP 402 until the request has a confirmed payment.
- `launch` returns `enforcement: "on-chain"`, plus `onChainProgress` (totals read from the RevenueGate contract) and `openfour` (the OpenFour token's sale state and the migrate module's answer).
- The UI can initiate a transfer through MetaMask; see `docs/DECISIONS.md`.

## Original proposal

Coordination: https://github.com/jacksonxbt/revenue-gate/issues/2

These are frontend-normalized shapes, **not agreed AWS endpoints**. The technical lead can supply different wire shapes; adapt the transport rather than change backend code. All example values are synthetic.

| Operation | Input | Normalized response |
|---|---|---|
| quote | asset, chainId:97 | requestId, asset, chainId:97, amountWei (decimal string), recipient (address), expiresAt (ISO) |
| payment | requestId, txHash, chainId:97 | chainId:97, txHash, amountWei, status: pending/confirmed/failed, confirmations, assessment: pending/eligible/flagged/uncertain, reason |
| report | requestId | status: pending/ready/failed; ready: title, summary, observations:string[], sources:{label,url}[] |
| launch | chainId:97 | chainId:97, revenueWei, targetWei, eligible:boolean, enforcement: informational/enforced/unverified, state, payments: payment[], contractAddress, evidenceTxHash |

The placeholder transport uses POST JSON, 15-second timeout, HTTPS same-origin routes, no credentials and no redirects. Confirm actual methods, auth, CORS, error schema, retry/idempotency and status semantics before enabling. Set liveConfig in live.js only to verified public API configuration; no API keys. If auth is required, implement the agreed browser-safe flow.

Live mode is currently intentionally disconnected. Users may paste an existing dedicated testnet receipt once API is confirmed; this UI never initiates a transfer. The backend must verify request binding, network, recipient, amount, receipt finality, replay protection and assessment before counting revenue. Frontend checks are presentation validation, not settlement or security guarantees. Contract enforcement is displayed as backend-reported evidence, not independently verified by frontend.

Acceptance: real testnet quote, verified receipt, pending and confirmed states, sourced report, flagged/pending excluded per authoritative backend, authoritative launch status, and public testnet evidence. Never mix demo and live records.
