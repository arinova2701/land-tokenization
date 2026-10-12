# NyayaChain — Status

**Last updated:** 2026-10-12
**Branch:** main

## Implemented

### Step 1 — Multi-signer quorum
- Roles: `ROLE_JUDGE` (1), `ROLE_CLERK` (2), `ROLE_REGISTRAR` (3). Stored in `JudicialKey.role`.
- `submitFreezeOrder` / `submitUnfreezeOrder` accept `bytes[] calldata signatures`.
- Quorum rule: exactly 1 JUDGE + 1 CLERK + 1 REGISTRAR. Minimum total: `quorumThreshold` (default 3, Sprint 0b).
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
- Bitmask is **13 bits wide** (bits 0–12): EXPIRY, REPLAY, RECOVER, NO_DUPE, REGISTRY, VALIDITY, JURISDICTION, QUORUM_JUDGE, QUORUM_CLERK, NONCE, PECUNIARY, FROZEN_STATE, QUORUM_REGISTRAR.
- `submitFreezeOrder` runs **12 checks** (bits 0–10, 12); `submitUnfreezeOrder` runs **13 checks** (bits 0–12, adding FROZEN_STATE at bit 11).
- `getOrderChecks(tokenId, orderHash, orderExpiry, nonce, signatures)` — view function; mirrors the freeze path (12 checks); returns bitmask of passing checks without reverting. Uses `ECDSA.tryRecover` to avoid reverts in view context.
- Events `OrderAccepted` and `OrderVacated` now emit `checksBitmask`, `signers[]`, and `roles[]`.
- `HistoryEntry` also stores `address[] signers` and `uint8[] roles` per order.
- `getFreezeHistorySigners(tokenId, index)` returns signers and roles for any history entry.
- Court portal calls `getOrderChecks` before submit (pre-validation).
- Court portal shows stored bitmask after success.
- Revert-reason → failing-step mapping in court portal is labelled as CLIENT-SIDE MAPPING.

### Sprint 0b — Three-signer quorum + signer history
- `quorumThreshold` default raised from 2 to 3: requires exactly 1 JUDGE + 1 CLERK + 1 REGISTRAR.
- `CHECK_QUORUM_COSIG` (bit 8) replaced by `CHECK_QUORUM_CLERK` (bit 8); `CHECK_QUORUM_REGISTRAR` added at bit 12.
- `HistoryEntry` records all signer addresses and roles per order.
- `OrderAccepted` / `OrderVacated` events emit the full signer array.
- `getFreezeHistorySigners(tokenId, index)` — new view function.
- `setQuorumThreshold` minimum raised to 3.

### Step 5 — Tests, benchmarks, docs
- `test/negative-corpus.js`: 30 test cases (20 original + 6 new + 1 demo happy path + 3 Sprint 0b cases).
- Sprint 0b new cases: 28 (missing CLERK), 29 (missing REGISTRAR), 30 (two JUDGEs, no CLERK).
- All 30 pass on Hardhat.
- Besu QBFT three-signer benchmark (100 tx) — run after Sprint 0b merge; results saved under `besu_three_signer` key.
- Prior Besu results retained under `besu_multi_signer` and `besu_single_signer_legacy` keys in `data/benchmark-results.json`.
- `docs/idf-b-alignment.md` added.
- `docs/interfaces.md` added (Sprint 0a).

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
