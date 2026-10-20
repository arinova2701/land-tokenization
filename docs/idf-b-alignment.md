# IDF-B Alignment

This document lists each IDF-B claim and the code that backs it.
Claims are stated only where the implementation actually delivers them.

The current prototype requires a **three-signer quorum** (Judge, Clerk, Registrar), with a separate **Registry Admin**. It records **12 freeze checks** or **13 unfreeze checks** in a **13-bit bitmask**; the test corpus contains **43 cases**. `ParcelToken` is an **ERC-3643-compatible subset**.

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

## Claim 4: Three-role quorum is required (Step 1)

**Evidence:**
- `submitFreezeOrder` accepts `bytes[] calldata signatures`. At least `quorumThreshold` (default 3) signatures are required.
- Every accepted order has a JUDGE, a CLERK, and a REGISTRAR. The Registry Admin is not an order signer.
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

## Claim 6: Freeze operations delegate to an ERC-3643-compatible subset (Step 3)

**Evidence:**
- `contracts/ParcelToken.sol` — implements `setAddressFrozen`, `freezePartialTokens`, `unfreezePartialTokens`, `isFrozen`, `canTransfer`.
- Labelled "ERC-3643-compatible subset" throughout.
- `CourtKeyRegistry` is the token's agent; `setAgent` is called in deploy scripts.
- `CourtKeyRegistry.frozen(tokenId)` reads through to `parcelToken.isFrozen(_propertyAddress(tokenId))`.
- Test case 26 verifies non-agent cannot call `setAddressFrozen`.
- Full T-REX identity registry is **not** implemented; `ParcelToken` is an **ERC-3643-compatible subset** that implements the freeze surface only.

---

## Claim 7: Every accepted order carries a tamper-evident verification record (Step 4)

**Evidence:**
- `HistoryEntry.checksBitmask uint256` stored on-chain for every accepted order.
- `OrderAccepted` and `OrderVacated` events emit `checksBitmask`.
- `getOrderChecks(...)` returns a bitmask of passing checks before submission for the selected freeze or unfreeze action.
- The bitmask is 13 bits wide (bits 0–12), including separate CLERK and REGISTRAR quorum bits.
- `submitFreezeOrder` records 12 checks; `submitUnfreezeOrder` records 13 checks, including FROZEN_STATE.
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

## Claim 9: Registry administration is separated from order signing

**Evidence:**
- `CourtKeyRegistry.admin` controls signer registration, revocation, territory and value settings; `isAdmin(address)` exposes current authority.
- `proposeAdmin` and `acceptAdmin` require two distinct steps and emit `AdminTransferred` on completion.
- The contract prevents any current or pending admin from being registered as a signer, and prevents a registered signer from being proposed as admin.
- The demo transfers admin rights from the deployer to a separate funded wallet. Admin permissions do not count toward the Judge, Clerk, Registrar order quorum.
- Test cases 38–43 cover unauthorized writes, role separation, handover and loss of the old admin's rights.

---

## What this implementation does NOT claim

- Full ERC-3643 / T-REX compliance (only the freeze surface is implemented).
- A production-ready identity registry.
- An off-chain indexer or trusted REST data source. Public state is queried on-chain; the optional local order mailbox is untrusted coordination storage.
- Formal proof of finality (Besu QBFT provides BFT finality under the standard 2f+1 assumption).
