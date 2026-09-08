# Land Token Freeze Protocol

## Context

Indian courts issue interim injunctions to freeze disputed properties during litigation. Currently, enforcing these orders on land records requires physically sending certified copies to the Sub-Registrar's office — a process that is slow, forgeable, and lacks an audit trail.

ERC-3643, a widely adopted standard for tokenized real-world assets, includes a built-in freeze mechanism for property tokens. But it defines HOW to freeze, not WHO is authorized to trigger it. Any privileged address can call the freeze function with no on-chain proof that the request originates from a legitimate court order.

## What This Project Does

This system fills that authentication gap. It adds an on-chain verification layer between the court order and the freeze trigger. Before any property token is frozen, the smart contract:

1. Recovers the signer's identity from the digital signature using ECDSA
2. Checks that signer against a registry of authorized judicial signers (CourtKeyRegistry)
3. Verifies the signer's key is within its valid time window (not expired, not revoked)

Only orders signed by a registered, currently-valid judge pass all three checks. Everything else is rejected with a specific reason.

## Tech Stack

- **Smart Contract:** Solidity 0.8.26, OpenZeppelin ECDSA and MessageHashUtils libraries
- **Blockchain (demo):** Hardhat local EVM node with Cancun EVM target
- **Blockchain (production target):** Hyperledger Besu, Proof of Authority consensus
- **Token Standard:** ERC-3643 compatible freeze mechanism
- **Frontend:** Vanilla HTML/JS, ethers.js v6, direct JSON-RPC connection
- **Cryptography:** ECDSA signature recovery (ecrecover) with Ethereum Signed Message standard
- **Court Order Data:** Real interim injunction cases sourced from Madras HC portal and eCourts

## Project Structure

```
land-tokenization/
├── contracts/
│   └── CourtKeyRegistry.sol      # Core smart contract
├── scripts/
│   └── deploy.js                 # Deploys contract and registers a test judge
├── public/
│   └── index.html                # Frontend dApp
├── data/
│   └── court-orders/             # Real court order samples used in demo
├── hardhat.config.js
├── package.json
└── README.md
```

## Setup After Cloning

Prerequisites: Node.js (v18 or higher) installed.

```bash
git clone <repo-url>
cd land-tokenization
npm install
npx hardhat compile
```

Compilation should output: `Compiled 9 Solidity files successfully (evm target: cancun).`

## Running the System

Open three terminal tabs in VS Code (Terminal > New Terminal, repeat three times). All three should be inside the `land-tokenization/` folder.

### Tab 1 — Start the blockchain

```bash
npx hardhat node
```

Wait until you see a list of 20 accounts with private keys. This is your local blockchain. Keep this tab running, do not close it.

### Tab 2 — Deploy the contract

```bash
npx hardhat run scripts/deploy.js --network localhost
```

Expected output:

```
Contract deployed at: 0x5FbDB2315678afecb367f032d93F642f64180aa3
Admin (Registrar): 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Judge account: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Judge registered successfully
Frontend config written to public/config.json
```

This deploys the CourtKeyRegistry contract and pre-registers one judge (Account #1 from Hardhat) at "XVI Assistant City Civil Court, Chennai".

### Tab 3 — Serve the frontend

```bash
npx http-server public -p 3000 -c-1
```

Open http://localhost:3000 in your browser.

## Demo Walkthrough

The frontend has three tabs matching the three real-world roles.

### 1. Registrar Tab

This is the land registry authority's view. One judge is pre-registered by the deploy script. You can register additional judges here by entering their wallet address, court name, and validity window.

### 2. Court Tab — Submitting Freeze Orders

This is where the core demo happens.

**Accepted freeze (authorized judge):**

1. Select the account labeled **(Registered Judge)** from the "Submit As" dropdown
2. Confirm the status below shows "REGISTERED" in green
3. Enter Token ID: `1`
4. Enter Case Number: `I.A.No.2 of 2024 in O.S.No.5111 of 2024`
5. Click "Sign & Submit Freeze Order"
6. Watch all 7 verification steps pass (green), ending with FREEZE ACCEPTED

**Rejected freeze (unauthorized signer):**

1. Switch the "Submit As" dropdown to any account labeled **(Unauthorized)**
2. Status shows "NOT REGISTERED" in red
3. Enter Token ID: `2`
4. Enter any case number
5. Click "Sign & Submit Freeze Order"
6. Watch it fail at step 5: "Signer not found in CourtKeyRegistry" — FREEZE REJECTED

The same cryptographic process runs both times. The only difference is whether the recovered signer exists in the registry. That distinction is the entire contribution of this project.

### 3. Public Tab — Verify Property Status

1. Enter Token ID `1` and click Check — shows FROZEN, with the case number that froze it
2. Enter Token ID `2` and click Check — shows NOT FROZEN (the unauthorized attempt was rejected, no state changed)

## Real Court Order Data

The demo references real Indian court cases stored in `data/court-orders/`:

1. **Kamalesh Chandrasekaran v. M.A. Noor Jehan Beevi** — Madras HC, C.R.P.No.443/2025. Interim injunction over vacant land in Mylapore, Chennai. Denied at trial court, confirmed on appeal, confirmed on HC revision. Demonstrates the three-tier Tamil Nadu court hierarchy.

2. **DCMS v. Varam Soujanya** — AP HC, C.R.P.No.578/2024. Property possession dispute in Kadapa district with precise survey number descriptions. From Andhra Pradesh (outside TN jurisdiction), useful as a jurisdiction-mismatch test case.

## Stopping the System

Press Ctrl+C in each terminal tab to stop:
- Tab 1: stops the blockchain (all transaction data is cleared)
- Tab 3: stops the web server

Every restart of the node resets the blockchain. The deploy script re-deploys and re-registers the judge automatically, so you always start from a clean state.

## Roadmap

- **Jurisdiction Policy Engine:** On-chain territorial and pecuniary jurisdiction checks (e.g., a Vellore court should not freeze Chennai property)
- **Order Binding and Replay Protection:** Nonce-based prevention of duplicate submissions, plus unfreeze lifecycle for vacated injunctions
- **Hyperledger Besu Migration:** Move from local EVM to a permissioned PoA network with known government validators
- **Extended Validation:** Latency benchmarking and a negative corpus of 20 malformed freeze requests

## Team

- **Arinova (Maneesh):** CourtKeyRegistry contract, off-chain backend, chain setup, benchmarking
- **Niharika:** Jurisdiction policy engine, court hierarchy table
- **Vijay:** Order binding, nonce/expiry logic, replay protection, unfreeze lifecycle

- **Dr Anthony Seba P:** Project Guide
