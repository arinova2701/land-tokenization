# NyayaChain — Status

**Last updated:** 2026-10-12
**Branch:** main

## Implemented

### Step 1 — Multi-signer quorum
- Roles: `ROLE_JUDGE` (1), `ROLE_CLERK` (2), `ROLE_REGISTRAR` (3). Stored in `JudicialKey.role`.
- `submitFreezeOrder` / `submitUnfreezeOrder` accept `bytes[] calldata signatures`.
- Quorum rule: ≥ 1 JUDGE + ≥ 1 CLERK/REGISTRAR. Minimum total: `quorumThreshold` (default 2).
- `ROLE_REGISTRAR` is exempt from territorial jurisdiction (national authority).
- Checks: duplicate signers, unregistered signers, expired keys, wrong roles — all enforced per-signer in a loop.
- Per-judge sequential nonce and `usedOrders` replay protection unchanged.

### Step 2 — Pecuniary jurisdiction
- `parcelDeclaredValue[tokenId]` — set by registrar at registration or via `setParcelDeclaredValue`.
- `courtLevelMaxValue[level]` — seeded: Munsif ₹3L, Sub ₹25L, District ₹1Cr, HC unlimited.
- On-chain check in `submitFreezeOrder` / `submitUnfreezeOrder`:
  `parcelDeclaredValue[tokenId] <= courtLevelMaxValue[registry[judgeAddress].courtLevel]`
- Registrar portal: "Pecuniary Jurisdiction" card to set `maxValue` per level and `declaredValue` per parcel.

### Step 3 — ERC-3643-compatible subset token
- `contracts/ParcelToken.sol` — implements the ERC-3643 freeze surface:
  `agent` role, `setAddressFrozen`, `freezePartialTokens`, `unfreezePartialTokens`, `isFrozen`, `canTransfer`.
- `CourtKeyRegistry` is the token's agent. The freeze path calls `parcelToken.setAddressFrozen(...)`.
- `frozen(tokenId)` is a view function that reads through to `parcelToken.isFrozen(_propertyAddress(tokenId))`.
- `_propertyAddress(tokenId)` derives a canonical identity address per tokenId via keccak256.
- Labelled "ERC-3643-compatible subset" in code, docs, and paper. T-REX package not used (full identity registry out of scope).

### Step 4 — On-chain verification record
- `HistoryEntry` has a new `checksBitmask uint256` field.
- Bitmask is **12 bits wide** (bits 0–11): EXPIRY, REPLAY, RECOVER, NO_DUPE, REGISTRY, VALIDITY, JURISDICTION, QUORUM_JUDGE, QUORUM_COSIG, NONCE, PECUNIARY, FROZEN_STATE.
- `submitFreezeOrder` runs **11 checks** (bits 0–10); `submitUnfreezeOrder` runs **12 checks** (bits 0–11, adding FROZEN_STATE).
- `getOrderChecks(tokenId, orderHash, orderExpiry, nonce, signatures)` — view function; mirrors the freeze path (11 checks); returns bitmask of passing checks without reverting. Uses `ECDSA.tryRecover` to avoid reverts in view context.
- Events `OrderAccepted` and `OrderVacated` now emit `checksBitmask`.
- Court portal calls `getOrderChecks` before submit (pre-validation, step 5).
- Court portal shows stored bitmask after success.
- Revert-reason → failing-step mapping in court portal is labelled as CLIENT-SIDE MAPPING.

### Step 5 — Tests, benchmarks, docs
- `test/negative-corpus.js`: 27 test cases (20 original + 6 new + 1 demo-path happy path).
- New cases: 21 (missing co-signer), 22 (duplicate signer), 23 (wrong role), 24 (empty signatures), 25 (pecuniary limit exceeded), 26 (non-agent ParcelToken call), 27 (multi-signer full freeze/unfreeze lifecycle with demo-style random wallets).
- All 27 pass on Hardhat. All 27 pass on Besu QBFT.
- Benchmark re-run on Hardhat localhost: avg 2ms, p95 3ms, p99 3ms (100 multi-signer tx).
- Besu QBFT multi-signer benchmark (100 tx): min 1528ms, avg 1999ms, median 2039ms, p95 2051ms, p99 2054ms, max 2056ms.
- Prior single-signer Besu results retained under `besu_single_signer_legacy` key in `data/benchmark-results.json`.
- `docs/idf-b-alignment.md` added.

## Design notes

**ROLE_REGISTRAR territorial exemption.** The registrar role represents a national land authority whose mandate is not geographically bounded. Requiring a registrar to satisfy the same territorial check as a district court judge would prevent the national authority from co-signing orders on any property outside a single district. The exemption is therefore a deliberate design choice: the registrar's authority is verified through registration (the admin must explicitly grant ROLE_REGISTRAR) and key validity, not territory.

**Court level value limits are configurable demo values, not statutory figures.** The seeded limits (Munsif ₹3L, Sub Court ₹25L, District Court ₹1Cr, High Court unlimited) are illustrative figures for the demo. They approximate the rough ordering of Indian civil court pecuniary jurisdictions but are not a faithful reproduction of any specific statutory schedule. The `setCourtLevelMaxValue` function allows the admin to update them to reflect current rules without redeploying.

## Not implemented / out of scope
- Full T-REX identity registry: out of scope; `ParcelToken` implements the freeze surface only.
- No off-chain backend or indexer exists in this repo. All state is queried directly from the chain via ethers.js.

## Networks
| Network         | Chain ID | Block time | Status        |
|-----------------|----------|------------|---------------|
| Hardhat (in-process) | 31337 | instant | 27/27 tests pass |
| Hardhat localhost    | 31337 | instant | Deploy + benchmark verified |
| Besu QBFT (docker)   | 1337  | ~2s     | Deployed; 27/27 tests pass; multi-signer benchmark run |
