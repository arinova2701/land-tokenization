# NyayaChain Team Sprint Plan

Oct 12, 2026 · @Maneesh Ari

Everything below must be merged to main by 2 PM on October 13, with integration and rehearsal that evening. The final implementation deadline is October 15.

Repo: github.com/arinova2701/land-tokenization (private, teammates are added as collaborators).

## Goal

One app with two modes:

1. **User mode.** The clean flow a real user sees: wallet login, a role-based portal, guided signing by three authorities (Judge, Clerk, Registrar), and a citizen page that shows land status.
2. **Under the hood mode.** A switch that exposes the internal workings live: order digest, signature recovery, every on-chain check, jurisdiction trace, token call and transaction lifecycle. Plus a block explorer, an independent verifier and a one-click scenario console.

User mode is what a court officer or citizen would use. Under the hood mode is what we show reviewers to prove the protocol does what the paper says.

## Roles and timeline

Tracks A and B run at the same time on different files. They only meet through docs/interfaces.md, which Sprint 0 creates.

| Person | Track | Focus |
| --- | --- | --- |
| Maneesh | Foundation and integration | Sprint 0, Sprint 3, merges, paper and patent draft |
| Niharika | Track A: Workflow | Login, session, court workflow, registrar portal, coordination service |
| Vijay | Track B: Transparency | Inspector, verifier, citizen page, explorer, scenario console, architecture page |

| When | Who | What |
| --- | --- | --- |
| Oct 12, tonight, first 30 min | Maneesh | Sprint 0a: checks.json, docs/interfaces.md, stubs. Merge to main and message the team |
| Oct 12, tonight | Niharika, Vijay | Clone, set up Besu and wallets, read interfaces.md, start coding against the stubs |
| Oct 12, tonight, 1.5 to 2 hours | Maneesh | Sprint 0b: three-signer contract. Hardhat tests, merge. Besu suite and benchmark run in the background after |
| Oct 13, from morning | Niharika, Vijay | Tracks A and B in parallel, P1 items first |
| Oct 13, 2 PM | Everyone | Hard merge cutoff. Anything not merged is cut |
| Oct 13, 2 PM to evening | Everyone, led by Maneesh | Sprint 3: merge, fresh-chain run, three-profile rehearsal, docs |

## Working with Claude Code without overwriting each other

Everyone uses Claude Code on their own machine with their own Claude account. Every change goes through a branch and a pull request. Nobody, human or Claude, writes to main directly.

**One-time setup (each person)**

1. Accept the GitHub collaborator invite.
2. Set your own identity so commits show who did the work:
   1. `git config --global user.name "Your Name"`
   2. `git config --global user.email "you@example.com"`
3. Clone the repo and run `npm install --legacy-peer-deps`.
4. Start Docker Desktop, then `docker compose -f docker/docker-compose.yml up -d`.
5. Run `node scripts/setup-demo-wallets.js`, `scripts/deploy-besu.js`, `node scripts/seed-demo.js`, then `node scripts/demo-check.js`. Every line must be PASS.
6. Your demo-wallets.json is private to your machine. Never share it, never commit it.
7. Copy this doc into the repo root as `nyayachain-team-sprints.md` (export it as Markdown) so Claude Code can read it. Maneesh commits it in Sprint 0a.

**Git rules (Claude Code must follow these)**

- Work only on your own branch: `track-a/<task>` or `track-b/<task>`. Never commit to main, never push to main.
- Start every session with `git fetch origin` and `git pull --rebase origin main` on your branch.
- Before every commit, run `git status` and `git diff --stat`. Commit only files you own (see the ownership table). If a file you do not own shows as changed, revert it with `git checkout -- <file>` instead of committing it.
- Use `git add <file>` for each file. Never `git add -A` or `git add .`, so nothing outside your files slips in.
- Commit and push every 30 to 45 minutes: `git push origin <your-branch>`.
- If a push is rejected, run `git pull --rebase origin <your-branch>`, resolve conflicts, re-test, push again.
- Never force push. Never use `git reset --hard` on a shared branch. Never delete someone else's branch.
- If a rebase conflict is in a file you do not own, stop and tell the owner. Do not resolve it by keeping only your version.
- Open one pull request per sprint into main. Maneesh reviews and merges. Delete your branch only after it is merged.

**Claude Code permissions**

Use auto-accept edits (Shift+Tab), but approve git commands yourself the first time each one runs. Do not start Claude Code with `--dangerously-skip-permissions` on this repo.

## File ownership

Only edit files you own. If you need a change in someone else's file, ask the owner or add it to docs/interfaces.md. Contract files are frozen after Sprint 0: report contract bugs to Maneesh instead of editing them.

| Owner | Files |
| --- | --- |
| Maneesh | contracts/*, test/*, scripts/deploy\*.js, scripts/benchmark.js, public/checks.json, docs/interfaces.md, docs/status.md, docs/idf-b-alignment.md, README (final pass) |
| Niharika | public/login.html, public/wallet.js, public/court.html, public/registrar.html, server/orders-server.js, scripts/seed-demo.js, scripts/demo-check.js |
| Vijay | public/inspector.js, public/inspector.css, public/verify.html, public/index.html, public/explorer.html, public/demo.html, public/architecture.html, scripts/scenarios.js, server/demo-runner.js |

**Shared points (agreed in docs/interfaces.md, never edited by the other person)**

- court.html contains `<div id="inspector-root">` and loads inspector.js. Niharika owns the page, Vijay owns the inspector.
- orders-server.js mounts the demo runner from server/demo-runner.js with one line. Niharika owns the server, Vijay owns the runner.
- wallet.js exposes `getSession()` and the `nyaya:session-changed` event. Vijay's pages read it but never edit wallet.js.

**Shared constants rule.** Check names, bit numbers and counts come only from public/checks.json, generated from the contract in Sprint 0. No page may hardcode "11 checks" or "12 checks".

## Sprint 0: Foundation (Maneesh, tonight)

Sprint 0 freezes the contract and the shared interface. It is split so teammates can start within 30 minutes.

**Sprint 0a (first 30 minutes, merge immediately)**

1. Commit this plan as `nyayachain-team-sprints.md`.
2. Generate `public/checks.json`: one entry per check with bit, id, name, one-line description and the actions it applies to (freeze, unfreeze), plus the check counts and bitmask width. Include the two new co-signer checks from 0b.
3. Write `docs/interfaces.md`:
   - Contract functions and events the frontend uses, with full signatures, including the signers and roles per order
   - `public/config.json` fields
   - Order JSON schema: order fields, orderHash, signatures array (signer, role, signature)
   - Coordination service API (built by Niharika, read by Vijay)
   - Session API: `NyayaWallet.getSession()` returns `{ address, role, courtName }`, plus the `nyaya:session-changed` event
   - Inspector API: `NyayaInspector.attach({ container, provider, config })`, `NyayaInspector.setOrder(orderContext)`, plus the `nyaya:order-updated` event fired by court.html
   - Demo runner mount: `server/demo-runner.js` exports a function the orders server mounts with one line
4. Stubs: `public/inspector.js` with the API above (empty implementation), `getSession()` stub in `public/wallet.js`, and an empty `server/demo-runner.js` export.
5. Merge to main and message Niharika and Vijay.

**Sprint 0b (1.5 to 2 hours)**

1. Contract: every freeze and unfreeze order needs three distinct valid signatures, one JUDGE, one CLERK, one REGISTRAR. Split the co-signer check into CLERK present and REGISTRAR present, each with its own bit. Minimum threshold is 3.
2. Record signer addresses and roles per order in HistoryEntry or the emitted event.
3. Tests: update the happy path and multi-signer cases for three signers. Add missing clerk, missing registrar, and two judges with no clerk. Update benchmark.js to sign with three wallets.
4. Run all tests on Hardhat and merge to main.
5. After merging, run the full suite on Besu and the benchmark under a new key `besu_three_signer`, keeping older keys. This does not block anyone.
6. Update README, docs/status.md, docs/idf-b-alignment.md with the final counts.

Exit checklist: all tests pass on Hardhat, checks.json and interfaces.md and stubs are on main, demo-check.js passes on a fresh chain.

## Track A: Workflow (Niharika)

Build every P1 item first, in order, and push after each one. P2 only after all P1 items work.

**Sprint A1: Login, session, registrar** (branch `track-a/login-registrar`)

- P1. `public/login.html`: one "Sign in with wallet" button. After connecting, read the role from the registry, show a role card (short address, role, court name) and route: JUDGE or CLERK to court.html, REGISTRAR to registrar.html, no role to index.html. Add "Continue as public viewer" with no wallet. No username or password. The page says access is decided by the on-chain role.
- P1. `public/wallet.js`: auto-reconnect on load with `eth_accounts` (no popup), handle `accountsChanged` and `chainChanged` and re-detect the role, clear message and install link if MetaMask is missing, wrong network switch prompt, `signOut()`, implement `getSession()` and fire `nyaya:session-changed`.
- P1. Shared header on court.html and registrar.html: role badge, short address, Sign out and Switch account. Wrong role or no wallet redirects to login.html with a short explanation.
- P1. `public/registrar.html`: rename "Register Authorized Judge" to "Register Authorized Signer". Load the parcel dropdown from the chain so Tokens 4, 5 and 6 appear. Build the Registered Signers list from the registry with the role for each, showing the current demo wallets, not old default accounts. Keep the pecuniary section, reading limits and declared values from the chain.
- P1. `scripts/seed-demo.js` registers the demo registrar wallet with ROLE\_REGISTRAR. `scripts/demo-check.js` gets a PASS or FAIL line for it.

Exit: Judge, Clerk and Registrar each land on the right page from login, a wrong role is redirected, the registrar page lists the current signers and Tokens 4 to 6, demo-check.js passes.

**Sprint A2: Court workflow and coordination** (branch `track-a/court-workflow`)

- P1. `public/court.html` as a guided flow, no raw JSON in the main path:
  - Token selector from the chain: label, territory, declared value in INR, frozen status.
  - Step 1, Create order (judge): token, action, case number, validity, auto-filled nonce. A plain-language summary card before signing, for example "Freeze Token 4, Parcel A, Vellore, case 123, valid until 6:40 PM, nonce 2", and one line explaining that MetaMask shows a hash because it signs the order digest.
  - Step 2, Collect signatures: three-slot panel (Judge, Clerk, Registrar) with pending or signed, short address, role, short signature hash, and "2 of 3 signed". Only the role whose slot is open sees a Sign button.
  - Step 3, Review and submit: run getOrderChecks and list each check using names from checks.json. Submit only with three signatures and all checks passing. Show "Waiting for block", then the tx hash and the three signers.
- P1. Export order and Import order buttons as the handover between profiles. Validate on every import: reject a wrong order hash, a duplicate signer, a filled role slot, and a signature that recovers to an address with no matching role.
- P1. Inspector hook: `<div id="inspector-root">`, an "Under the hood" toggle, load inspector.js, fire `nyaya:order-updated` on every order, signature or status change.
- P2. `server/orders-server.js`: small Node service on port 3001 with CORS, storing orders in `data/pending-orders.json` (gitignored). Endpoints: POST /orders, GET /orders (filter by status and role awaiting), GET /orders/:hash, POST /orders/:hash/signatures, POST /orders/:hash/submitted. Mount the demo runner from server/demo-runner.js with one line. npm scripts `orders-server` and `demo` (http-server on 8080 plus the service). The service has no authority: the browser verifies every signature and the contract enforces the rules.
- P2. Inbox on court.html using the service: clerks and registrars see "Orders awaiting your signature", judges see "My orders" with status and tx hash. A status light shows whether the service is reachable, falling back to export and import when it is not.

Exit: a full freeze works with three wallets, bad imports are rejected with a clear message, the inspector hook fires events.

## Track B: Transparency (Vijay)

Build every P1 item first, in order, and push after each one. P2 only after all P1 items work.

**Sprint B1: Inspector, verifier, citizen page** (branch `track-b/inspector-verify`)

- P1. `public/inspector.js` and `public/inspector.css`: the "Under the hood" drawer, hidden by default, with data from the chain and the order context court.html passes in:
  - Order digest: the order fields, the packed encoding, the keccak256 digest, the signed-message prefix step.
  - Signatures: for each one, the recovered signer, its role and court level from the registry, and whether the key is valid at that time.
  - Checks table: every check from checks.json with what is compared (the actual values), pass or fail, bit number. getOrderChecks before submit, the stored bitmask after.
  - Jurisdiction trace: signer territory against parcel territory through the hierarchy (TN to Vellore), and court level maximum against declared value in INR.
- P1. `public/verify.html`: paste a tx hash or order JSON. The page reads the chain, recomputes the digest, recovers every signer, checks the roles, and shows "Verified: signed by Judge X, Clerk Y, Registrar Z" or the exact reason it fails. It trusts nothing from the site.
- P1. `public/index.html` citizen page, no wallet: search by token ID, a status card (parcel, territory, declared value, frozen or not, and for a frozen parcel the case number, date and three signers), a history timeline with bitmask dots and "Signed by" for each entry, and a "Verify independently" link to verify.html.
- P2. Extra inspector panels: replay and nonce (usedOrders, expected against provided nonce), token call (ParcelToken state before and after), transaction lifecycle (submitted, pending, block N, QBFT finality, gas, decoded events).

Exit: the inspector shows its P1 panels for a real order on Besu, verify.html verifies a real freeze and rejects a tampered one, the citizen page works with no wallet installed.

**Sprint B2: Scenario console, explorer, architecture** (branch `track-b/explorer-scenarios`)

- P1. `scripts/scenarios.js`, `server/demo-runner.js` and `public/demo.html` (Demo Console): one-click scenarios shown step by step with the inspector beside them, expected result next to actual. At least: success freeze, pecuniary failure (Token 5), territorial failure (Token 6), missing registrar, duplicate signer, replay of a used order. The runner signs with demo wallets on the server side, runs only with `DEMO_MODE=1`, listens on localhost only, reads demo-wallets.json from disk and never sends private keys to the browser.
- P2. Remaining scenarios: success unfreeze, missing clerk, expired order, wrong nonce, non-agent call to ParcelToken.
- P2. `public/explorer.html`, no wallet: latest blocks (number, time, tx count), transactions with decoded method names, an event feed in plain language, and a contract state viewer (signers and roles, per-judge nonces, court level limits, parcels, token frozen state).
- P2. `public/architecture.html`: a static diagram of the actors, browser and MetaMask, the coordination service (labelled as an untrusted off-chain mailbox), the Besu QBFT network, CourtKeyRegistry and ParcelToken, with the freeze sequence below it. Real addresses from config.json.

Exit: the P1 scenarios run on Besu with expected against actual, and the console refuses to run without DEMO\_MODE=1 and never exposes keys.

## Sprint 3: Integration and rehearsal (Oct 13, 2 PM onward)

Maneesh leads. Anything not merged by 2 PM is switched off or cut, not debugged during integration.

1. Merge order: A1, then A2, then B1, then B2. Each pull request is rebased on the latest main before merging. Conflicts at the shared points (inspector container, demo runner mount, wallet.js session) are resolved with both owners present.
2. Fresh chain run: reset Besu, setup-demo-wallets, deploy-besu, seed-demo, demo-check (all PASS), then `npm run demo` (or http-server if the service was cut).
3. Three Chrome profiles (Judge, Clerk, Registrar) plus a public window. Full flow: login, create order, three signatures, submit, citizen page shows frozen with three signers, verify.html confirms, unfreeze.
4. Failure cases from the Demo Console.
5. If the coordination service shipped, stop it mid-flow and finish with export and import.
6. Full test suite on Hardhat and Besu (about 25 minutes on Besu). All pass.
7. Docs: README Demo setup, docs/status.md, docs/idf-b-alignment.md. The coordination service is described only as an untrusted off-chain mailbox, never as a trusted backend or indexer.
8. `docs/demo-script.md`, a 10-minute walkthrough: minutes 1 to 4 in user mode (login, court flow, citizen page), minutes 5 to 9 in under the hood mode (inspector, scenarios, verify.html, explorer), minute 10 on results (tests, benchmark).

Exit: the full flow passes on a fresh chain, everything is on main, `git status` is clean and in sync with origin, and the demo script has been rehearsed once.

## Starter prompts for Claude Code

Open Terminal in your clone, run `claude`, and paste your prompt.

**Maneesh**

```
Read nyayachain-team-sprints.md. Do Sprint 0a first and merge it to main within 30 minutes, then tell me so I can message the team. Then do Sprint 0b: implement, run the Hardhat tests, merge to main. Run the Besu suite and the benchmark last. Give complete file replacements. Never force push.
```

**Niharika**

```
Read nyayachain-team-sprints.md and docs/interfaces.md. I am Niharika, Track A. Work on branch track-a/login-registrar for Sprint A1, then track-a/court-workflow for Sprint A2.

Rules you must follow:
- Only edit files listed as mine in the ownership table. If a change seems to need someone else's file, stop and tell me.
- Start with git fetch origin and git pull --rebase origin main.
- Before every commit run git status and git diff --stat. Stage files one by one with git add <file>. Never use git add -A or git add . If a file I do not own shows as changed, revert it with git checkout -- <file>.
- Commit and push to my branch every 30 to 45 minutes. Never commit or push to main. Never force push. Never use git reset --hard.
- If a rebase conflict is in a file I do not own, stop and tell me instead of resolving it.
- Use public/checks.json for check names and counts. Never hardcode them.

Deadline: everything merged by 2 PM tomorrow. Build all P1 items first, in the order listed, and push after each one. Do P2 only after every P1 item works. Do not run the full Besu test suite. Test my pages against the demo chain only. Stop at each exit checklist and report, then open a pull request into main.
```

**Vijay**

```
Read nyayachain-team-sprints.md and docs/interfaces.md. I am Vijay, Track B. Work on branch track-b/inspector-verify for Sprint B1, then track-b/explorer-scenarios for Sprint B2.

Rules you must follow:
- Only edit files listed as mine in the ownership table. If a change seems to need someone else's file, stop and tell me.
- Start with git fetch origin and git pull --rebase origin main.
- Before every commit run git status and git diff --stat. Stage files one by one with git add <file>. Never use git add -A or git add . If a file I do not own shows as changed, revert it with git checkout -- <file>.
- Commit and push to my branch every 30 to 45 minutes. Never commit or push to main. Never force push. Never use git reset --hard.
- If a rebase conflict is in a file I do not own, stop and tell me instead of resolving it.
- Use public/checks.json for check names and counts. Never hardcode them.
- The demo runner runs only with DEMO_MODE=1, listens on localhost only, and never sends private keys to the browser.

Deadline: everything merged by 2 PM tomorrow. Build all P1 items first, in the order listed, and push after each one. Do P2 only after every P1 item works. Do not run the full Besu test suite. Test my pages against the demo chain only. Stop at each exit checklist and report, then open a pull request into main.
```

## Out of scope (future work in the paper)

- EIP-712 typed signing, so MetaMask shows order fields instead of a hash
- Full ERC-3643 identity registry (T-REX). ParcelToken is a compatible subset
- Hardware wallets or an institutional key manager for judge and registrar keys
- A trusted indexer and database
