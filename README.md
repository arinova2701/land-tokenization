# NyayaChain — Judicially Authenticated Property Freeze Protocol

A blockchain-based system for recording and verifying court-ordered property freeze orders, built on a permissioned Ethereum network with cryptographic signature verification.

---

## Problem Statement

Property fraud in India frequently exploits the gap between a court issuing a freeze order and that order being enforced at the land registry. Paper-based orders can be delayed, tampered with, or never reach the registry at all. There is no tamper-evident, publicly verifiable record of which properties are under judicial freeze at any given moment.

NyayaChain addresses this by recording freeze and unfreeze orders directly on-chain as they are issued, with cryptographic proof of the issuing judge's identity. Any party — bank, buyer, registrar — can verify the current freeze status of a property token in real time, without trusting any intermediary.

---

## What the System Does

When a court officer submits a freeze or unfreeze order, the smart contract runs **11 sequential on-chain verification checks** (freeze) or **12** (unfreeze) before accepting it:

| # | Check | Revert Reason on Failure |
|---|-------|--------------------------|
| 1 | Order has not expired (timestamp guard) | `Order has expired` |
| 2 | Order hash has not been submitted before (replay guard) | `Order already submitted` |
| 3 | ECDSA signature recovery from each signature | any revert (malformed sig) |
| 4 | No duplicate signers in the signature array | `Duplicate signer` |
| 5 | All recovered signers are active in `CourtKeyRegistry` | `Unregistered or revoked signer` |
| 6 | All signers' judicial keys are within their validity windows | `Judicial key expired or not yet valid` |
| 7 | Court's registered territory covers the property's territory (hierarchical) | `Court lacks territorial jurisdiction over this property` |
| 8 | At least one signer holds `ROLE_JUDGE` | `No judge among signers` |
| 9 | At least one signer holds `ROLE_CLERK` or `ROLE_REGISTRAR` | `No clerk or registrar co-signer` |
| 10 | Nonce matches the judge's expected sequential counter | `Invalid nonce` |
| 11 | Property's declared value is within the judge's court-level pecuniary limit | `Declared value exceeds court pecuniary limit` |
| 12† | Token is currently frozen (unfreeze orders only) | `Token is not frozen` |

† Check 12 applies to `submitUnfreezeOrder` only. The `checksBitmask` stored in every `HistoryEntry` is **12 bits wide** (bits 0–11), mapping one bit to each check. A set bit means the check passed at acceptance time.

Only if all applicable checks pass is the freeze state updated and the order recorded in the immutable freeze history.

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
│   └── negative-corpus.js         # 43 test cases (42 rejection paths + 1 happy path)
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

- Node.js v22
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

**On Besu (slow — 2s block time × ~10 tx/setup × 43 tests ≈ 24 min; cluster must be running):**
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

### Portal 1 — Public Verification (`/index.html`)

1. Open `http://localhost:3000`. The nav bar shows **Connected** once the chain is reachable.
2. Enter a property token ID (1, 2, or 3) in the **Verify a Property** section.
3. Click **Check Status**. The page displays the current freeze state, territory, active case number (if frozen), and the full freeze/unfreeze history for that token.

### Portal 2 — Court Officer Portal (`/court.html`)

1. Open `http://localhost:3000/court.html`.
2. **Select Court Officer** — choose the Vellore judge or the Kadapa judge from the dropdown. Registry status and current nonce are auto-populated.
3. **Select a property token** — territory and current freeze status are shown inline.
4. Fill in a **Case Number** (e.g. `I.A.No.2 of 2024 in O.S.No.5111 of 2024`) and an expiry window.
5. Click **Sign & Submit Freeze**. The page walks through all 11 steps in real time, showing pass/fail for each check.
6. To unfreeze, click **Sign & Submit Unfreeze** — nonce auto-increments.
7. **Demonstrate a rejection:** select the Vellore judge and Token 3 (Kadapa) and attempt a freeze — it will fail at check 9 (territorial jurisdiction).

### Portal 3 — Registrar Portal (`/registrar.html`)

1. Open `http://localhost:3000/registrar.html`.
2. Sign in with the separate **Registry Admin** wallet. The header shows that role; a Registrar signer has a read-only view.
3. **Register a new judge** — paste a wallet address, enter court name, select court level and territory, set validity window (unix timestamps; use `0` and `9999999999` for always-valid), then click **Register Judge**.
4. **Revoke a judge** — paste the judge's address into the address field and click **Revoke Judge**. Their next freeze attempt will fail at check 4.
5. The **Registered Judges** section lists all known judges with active/revoked status and current nonce.

---

## Negative Corpus — 27 Test Cases

| Case | Scenario | Action | Expected Outcome |
|------|----------|--------|-----------------|
| 1 | Unregistered signer submits freeze | Freeze | Rejected — `Unregistered or revoked signer` |
| 2 | Revoked signer submits freeze | Freeze | Rejected — `Unregistered or revoked signer` |
| 3 | Judicial key past `validUntil` | Freeze | Rejected — `Judicial key expired or not yet valid` |
| 4 | Judicial key before `validFrom` | Freeze | Rejected — `Judicial key expired or not yet valid` |
| 5 | Order timestamp already expired | Freeze | Rejected — `Order has expired` |
| 6 | Exact same order submitted twice | Freeze | Second rejected — `Order already submitted` |
| 7 | Nonce skipped (submitted nonce=5, expected 0) | Freeze | Rejected — `Invalid nonce` |
| 8 | Nonce repeated (nonce=0 after nonce=0 already used) | Freeze | Rejected — `Invalid nonce` |
| 9 | Vellore judge attempts to freeze Kadapa property (Token 3) | Freeze | Rejected — `Court lacks territorial jurisdiction over this property` |
| 10 | Kadapa judge attempts to freeze Vellore property (Token 1) | Freeze | Rejected — `Court lacks territorial jurisdiction over this property` |
| 11 | Valid signature but order hash tampered (different token ID) | Freeze | Rejected — `Unregistered or revoked signer` (ECDSA recovers wrong address) |
| 12 | Empty signature (`0x`) | Freeze | Reverts — OpenZeppelin ECDSA rejects |
| 13 | Malformed signature (63 bytes instead of 65) | Freeze | Reverts — invalid signature length |
| 14 | Signature with r=0, s=0 (recovers to zero address) | Freeze | Reverts — zero address not in registry |
| 15 | Freeze an already-frozen token | Freeze | **Accepted** — dual-court freeze is permitted; both orders recorded in history |
| 16 | Unfreeze a token that is not frozen | Unfreeze | Rejected — `Token is not frozen` |
| 17 | Kadapa judge attempts to unfreeze Vellore property | Unfreeze | Rejected — `Court lacks territorial jurisdiction over this property` |
| 18 | Revoked signer attempts to unfreeze | Unfreeze | Rejected — `Unregistered or revoked signer` |
| 19 | Replay of a previously accepted unfreeze order | Unfreeze | Rejected — `Order already submitted` |
| 20 | Wrong nonce on unfreeze (nonce=99, expected=1) | Unfreeze | Rejected — `Invalid nonce` |
| 21 | Only judge signature — no co-signer (CLERK/REGISTRAR) | Freeze | Rejected — `No clerk or registrar co-signer` |
| 22 | Same address appears twice in signature array | Freeze | Rejected — `Duplicate signer` |
| 23 | Two REGISTRAR signatures but no JUDGE | Freeze | Rejected — `No judge among signers` |
| 24 | Empty signatures array | Freeze | Rejected — `Below quorum threshold` |
| 25 | Property declared value exceeds judge's court-level pecuniary limit | Freeze | Rejected — `Declared value exceeds court pecuniary limit` |
| 26 | Non-agent account calls `ParcelToken.setAddressFrozen` directly | Direct call | Rejected — `Only the agent can call this` |
| 27 | Full freeze + unfreeze lifecycle with fresh random wallets (demo path) | Freeze then Unfreeze | **Both accepted** — validates the demo export/import flow end to end |

> **Note on Case 15:** The contract intentionally allows multiple authenticated freeze orders on the same token. Different creditor courts may independently freeze the same property. Each order is appended to `freezeHistory`; `frozenBy` is updated to the latest case number.

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
# Every line must show PASS before continuing.
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
3. Select Token 4 (Parcel A — Vellore success case), enter a case number, click **Sign Order**.
4. Click **Export Order** and copy the JSON.
5. Open `court.html` in the Clerk's Chrome profile.
6. Connect Wallet → confirm role shows CLERK.
7. Click **Import Order**, paste the JSON, co-sign.
8. Click **Submit** — both signatures meet the quorum threshold.
9. Open `index.html` (no wallet needed) → Token 4 shows FROZEN.
10. Repeat steps 2–8 for Unfreeze to complete the lifecycle.

**Step 9 — Demo failure cases:**
- **Parcel B (Token 5):** Select Parcel B in the judge's profile. Sign and go through the multi-signer flow. On submit, check 11 (Pecuniary limit) will FAIL — ₹2Cr exceeds the District Court ₹1Cr limit.
- **Parcel C (Token 6):** Select Parcel C. The pre-check will show territorial jurisdiction (check 7) as FAIL — the Vellore judge has no authority over Kadapa property.
- **Missing co-signer:** Build an order (judge profile only) and submit with a single signature. The submit button stays disabled — the UI prevents submitting below quorum.

### Troubleshooting

- **After a chain reset**, clear each account's activity data in MetaMask: Settings → Advanced → Clear activity tab data. Otherwise MetaMask will use stale nonces that don't match the fresh chain.
- **After a chain reset**, run `setup-demo-wallets.js --force` and `seed-demo.js` again. Balances and registrations are gone after a volume wipe.
- **Wrong network error in MetaMask**: Check that the Chain ID in `public/wallet.js` matches `docker/genesis.json` (both should be `1337`).
- **Demo keys are for the demo only.** Never use them on a wallet holding real funds.

---

## Benchmark Results

100 consecutive freeze transactions on each network. Recorded in `data/benchmark-results.json` under keys `localhost` and `besu_three_signer`.

| Metric | Hardhat localhost (Chain ID 31337) | Besu QBFT three-signer (Chain ID 1337) |
|--------|-----------------------------------|-----------------------------------------|
| Min latency | 1 ms | 1,535 ms |
| Max latency | 6 ms | 2,579 ms |
| Average | 2 ms | 1,994 ms |
| Median (p50) | 2 ms | 2,051 ms |
| p95 | 3 ms | 2,076 ms |
| p99 | 3 ms | 2,110 ms |
| Transactions | 100 | 100 |

All Besu results use three-signer orders (JUDGE + CLERK + REGISTRAR), matching the production quorum requirement. Legacy single-signer and two-signer Besu results are retained in `data/benchmark-results.json` under `besu_single_signer_legacy` and `besu_multi_signer` for comparison.

Hardhat's in-process node mines instantly, giving sub-10ms round-trips. Besu QBFT operates with a ~2s block time by consensus protocol design, placing all latencies in the 1.5–2.1s range. The tight p95/p99 spread on Besu (3ms) indicates consistent block production with no outlier blocks during the test run.

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

## Security Note — Test Keys Only

All private keys present in this repository (Hardhat default accounts in `hardhat.config.js`, Besu validator node keys in `docker/nodes/`, and any keys shown in documentation) are **test-only keys for a local development chain with no monetary value**. They are publicly known and must never be used on any public network or wallet holding real funds. The runtime demo wallets (`demo-wallets.json`) are git-ignored and must be generated fresh for each demo run.

---

## How to Cite

If you use this software or build on it, please cite:

> Maneesh Ari, Niharika Lathish, Vijay V S, and Antony Seba P. "NyayaChain: A Judicially-Authenticated Freeze Protocol for Tokenized Land Records." 2026. DOI: [10.5281/zenodo.XXXXXXX](https://doi.org/10.5281/zenodo.XXXXXXX)

A `CITATION.cff` file is included in the root of this repository for automated citation tools (Zenodo, GitHub's Cite This Repository button, Zotero, etc.). Replace `10.5281/zenodo.XXXXXXX` with the actual DOI once the Zenodo record is published.

---

## Team

| Name | Role |
|------|------|
| **Maneesh Ari** | Smart contract architecture, deployment scripting, frontend development, system integration |
| **Niharika Lathish** | Court hierarchy mapping, jurisdiction policy design, legal domain research |
| **Vijay V S** | Testing, negative corpus design, Besu deployment and benchmarking |

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
