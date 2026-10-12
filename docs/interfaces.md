# NyayaChain — Shared Interfaces

**Sprint 0a · 2026-10-12**

This document is the single source of truth for every integration point between Track A (Niharika), Track B (Vijay), and the contracts (Maneesh). If you need a change here, tell Maneesh rather than editing this file yourself.

---

## 1. Contract — CourtKeyRegistry

ABI and addresses are in `public/config.json`. Use `ethers.BrowserProvider(window.ethereum)` for read-only calls and `provider.getSigner()` for signing.

### 1.1 Read functions

```solidity
// Role constants
uint8 ROLE_JUDGE     = 1
uint8 ROLE_CLERK     = 2
uint8 ROLE_REGISTRAR = 3

// Registry lookup — returns JudicialKey struct fields
function registry(address signer) view returns (
    string  courtName,
    uint256 validFrom,
    uint256 validUntil,
    bool    active,
    uint8   courtLevel,
    bytes32 territoryCode,
    uint8   role
)

// Per-judge nonce (next expected nonce for this judge)
function judgeNonce(address judge) view returns (uint256)

// Whether an order hash has been used
function usedOrders(bytes32 orderHash) view returns (bool)

// Whether a parcel is currently frozen (reads through to ParcelToken)
function frozen(uint256 tokenId) view returns (bool)

// Property territory code
function propertyTerritory(uint256 tokenId) view returns (bytes32)

// Declared value of a parcel in INR
function parcelDeclaredValue(uint256 tokenId) view returns (uint256)

// Maximum declared value for a court level
function courtLevelMaxValue(uint8 courtLevel) view returns (uint256)

// Case number of the freeze order that froze this token (empty string if not frozen)
function frozenBy(uint256 tokenId) view returns (string)

// Number of history entries for a token
function getFreezeHistoryLength(uint256 tokenId) view returns (uint256)

// A single history entry (0-indexed)
function getFreezeHistoryEntry(uint256 tokenId, uint256 index) view returns (
    uint256 timestamp,
    string  caseNumber,
    address signer,          // primary JUDGE address
    bool    isFreezeAction,
    uint256 nonce,
    uint256 checksBitmask
)

// Pre-flight check: returns bitmask of passing checks without reverting.
// Call this before submitFreezeOrder to show the checks panel.
// Bit definitions are in public/checks.json.
function getOrderChecks(
    uint256          tokenId,
    bytes32          orderHash,
    uint256          orderExpiry,
    uint256          nonce,
    bytes[] calldata signatures
) view returns (uint256 bitmask)

// Territory human name
function territoryName(bytes32 code) view returns (string)

// Parent territory code (district → state)
function parentTerritory(bytes32 code) view returns (bytes32)

// Minimum total signatures required (3 after Sprint 0b)
function quorumThreshold() view returns (uint256)
```

### 1.2 Write functions

```solidity
// Submit a freeze order. Requires quorumThreshold signatures:
//   exactly 1 JUDGE + 1 CLERK + 1 REGISTRAR (after Sprint 0b).
// orderHash = keccak256(abi.encode(tokenId, caseNumber, orderExpiry, nonce))
// Each signature = ethers personal_sign of orderHash (eth_sign prefix applied on-chain).
function submitFreezeOrder(
    uint256          tokenId,
    string calldata  caseNumber,
    bytes32          orderHash,
    uint256          orderExpiry,
    uint256          nonce,
    bytes[] calldata signatures
) external

// Submit an unfreeze (vacate) order. Same signature rules.
// Adds CHECK_FROZEN_STATE (token must currently be frozen).
function submitUnfreezeOrder(
    uint256          tokenId,
    string calldata  caseNumber,
    bytes32          orderHash,
    uint256          orderExpiry,
    uint256          nonce,
    bytes[] calldata signatures
) external
```

### 1.3 Events

```solidity
// Emitted by submitFreezeOrder on success
event OrderAccepted(
    uint256 indexed tokenId,
    address indexed signer,     // primary JUDGE
    string  caseNumber,
    uint256 nonce,
    uint256 checksBitmask
)

// Emitted by submitUnfreezeOrder on success
event OrderVacated(
    uint256 indexed tokenId,
    address indexed signer,     // primary JUDGE
    string  caseNumber,
    uint256 nonce,
    uint256 checksBitmask
)

// Emitted when a signer is registered (any role)
event JudgeRegistered(
    address indexed signer,
    string  courtName,
    uint8   courtLevel,
    uint8   role,
    string  territory
)

event PropertyRegistered(
    uint256 indexed tokenId,
    string  territory,
    uint256 declaredValue
)
```

### 1.4 Order hash computation

```js
// In the browser (ethers v6)
const orderHash = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "string", "uint256", "uint256"],
    [tokenId, caseNumber, orderExpiry, nonce]
  )
);
// Signing: ethers personal_sign applies the eth_signed_message prefix,
// which the contract recovers via MessageHashUtils.toEthSignedMessageHash.
const sig = await signer.signMessage(ethers.getBytes(orderHash));
```

---

## 2. public/config.json fields

```jsonc
{
  "contractAddress":     "0x…",   // CourtKeyRegistry
  "parcelTokenAddress":  "0x…",   // ParcelToken
  "adminAddress":        "0x…",
  "judgeAddress":        "0x…",   // demo judge wallet
  "outsideJudgeAddress": "0x…",   // demo out-of-jurisdiction judge
  "registrarAddress":    "0x…",   // demo registrar wallet (also admin)
  "network":             "besu",
  "territories": {
    "vellore":        "0x…",      // bytes32 keccak256 territory codes
    "chennai":        "0x…",
    "tamilNadu":      "0x…",
    "kadapa":         "0x…",
    "andhraPradesh":  "0x…"
  }
}
```

`chainId` is always `1337` on the Besu network; read it from `CHAIN_ID` in `wallet.js`.

---

## 3. Order JSON schema

An order object passed between signers (via export/import or the coordination service).

```jsonc
{
  "version": 1,
  "tokenId":    42,                 // uint256
  "action":     "freeze",           // "freeze" | "unfreeze"
  "caseNumber": "CIV/42/2026",
  "orderExpiry": 1760000000,        // Unix timestamp (seconds)
  "nonce":      3,                  // judgeNonce[judgeAddress] at creation time
  "orderHash":  "0x…",              // keccak256 of (tokenId, caseNumber, orderExpiry, nonce)
  "signatures": [
    {
      "signer":    "0xABCD…",       // recovered address
      "role":      "JUDGE",         // "JUDGE" | "CLERK" | "REGISTRAR"
      "signature": "0x…"            // 65-byte hex string
    }
  ]
}
```

**Validation rules for import:**
- Reject if `orderHash` does not match recomputed hash from the other fields.
- Reject if a signer address appears more than once.
- Reject if the role slot for that signer is already filled.
- Reject if the recovered address from `signature` does not match `signer`.

---

## 4. Coordination service API (Niharika builds, Vijay reads)

Base URL: `http://localhost:3001`. All requests and responses are JSON.
The service is an untrusted off-chain mailbox. The browser verifies all signatures; the contract enforces all rules.

```
POST   /orders
  body: Order JSON (see §3)
  201 Created → { hash: "0x…" }
  400 Bad Request → { error: "reason" }

GET    /orders?status=pending&roleAwaiting=CLERK
  200 OK → Order[]
  Filters: status = "pending" | "collecting" | "ready" | "submitted"
           roleAwaiting = "JUDGE" | "CLERK" | "REGISTRAR"

GET    /orders/:hash
  200 OK → Order JSON
  404 Not Found

POST   /orders/:hash/signatures
  body: { signer, role, signature }
  200 OK → updated Order JSON
  400 Bad Request → { error: "reason" }

POST   /orders/:hash/submitted
  body: { txHash: "0x…" }
  200 OK
```

---

## 5. Session API (wallet.js → everyone)

`wallet.js` exposes the `NyayaWallet` global. The session reflects the currently connected wallet and its on-chain role.

```js
// Returns the current session, or null if not connected.
NyayaWallet.getSession()
// → { address: "0x…", role: "JUDGE"|"CLERK"|"REGISTRAR"|null, courtName: string }
// → null  (if no wallet connected)

// Fired on window when the session changes (connect, disconnect, account switch,
// role change after wallet switch, or chain change that causes a reload).
window.addEventListener("nyaya:session-changed", (e) => {
  const session = e.detail; // same shape as getSession(), or null
});
```

Vijay's pages must call `NyayaWallet.getSession()` on load and listen for `nyaya:session-changed`. They must never call `connectWallet()` themselves; that is login.html's job.

---

## 6. Inspector API (inspector.js → court.html)

`inspector.js` exposes the `NyayaInspector` global. `court.html` owns the page; `inspector.js` owns the `#inspector-root` container inside it.

```js
// Mount the inspector into a DOM container.
// Must be called once before setOrder.
// provider: ethers BrowserProvider
// config:   parsed public/config.json
NyayaInspector.attach({ container: Element, provider, config })

// Update the inspector with the current order state.
// orderContext shape:
// {
//   order: {
//     tokenId, action, caseNumber, orderHash, orderExpiry, nonce
//   },
//   signatures: [{ signer, role, signature }],   // may be partial
//   status: "draft" | "collecting" | "ready" | "submitted" | "accepted",
//   txHash:        "0x…" | null,
//   checksBitmask:  0      // stored bitmask after acceptance, 0 before
// }
NyayaInspector.setOrder(orderContext)
```

`court.html` fires a DOM event whenever order state changes so that Vijay's inspector can react without polling:

```js
// Fired by court.html on document whenever the order changes.
document.addEventListener("nyaya:order-updated", (e) => {
  const orderContext = e.detail; // same shape as NyayaInspector.setOrder argument
  NyayaInspector.setOrder(orderContext);
});
```

---

## 7. Demo runner mount (demo-runner.js → orders-server.js)

`server/demo-runner.js` exports a single function. `orders-server.js` mounts it with one line.

```js
// In orders-server.js:
const mountDemoRunner = require("./demo-runner");
mountDemoRunner(app); // app is the Express instance
```

`demo-runner.js` adds its routes under `/demo/*`. It must:
- Check `process.env.DEMO_MODE === "1"` on every request and respond `403` if not set.
- Listen on localhost only (enforced at the server level).
- Read demo wallet keys from disk; never send them to the browser.

---

## 8. Check names and counts

All pages must read check names, bit numbers, and counts from `public/checks.json`. **Never hardcode "12 checks" or "13 checks".**

```js
const checks = await fetch("/checks.json").then(r => r.json());
const freezeChecks   = checks.checks.filter(c => c.actions.includes("freeze"));
const unfreezeChecks = checks.checks.filter(c => c.actions.includes("unfreeze"));
// checks.freezeCheckCount  === 12
// checks.unfreezeCheckCount === 13
// checks.bitmaskWidth       === 13
```
