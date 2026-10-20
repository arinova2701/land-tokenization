# NyayaChain — 10-minute demo script

Prepare the four-node Besu chain, deploy and seed the current contracts, and run `node scripts/demo-check.js` before the panel. Expect 18 PASS. Start the web page with `npm run serve`. Use separate browser profiles for the Judge, Clerk and Registrar demo wallets; keep an Admin profile ready for registry management. Open the public citizen page without a wallet. Keep an exported order JSON or its downloaded file available for handoff between profiles. Use a fresh case number and the current on-chain nonce. This script demonstrates the freeze path for Token 4; rehearse once so the live signing steps fit the time.

| Time | Mode | Presenter action and point to explain |
| --- | --- | --- |
| 0:00–1:00 | User | Open `login.html` in the Judge profile, connect the Judge wallet, and show that the role comes from the on-chain registry. Open `court.html`. |
| 1:00–2:00 | User | Select Token 4 (Vellore), **Freeze**, enter a case number and validity period, then **Review order** and **Sign with wallet**. Explain that the nonce is read from the chain and that the digest binds the chain, contract, action and order fields. Export the signed order. |
| 2:00–3:00 | User | Import and validate the order in the Clerk profile, sign it, then export the updated order. Import and sign in the Registrar profile. Show three distinct signatures: Judge, Clerk and Registrar. Submit to the chain when the pre-flight checks pass. |
| 3:00–4:00 | User | Open `index.html`, enter Token 4 and show the frozen state, order history and recorded signers. Explain that this public view reads the chain directly. |
| 4:00–5:00 | Under the hood | In `court.html`, enable **Under the hood**. Show the order digest, recovered signer addresses and roles, jurisdiction, nonce, and the contract's check bitmask. The Registry Admin is separate from the three order signers. |
| 5:00–6:00 | Under the hood | Open `verify.html` with the accepted transaction hash or exported order JSON. Show the independent digest and signature checks and the on-chain record. |
| 6:00–8:00 | Under the hood | Open `demo.html` with the local demo runner enabled (`DEMO_MODE=1`). Run a territorial failure with Token 6 and a pecuniary failure with Token 5; show expected versus actual results and the inspector's failed checks. The runner works only on localhost and never sends private keys to the browser. |
| 8:00–9:00 | Under the hood | Open `explorer.html`. Find the accepted freeze event, its transaction and block, and the recorded signer/check data. |
| 9:00–10:00 | Results | State the verified results: **43/43 Hardhat tests** and **18/18 demo preflight checks**. The recorded 100-order, three-signer Besu benchmark averaged **1,994 ms**, with **p99 2,110 ms**. Close with the purpose: an auditable judicial freeze and release path on a permissioned chain. |

`registrar.html` requires the separate **Registry Admin** account for write actions; the Registrar order signer cannot administer the registry.

The contract has 12 freeze checks and 13 unfreeze checks in a 13-bit mask. `ParcelToken` is an **ERC-3643-compatible subset**. The optional order mailbox is untrusted coordination storage; signatures and rules are verified by the browser and contract.
