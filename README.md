# Revenue Gate

A launch mechanism for OpenFour on BNB Chain: a token graduates only when people have paid for the product behind it.

Today a token graduates on trading volume, which a few wallets can manufacture by trading with each other. Revenue Gate replaces that condition. Product payments are checked on-chain, the paying wallet is scored by an AI model, and OpenFour is allowed to graduate the token only once counted payments reach a threshold.

Everything here runs on BNB Smart Chain testnet (chain 97) with test funds only.

## How it works

1. A user pays 0.01 tBNB for the product, an AI-written research report.
2. The server reads the transfer from the chain and checks that it succeeded, went to the quoted address, sent the full amount and has not been used before.
3. An AI model scores the paying wallet from 0 to 100 using its testnet balance and history.
4. The server, acting as oracle, records the payment and score in the `RevenueGate` contract. A score of 60 or more counts and is added to the total; anything lower is recorded but not counted.
5. When counted scores reach the threshold (5,000), `RevenueGate.graduated()` becomes true.
6. OpenFour asks our migrate module before graduating a token. The module answers yes only if the sale conditions are met and the gate is open.

## OpenFour integration

OpenFour builds each token from five modules: token, vault, pricing curve, trade rules and migrate. We reuse the first four unchanged and replace the migrate module, which is the one that decides graduation.

- `contracts/contracts/openfour/modules/RevenueGateMigrateModule.sol` is adapted from OpenFour's `FairLaunchMigrateModule`. It adds one condition to `evaluate()` and re-checks it in `executeMigration()`.
- A "Revenue Gate" preset combines OpenFour's standard token and vault, the FairLaunch curve, trade and custom-data modules, and our migrate module.
- The preset is registered on a developer-owned OpenFour fork on BNB testnet, created with OpenFour's `developer/fork-deploy` tool. It is not on the official OpenFour registry, which requires their review and audit.

More detail: [`contracts/contracts/openfour/README.md`](contracts/contracts/openfour/README.md).

## Testnet evidence

All addresses and transactions are on BNB testnet and can be opened on https://testnet.bscscan.com.

| What | Address or transaction |
|---|---|
| RevenueGate contract (source verified) | `0x0423Ecb894B4C133EcAB0B540cf1dD8e46af263E` |
| OpenFour Core (our fork) | `0x47bbd1Fef75cD12EE89d66375652DFDaC3D34f15` |
| OpenFour Registry (our fork) | `0x60fC4573E855352aac3b4DB1Ee32a78558902313` |
| Revenue Gate preset id | `1795681909735` |
| RevenueGateMigrateModule implementation | `0xC681E759cE87681C7E4Df7b7e4d6c47FFABDDaf3` |
| RevenueGatePresetValidator | `0xA823a15742867A101Bd2B029ED907493535D69B2` |
| Token: Revenue Gate Demo (RGATE) | `0xBb9C33F7c3A0813ed8b7DC767ce577DF305816aE` |
| RGATE vault | `0x81C57D30548de9c89399480766Dd340A427838E4` |
| RGATE migrate module instance | `0xf62f8f7451ae6dad3aa1380844719bc908AD8872` |
| RGATE create transaction | `0xef7abaacc087fee08fd6b0c336cfb67e420c745c9dbcafea5e32049cc69c304c` |
| RGATE buy that passed the soft cap | `0xa051b3f4dc4e70b3782c218e252943bb8740f8aca02a83e0168d795b83ddc36d` |

Product payments made through the app on 26 Nov 2026:

| Payment transaction | Wallet score | Verdict | Recorded in the gate by |
|---|---|---|---|
| `0x70627e88fae51d7b145c6b6cebd27145c41d260875ec559abc84a466d605dada` | 55 | Not counted | `0x244d8b8ca5ad11c7f05bd87df7bffd4f310b6737bd429596bc43dcbb9ebaddec` |
| `0x0e3f36a37b8e7c0857cb5e93b91647e4b218609c67d56ec8a522ac4a6d19060a` | 55 | Not counted | `0x38b8e275702cb07832ad1d738b6d70d9e7cec5dd860c09df47b47ff0655316ec` |

What was observed on-chain:

- RGATE raised 0.002 tBNB against a 0.001 soft cap, so its sale condition is met.
- After that buy the token stayed in the Trading phase and no `MigrateExecuted` event was emitted.
- Read as OpenFour Core, the module's `evaluate()` returned `canMigrate = false` with the reason "Revenue gate closed: verified product payments are below the threshold".
- The gate holds 3 recorded payments (the two above and one earlier test record), none counted, total score 0 of 5,000.

Tests:

- `contracts`: 17 passing (9 for `RevenueGate`, 8 for `RevenueGateMigrateModule`).
- `frontend`: 5 passing.

## What is not proven

- **The gate has not opened on-chain.** Only the blocked outcome has been observed on testnet. The allowed outcome is covered by unit tests against a stand-in for OpenFour Core.
- **Both product payments came from the same wallet that receives payments.** Self-payment is not blocked yet.
- **The oracle is trusted.** Only the server's wallet can write scores to the contract.
- **Wallet scoring is shallow.** It uses balance, transaction count and whether the address is a contract. An attacker could age wallets to pass.
- **Reports are not fact-checked.** They come from the model's own knowledge, without live market data.
- **Not on the official OpenFour registry.** Listing requires OpenFour's review and audit.
- The hosted app is served over plain HTTP from a single server.

## Repository layout

| Path | Contents |
|---|---|
| `contracts/` | `RevenueGate.sol`, the OpenFour migrate module, vendored OpenFour interfaces, Hardhat tests, deployment records |
| `backend/` | Node.js API: quotes, on-chain payment checks, AI scoring and reports, oracle writes, OpenFour status reads |
| `frontend/` | Dependency-free web app, served by the backend |
| `docs/` | Product spec, decisions, tasks and demo outline |

## Run it locally

Requires Node 20 or newer.

```bash
cp .env.example .env        # fill in GROQ_API_KEY, DEPLOYER_PRIVATE_KEY (a testnet-only wallet)
cd backend && npm install && npm start
# open http://localhost:3001
```

Contract tests:

```bash
cd contracts && npm install && npx hardhat test
```

Frontend tests:

```bash
cd frontend && npm test
```

`USE_DYNAMO=true` switches storage from in-memory to DynamoDB and also saves reports to S3; it needs AWS credentials with access to the `RevenueGate*` tables.

## API

All routes are `POST` with a JSON body, under `/api`.

| Route | Purpose |
|---|---|
| `/api/quote` | Create a 15-minute quote for a report on an asset |
| `/api/payment` | Check a transfer on-chain, score the sender, record it in the gate |
| `/api/report` | Return the report for a paid request |
| `/api/launch` | Gate progress read from the contract, payment list, OpenFour token status |

## Built with

Solidity 0.8.24 and Hardhat; Node.js with ethers v6; Groq API (`openai/gpt-oss-120b`) for scoring and reports; AWS EC2, DynamoDB, S3 and CloudWatch.

## Licences

This project is MIT licensed (see `LICENSE`). Files under `contracts/contracts/openfour/interfaces`, `libraries` and `helpers` are copied unchanged from [four-meme-community/openfour-docs](https://github.com/four-meme-community/openfour-docs) and keep their MIT SPDX headers.
