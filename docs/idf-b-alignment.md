# IDF-B Alignment

This document lists each IDF-B claim and the code that backs it.
Claims are stated only where the implementation actually delivers them.

---

## Claim 1: Court orders are authenticated by cryptographic signature

**Evidence:**
- `contracts/CourtKeyRegistry.sol`, `_validateSignatures()` (line ~150): recovers each signer via `ECDSA.recover(orderHash.toEthSignedMessageHash(), sig)`.
- All signers must be in the active registry with a valid key window.
- Supported by test cases 1–4, 11–14 in `test/negative-corpus.js`.

---

## Claim 2: Replay attacks are prevented

**Evidence:**
- `usedOrders[orderHash]` — secondary replay guard. `CourtKeyRegistry.sol`, `submitFreezeOrder` check 2.
- `judgeNonce[judgeAddress]` — primary sequential nonce prevents ordering attacks. Check 10 (NONCE bit).
- Supported by test cases 6, 7, 8, 19, 20.

---

## Claim 3: Territorial jurisdiction is enforced on-chain

**Evidence:**
- `_checkJurisdiction(signer, tokenId)` in `CourtKeyRegistry.sol`: verifies `registry[signer].territoryCode == propertyTerritory[tokenId]` or its parent.
- `ROLE_REGISTRAR` is explicitly exempted (national authority).
- Supported by test cases 9, 10, 17.

---

## Claim 4: Multi-court quorum is required (Step 1)

**Evidence:**
- `submitFreezeOrder` accepts `bytes[] calldata signatures`. At least `quorumThreshold` (default 2) signatures required.
- At least 1 must be `ROLE_JUDGE`; at least 1 must be `ROLE_CLERK` or `ROLE_REGISTRAR`.
- Duplicate signers rejected.
- Supported by test cases 21–24.

---

## Claim 5: Pecuniary jurisdiction limits are enforced (Step 2)

**Evidence:**
- `parcelDeclaredValue[tokenId]` stored per property.
- `courtLevelMaxValue[courtLevel]` seeded at construction: Munsif ₹3L, Sub Court ₹25L, District Court ₹1Cr, High Court unlimited.
- Check in both `submitFreezeOrder` and `submitUnfreezeOrder`: `parcelDeclaredValue[tokenId] <= courtLevelMaxValue[registry[judgeAddress].courtLevel]`.
- Supported by test case 25.

---

## Claim 6: Freeze operations delegate to an ERC-3643-compatible token (Step 3)

**Evidence:**
- `contracts/ParcelToken.sol` — implements `setAddressFrozen`, `freezePartialTokens`, `unfreezePartialTokens`, `isFrozen`, `canTransfer`.
- Labelled "ERC-3643-compatible subset" throughout.
- `CourtKeyRegistry` is the token's agent; `setAgent` is called in deploy scripts.
- `CourtKeyRegistry.frozen(tokenId)` reads through to `parcelToken.isFrozen(_propertyAddress(tokenId))`.
- Test case 26 verifies non-agent cannot call `setAddressFrozen`.
- Full T-REX identity registry is **not** implemented; this is a freeze-surface subset only.

---

## Claim 7: Every accepted order carries a tamper-evident verification record (Step 4)

**Evidence:**
- `HistoryEntry.checksBitmask uint256` stored on-chain for every accepted order.
- `OrderAccepted` and `OrderVacated` events emit `checksBitmask`.
- `getOrderChecks(...)` view function returns a bitmask of passing checks before submission.
- Bitmask bits 0–11 correspond to: EXPIRY, REPLAY, RECOVER, NO_DUPE, REGISTRY, VALIDITY, JURISDICTION, QUORUM_JUDGE, QUORUM_COSIG, NONCE, PECUNIARY, FROZEN_STATE.
- `getFreezeHistoryEntry` returns the stored bitmask alongside other fields.

---

## Claim 8: The system runs on a permissioned EVM network (Hyperledger Besu QBFT)

**Evidence:**
- `docker/docker-compose.yml` — 4-node Besu QBFT cluster.
- `docker/genesis.json` — pre-funded accounts, chain ID 1337.
- `scripts/deploy-besu.js` — deploys both `ParcelToken` and `CourtKeyRegistry` to Besu.
- `hardhat.config.js` — `besu` network target with `chainId: 1337` and `HARDHAT_KEYS`.
- Prior benchmark run recorded in `data/benchmark-results.json` shows Besu QBFT ~2s block time (p50 ≈ 2030 ms).

---

## What this implementation does NOT claim

- Full ERC-3643 / T-REX compliance (only the freeze surface is implemented).
- A production-ready identity registry.
- An off-chain indexer or REST API (all state is queried on-chain).
- Formal proof of finality (Besu QBFT provides BFT finality under the standard 2f+1 assumption).
