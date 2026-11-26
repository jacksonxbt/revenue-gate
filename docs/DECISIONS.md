# Decision log

- 25 Nov: Revenue Gate chosen over VIGIL; OpenFour primary, BNB Developer secondary.
- 25 Nov: Hub preferred subject to runtime validation; Boost fallback subject to credential availability. Source review completed, runtime not verified due to network restrictions in prior Codex environment.
- 25 Nov: testnet only; one functional research agent and observable product-payment milestone. No claims of commercial demand from demo payments.
- 25 Nov: technical lead owns OpenFour contracts, Lambda, API Gateway, DynamoDB, CloudWatch and Claude research/payment credibility services. Codex owns frontend; coordinate via a documented API contract. No binary guarantees of genuine customers; distinguish observed evidence, uncertainty and flagged cases.
- 25 Nov: use OpenFour Boost and developer documentation as references for frontend integration, not a requirement to clone the entire launchpad. Existing pricing and ordinary selling remain the proposed MVP baseline.
- 26 Nov: route confirmed as OpenFour Hub. The mechanism is a custom Migrate module (`RevenueGateMigrateModule`) that keeps OpenFour's standard token, vault, curve and trade modules. Rationale: graduation is the only responsibility that changes. Owner: technical lead. Branch `openfour/revenue-gate-module`.
- 26 Nov: integration shown on a developer-owned OpenFour fork on BNB testnet (OpenFour's `fork-deploy` tool), because official listing needs OpenFour's review and audit. Evidence is listed in the README.
- 26 Nov: backend runs as one Node.js server on EC2 with DynamoDB, S3 and CloudWatch, instead of the planned Lambda and API Gateway. Rationale: fastest path to a working public URL. Secrets Manager was tried and removed at the technical lead's request; keys are in a server-side `.env`.
- 26 Nov: Groq (`openai/gpt-oss-120b`) is used for wallet scoring and reports instead of Claude, to stay on a free tier.
- 26 Nov: payments are verified on-chain (success, recipient, amount, no reuse) before scoring, and a report requires a confirmed payment. The verdict label follows the contract rule: a score of 60 or more counts.
- 26 Nov: frontend redesigned and live mode connected by the technical lead while Jackson was unavailable; `live-view.js` was folded into `app.js`. A Pay with MetaMask button was added, with paste-a-hash kept as fallback. This changes the earlier rule that the UI never initiates a transfer. Branch `integration/frontend-redesign`; for Jackson's review.
- Open: the gate has not opened on-chain (no payment has scored 60 or more); self-payment is not blocked; repository visibility for judges.

For changes, record date, decision, rationale, owner and linked issue/PR.
