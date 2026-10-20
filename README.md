# A Judicially-Authenticated Freeze Protocol for Tokenized Land Records

**NyayaChain** is the prototype name.

A blockchain-based system for recording and verifying court-ordered property freeze orders, built on a permissioned Ethereum network with cryptographic signature verification.

---

## Problem Statement

Property fraud in India frequently exploits the gap between a court issuing a freeze order and that order being enforced at the land registry. Paper-based orders can be delayed, tampered with, or never reach the registry at all. There is no tamper-evident, publicly verifiable record of which properties are under judicial freeze at any given moment.

NyayaChain addresses this by recording freeze and unfreeze orders directly on-chain as they are issued, with cryptographic proof of the issuing judge's identity. Any party — bank, buyer, registrar — can verify the current freeze status of a property token in real time, without trusting any intermediary.

---

## What the System Does

When a court officer submits a freeze or unfreeze order, the smart contract runs **12 on-chain verification checks** (freeze) or **13** (unfreeze) before accepting it. The order quorum is one Judge, one Clerk and one Registrar. A separate **Registry Admin** manages signer registrations and limits, and cannot sign orders. `ParcelToken` is an **ERC-3643-compatible subset**.

| # | Check | Revert Reason on Failure |
|---|-------|--------------------------|
| 1 | Order has not expired (timestamp guard) | `Order has expired` |
| 2 | Order hash has not been submitted before (replay guard) | `Order already submitted` |
| 3 | ECDSA signature recovery from each signature | any revert (malformed sig) |
| 4 | No duplicate signers in the signature array | `Duplicate signer` |
| 5 | All recovered signers are active in `CourtKeyRegistry` | `Unregistered or revoked signer` |
| 6 | All signers' judicial keys are within their validity windows | `Judicial key expired or not yet valid` |
| 7 | Court's registered territory covers the property's territory (hierarchical) | `Court lacks territorial jurisdiction over this property` |
| 8 | At least one signer holds `ROLE_JUDGE` | `At least one JUDGE signature required` |
| 9 | At least one signer holds `ROLE_CLERK` | `At least one CLERK signature required` |
| 10 | Nonce matches the judge's expected sequential counter | `Invalid nonce` |
| 11 | Property's declared value is within the judge's court-level pecuniary limit | `Declared value exceeds court pecuniary limit` |
| 12† | Token is currently frozen (unfreeze orders only) | `Token is not frozen` |
| 13 | At least one signer holds `ROLE_REGISTRAR` | `At least one REGISTRAR signature required` |

† Check 12 applies to `submitUnfreezeOrder` only. The `checksBitmask` stored in every `HistoryEntry` is **13 bits wide** (bits 0–12); freeze uses 12 of those bits and unfreeze uses all 13. A set bit means the check passed at acceptance time. Check names and counts are defined in `public/checks.json`.

Only if all applicable checks pass is the freeze state updated and the order recorded in the immutable freeze history.

Public status, history and events are read directly from Besu. There is no indexer. An optional local, untrusted order mailbox helps signers exchange pending orders; it does not authorize or verify a freeze.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contract | Solidity 0.8.26 (EVM: Cancun), OpenZeppelin ECDSA |
| Local dev chain | Hardhat 2.x in-process node (Chain ID 31337) |
| Permissioned chain | Hyperledger Besu 4-node QBFT cluster (Chain ID 1337, ~2s block time) |
| Contract framework | Hardhat + `@nomicfoundation/hardhat-ethers` + `hardhat-chai-matchers` |
| Frontend | Vanilla HTML/CSS/JS, ethers.js 6.13.1, served via `http-server` |
| Testing | Chai/Mocha via Hardhat test runner, network-agnostic revert helper |

---

## Project Structure

```
land-tokenization/
├── contracts/
│   └── CourtKeyRegistry.sol       # Core smart contract
├── scripts/
│   ├── deploy.js                  # Deploy + seed to Hardhat localhost
│   ├── deploy-besu.js             # Deploy + seed to Besu
│   └── benchmark.js               # 100-tx latency benchmark (both networks)
├── test/
│   └── negative-corpus.js         # 43 test cases
├── docker/
│   ├── docker-compose.yml         # 4-node Besu QBFT cluster
│   ├── genesis.json               # Genesis with pre-funded Hardhat accounts
│   ├── generate-keys.js           # Node key generation utility
│   └── nodes/                     # node1–node4 key files
├── public/
│   ├── index.html                 # Public verification portal
│   ├── court.html                 # Court officer portal (submit freeze/unfreeze)
│   ├── registrar.html             # Registrar portal (register/revoke judges)
│   └── config.json                # Contract address + account addresses
├── data/
│   ├── benchmark-results.json     # Recorded latency measurements
│   ├── phase1-evidence-pack.xlsx  # Phase 1 evidence workbook
│   └── court-orders/              # Real court order source documents
├── hardhat.config.js
└── package.json
```

---

## Prerequisites

- Node.js ≥ 18
- npm
- Docker + Docker Compose (for Besu)

```bash
npm install
```

---

## Running on Hardhat (3 Terminal Tabs)

**Tab 1 — Start the local chain:**
```bash
npx hardhat node
```

**Tab 2 — Compile and deploy the contract:**
```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network localhost
```
This deploys `CourtKeyRegistry`, sets up territory hierarchy (Tamil Nadu → Vellore/Chennai; Andhra Pradesh → Kadapa), registers 3 property tokens, registers 2 judges, and writes `public/config.json`.

**Tab 3 — Serve the frontend:**
```bash
npm run serve
```
Open `http://localhost:3000` in your browser.

---

## Running on Besu (Docker)

**Step 1 — Start the 4-node QBFT cluster:**
```bash
docker compose -f docker/docker-compose.yml up -d
```
Node 1 exposes JSON-RPC on host port `8545`. Allow ~10 seconds for peer discovery and consensus to stabilise.

**Step 2 — Deploy the contract to Besu:**
```bash
npx hardhat run scripts/deploy-besu.js --network besu
```

**Step 3 — Serve the frontend (same as Hardhat):**
```bash
npm run serve
```

**Stop the cluster:**
```bash
docker compose -f docker/docker-compose.yml down -v
```

---

## Running Tests

**On Hardhat (fast — in-process, ~seconds):**
```bash
npx hardhat test test/negative-corpus.js
```

**On Besu (slow; cluster must be running):**
```bash
npx hardhat test test/negative-corpus.js --network besu
```

**Run the latency benchmark (100 transactions, both networks):**
```bash
npx hardhat run scripts/benchmark.js --network localhost   # Hardhat
npx hardhat run scripts/benchmark.js --network besu        # Besu
```
Results are written to `data/benchmark-results.json`.

---

## Demo Walkthrough

Use the current [10-minute demo script](docs/demo-script.md). The Judge creates and signs the order for Token 4, the Clerk and Registrar each import and sign it, and the completed order is submitted to Besu. The public citizen page, inspector, independent verifier, scenario console and explorer show the resulting evidence. `registrar.html` requires the separate Registry Admin account for write actions.

## Negative Corpus — 43 Test Cases

`test/negative-corpus.js` covers authorization, signature validity, jurisdiction, replay, nonces, order-field binding, the three-role quorum and Registry Admin handover. Run `npx hardhat test` to execute all 43 cases. Cases 38–43 cover Registry Admin permissions and separation of duties.

---

## Demo Setup

This sequence prepares a fresh Besu chain for a live demo. Run each step in order and confirm `demo-check.js` is fully green before presenting.

**Step 1 — Start the 4-node Besu network and confirm blocks are being produced:**
```bash
docker compose -f docker/docker-compose.yml up -d
# Wait ~10s, then verify:
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
# Result should show a non-zero block number and increase on repeated calls.
```

> **Besu RPC flags required for the public page:** node1 is started with `--rpc-http-cors-origins="all"` and `--host-allowlist="*"` (see `docker/docker-compose.yml`). These flags allow `index.html` to call the RPC directly without a proxy.

**Step 2 — Create funded demo wallets:**
```bash
export FUNDER_KEY=<pre-funded-account-private-key>   # from genesis.json alloc
export RPC_URL=http://127.0.0.1:8545
node scripts/setup-demo-wallets.js
# Creates demo-wallets.json with separate admin, registrar, judge, clerk and citizen wallets.
# If the first four already exist, only the admin wallet is added; do not use --force.
# demo-wallets.json is git-ignored — never commit it.
```

**Step 3 — Deploy the contracts:**
```bash
npx hardhat run scripts/deploy-besu.js --network besu
# Writes public/config.json with contract addresses.
```

**Step 4 — Seed the demo data:**
```bash
node scripts/seed-demo.js
# Registers judge, clerk and registrar signers, sets pecuniary limits,
# creates three demo parcels (Tokens 4, 5, 6), then hands Registry Admin
# rights from the deployer to the separate demo admin wallet.
```

**Step 5 — Run the preflight check:**
```bash
node scripts/demo-check.js
# Expect 18 PASS and 0 FAIL before continuing.
```

**Step 6 — Set up MetaMask:**
1. Install MetaMask in Chrome.
2. Add the Besu network: Settings → Networks → Add network manually.
   - Network name: NyayaChain Besu QBFT
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `1337`
   - Currency symbol: ETH
3. Import four browser accounts from `demo-wallets.json`: **Admin**, **Judge**, **Clerk**, **Registrar**. The Citizen page needs no wallet.
4. Use one Chrome profile per account. Admin manages the registry in `registrar.html`; Judge, Clerk and Registrar sign orders in `court.html`. Admin never signs orders.

**Step 7 — Serve the frontend:**
```bash
npm run serve
# Open http://localhost:3000
```

**Step 8 — Demo cycle (success path):**
1. Open `court.html` in the Judge's Chrome profile.
2. Connect Wallet → select the Judge account → confirm role shows JUDGE.
3. Select Token 4 (Parcel A — Vellore success case), enter a case number, click **Review order**, then **Sign with wallet**.
4. Click **Export Order** and copy the JSON.
5. Open `court.html` in the Clerk's Chrome profile.
6. Connect Wallet → confirm role shows CLERK.
7. Click **Import Order**, paste the JSON, co-sign.
8. Export the updated order, import it in the Registrar profile, and co-sign.
9. Export the three-signature order and import it in the Judge profile. Click **Submit to chain** after the pre-flight checks pass.
10. Open `index.html` (no wallet needed) → Token 4 shows FROZEN and the three signers appear in history. Repeat the three-signature flow for Unfreeze if time permits.

**Step 9 — Demo failure cases:**
- **Parcel B (Token 5):** Select Parcel B in the judge's profile. Sign and go through the multi-signer flow. On submit, check 11 (Pecuniary limit) will FAIL — ₹2Cr exceeds the District Court ₹1Cr limit.
- **Parcel C (Token 6):** Select Parcel C. The pre-check will show territorial jurisdiction (check 7) as FAIL — the Vellore judge has no authority over Kadapa property.
- **Missing co-signer:** Build an order (judge profile only) and submit with a single signature. The submit button stays disabled — the UI prevents submitting below quorum.

### Troubleshooting

- **After a chain reset**, clear each account's activity data in MetaMask: Settings → Advanced → Clear activity tab data. Otherwise MetaMask will use stale nonces that don't match the fresh chain.
- **After a chain reset**, retain the existing demo wallets, redeploy, and run `seed-demo.js` again. Fund the wallets again if the chain volume was wiped.
- **Wrong network error in MetaMask**: Check that the Chain ID in `public/wallet.js` matches `docker/genesis.json` (both should be `1337`).
- **Demo keys are for the demo only.** Never use them on a wallet holding real funds.

---

## Benchmark Results

The recorded 100-order Besu QBFT **three-signer** freeze benchmark is saved under `besu_three_signer` in `data/benchmark-results.json`. Each order uses a Judge, Clerk and Registrar signature.

| Metric | Besu QBFT, 100 three-signer orders |
| --- | ---: |
| Average | 1,994 ms |
| Median | 2,051 ms |
| p95 | 2,076 ms |
| p99 | 2,110 ms |
| Minimum | 1,535 ms |
| Maximum | 2,579 ms |

Older single-signer and two-signer results remain in the data file for historical comparison; they do not describe the current order quorum.

---

## Real Court Order Data Sources

Two fully verified real Indian court orders are included in `data/court-orders/` as the design basis for the order payload schema and demo dataset.

| File | Case | Court | Year | Use in Project |
|------|------|-------|------|---------------|
| `order_01_kamalesh_2025.txt` | Kamalesh Chandrasekaran v M.A. Noor Jehan Beevi | Madras High Court / Chennai City Civil Court | 2025 | Demonstrates 3-tier court hierarchy (trial → appellate → HC revision); injunction denied at all 3 levels; basis for Tamil Nadu territory structure |
| `order_02_kadapa_2024.txt` | CRP 578 of 2024 | Andhra Pradesh High Court, Kadapa District | 2024 | Cross-jurisdiction negative test case; validly authenticated order from outside Tamil Nadu is rejected on jurisdiction grounds (not signature grounds) |
| `Kamalesh_Chandrasekaran_v__MA_Noor_Jehan_Beevi.pdf` | Same as above | Madras High Court | 2025 | Source PDF |
| `crp-578-of-2024-1-540611.pdf` | Same as above | AP High Court | 2024 | Source PDF |

Documents sourced from eCourts and official court portals. Case numbers, court hierarchies, and property survey descriptions from these orders informed the contract's input schema (`caseNumber`, `courtName`, `courtLevel`, `territoryCode`, `validFrom`, `validUntil`).

---

## Team

The proposed contribution summary is being checked by each teammate before inclusion in the report. The current work areas are protocol and contract (Maneesh), workflow and access (Niharika), and transparency and verification (Vijay).

**Project Guide:** Dr. Antony Seba P.

---

## Contract Overview

`CourtKeyRegistry.sol` — single self-contained contract, no upgradeable proxy.

**Key storage:**
- `registry(address)` — judicial key record per judge (court name, level, territory, validity window, active flag)
- `judgeNonce(address)` — per-judge sequential counter (anti-replay)
- `frozen(tokenId)` — current freeze state of each property token
- `frozenBy(tokenId)` — case number of the active freeze order
- `usedOrders(bytes32)` — secondary replay guard mapping order hash → used
- `propertyTerritory(tokenId)` — territory code for each registered property
- `parentTerritory(bytes32)` — territory hierarchy (district → state)
- `freezeHistory(tokenId)` — immutable append-only log of all freeze/unfreeze actions

**Events:** `JudgeRegistered`, `OrderAccepted`, `OrderVacated`, `PropertyRegistered`
