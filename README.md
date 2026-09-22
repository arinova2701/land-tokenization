# NyayaChain — Judicially Authenticated Property Freeze Protocol

A blockchain-based system for recording and verifying court-ordered property freeze orders, built on a permissioned Ethereum network with cryptographic signature verification.

---

## Problem Statement

Property fraud in India frequently exploits the gap between a court issuing a freeze order and that order being enforced at the land registry. Paper-based orders can be delayed, tampered with, or never reach the registry at all. There is no tamper-evident, publicly verifiable record of which properties are under judicial freeze at any given moment.

NyayaChain addresses this by recording freeze and unfreeze orders directly on-chain as they are issued, with cryptographic proof of the issuing judge's identity. Any party — bank, buyer, registrar — can verify the current freeze status of a property token in real time, without trusting any intermediary.

---

## What the System Does

When a court officer submits a freeze or unfreeze order, the smart contract runs **7 sequential on-chain verification checks** before accepting it:

| # | Check | Revert Reason on Failure |
|---|-------|--------------------------|
| 1 | Order has not expired (timestamp guard) | `Order has expired` |
| 2 | Order hash has not been submitted before (replay guard) | `Order already submitted` |
| 3 | ECDSA signature recovery from the order hash | any revert (malformed sig) |
| 4 | Recovered signer is active in `CourtKeyRegistry` | `Unregistered or revoked signer` |
| 5 | Judicial key is within its validity window (`validFrom` ≤ now ≤ `validUntil`) | `Judicial key expired or not yet valid` |
| 6 | Court's registered territory covers the property's territory (hierarchical) | `Court lacks territorial jurisdiction over this property` |
| 7 | Nonce matches the judge's expected sequential counter | `Invalid nonce` |

Only if all 7 checks pass is the freeze state updated and the order recorded in the immutable freeze history.

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
│   └── negative-corpus.js         # 20 rejection-path test cases
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

**On Besu (slow — 2s block time × ~10 tx/setup × 20 tests ≈ 10 min; cluster must be running):**
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
2. The admin account address is shown at the top.
3. **Register a new judge** — paste a wallet address, enter court name, select court level and territory, set validity window (unix timestamps; use `0` and `9999999999` for always-valid), then click **Register Judge**.
4. **Revoke a judge** — paste the judge's address into the address field and click **Revoke Judge**. Their next freeze attempt will fail at check 4.
5. The **Registered Judges** section lists all known judges with active/revoked status and current nonce.

---

## Negative Corpus — 20 Test Cases

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

> **Note on Case 15:** The contract intentionally allows multiple authenticated freeze orders on the same token. Different creditor courts may independently freeze the same property. Each order is appended to `freezeHistory`; `frozenBy` is updated to the latest case number.

---

## Benchmark Results

100 consecutive freeze transactions on each network. Recorded in `data/benchmark-results.json`.

| Metric | Hardhat localhost (Chain ID 31337) | Hyperledger Besu QBFT (Chain ID 1337) |
|--------|-----------------------------------|---------------------------------------|
| Min latency | 1 ms | 1,516 ms |
| Max latency | 6 ms | 2,061 ms |
| Average | 2 ms | 1,997 ms |
| Median (p50) | 2 ms | 2,030 ms |
| p95 | 3 ms | 2,046 ms |
| p99 | 4 ms | 2,048 ms |
| Transactions | 100 | 100 |

Hardhat's in-process node mines instantly, giving sub-10ms round-trips. Besu QBFT operates with a ~2s block time by consensus protocol design, placing all latencies in the 1.5–2.1s range. The tight p95/p99 spread on Besu (16ms) indicates consistent block production with no outlier blocks during the test run.

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

| Name | Role |
|------|------|
| **Maneesh Arinova** | Smart contract architecture, backend scripting, frontend development, system integration |
| **Niharika** | Court hierarchy mapping, jurisdiction policy design, legal domain research |
| **Vijay** | Testing, negative corpus design, Besu deployment and benchmarking |

**Project Guide:** Dr. Anthony Seba P.

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
