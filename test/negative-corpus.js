/**
 * Negative Corpus — CourtKeyRegistry + ParcelToken
 * 30 test cases: 20 original rejection paths + 6 new (Steps 1–3 additions)
 *                + 1 multi-signer happy-path + 3 three-signer negative cases (Sprint 0b).
 *
 * Run on Hardhat (fast):
 *   npx hardhat test test/negative-corpus.js
 *
 * Run on Besu (slow — 2s block time × ~10 tx/setup × 30 tests ≈ 17 min):
 *   npx hardhat test test/negative-corpus.js --network besu
 *
 * Design note on case 15 (freeze already-frozen token):
 *   The contract does NOT prevent re-freezing a token that is already frozen.
 *   A second authenticated freeze order for an already-frozen token is accepted.
 *   This is intentional: multiple court orders can independently freeze the same
 *   property (e.g. different creditors), and the contract records every order in
 *   freezeHistory.  frozenBy is updated to the latest case number.
 *
 * Three-signer quorum (Sprint 0b):
 *   Every valid order requires exactly 1 JUDGE + 1 CLERK + 1 REGISTRAR.
 *   The fixture registers:
 *     admin         → ROLE_REGISTRAR (national co-signer, territory-exempt)
 *     judgeVellore  → ROLE_JUDGE,     level 3, territory Vellore
 *     judgeKadapa   → ROLE_JUDGE,     level 1, territory Kadapa
 *     clerkVellore  → ROLE_CLERK,     level 3, territory Vellore
 *     clerkKadapa   → ROLE_CLERK,     level 1, territory Kadapa
 *
 *   Valid 3-signer sets:
 *     Token 1/2 (Vellore/Chennai): [judgeVellore, clerkVellore, admin]
 *     Token 3   (Kadapa):          [judgeKadapa,  clerkKadapa,  admin]
 *
 * Network compatibility note:
 *   hardhat-chai-matchers `revertedWith` works only on Hardhat's in-process chain.
 *   We use a network-agnostic expectRevert() helper instead.
 */

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

// ─── Network-agnostic revert assertion ───────────────────────────────────────

async function expectRevert(txPromise, reason) {
  let tx, receipt;
  try {
    tx = await txPromise;
    receipt = await tx.wait();
  } catch (err) {
    const msg = err.reason || err.shortMessage || err.message || String(err);
    if (reason && !msg.includes(reason)) {
      throw new Error(
        `Expected revert reason to include "${reason}" but got:\n  ${msg}`
      );
    }
    return;
  }
  if (receipt && receipt.status === 0) {
    const besuReason = receipt.revertReason || "";
    if (reason && !besuReason.includes(reason)) {
      const callReason = await getRevertReason(tx);
      if (reason && !callReason.includes(reason)) {
        throw new Error(
          `Expected revert reason "${reason}" but receipt: "${besuReason}" / call: "${callReason}"`
        );
      }
    }
    return;
  }
  throw new Error(
    `Expected transaction to revert with "${reason}", but it succeeded (status=1)`
  );
}

async function expectAnyRevert(txPromise) {
  let tx, receipt;
  try {
    tx = await txPromise;
    receipt = await tx.wait();
  } catch (_) {
    return;
  }
  if (receipt && receipt.status === 0) return;
  throw new Error("Expected transaction to revert, but it succeeded");
}

async function getRevertReason(tx) {
  try {
    const provider = ethers.provider;
    await provider.call({ to: tx.to, from: tx.from, data: tx.data, value: tx.value });
    return "";
  } catch (e) {
    return e.reason || e.shortMessage || e.message || "";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function territoryCode(name) {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

/**
 * Build and sign an order.
 *
 * @param {Signer[]} signers  Array of signers — all sign the same hash.
 *                            Valid orders: [judgeX, clerkX, admin].
 *                            Negative-path tests may use subsets or bad signers.
 */
async function makeOrder(signers, tokenId, caseNumber, expiryOffset, action, nonce) {
  const expiry = Math.floor(Date.now() / 1000) + expiryOffset;
  const packed = ethers.solidityPacked(
    ["string", "uint256", "uint256", "string", "uint256"],
    [caseNumber, tokenId, expiry, action, nonce]
  );
  const hash = ethers.keccak256(packed);
  const sigs = [];
  for (const s of signers) {
    sigs.push(await s.signMessage(ethers.getBytes(hash)));
  }
  return { hash, expiry, sigs };
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

async function deploy() {
  // Accounts #0–#6 from Hardhat deterministic wallet.
  // On Hardhat in-process all accounts are auto-funded.
  // On Besu, ensure accounts #0–#6 are funded in genesis.json.
  const [admin, judgeVellore, judgeKadapa, outsider, attacker, clerkVellore, clerkKadapa] =
    await ethers.getSigners();

  // Deploy ParcelToken (ERC-3643-compatible subset)
  const TokenFactory = await ethers.getContractFactory("ParcelToken");
  const token = await TokenFactory.deploy();
  await token.waitForDeployment();

  // Deploy CourtKeyRegistry
  const Factory = await ethers.getContractFactory("CourtKeyRegistry");
  const c = await Factory.deploy(await token.getAddress());
  await c.waitForDeployment();

  // Set registry as token agent (ERC-3643 agent role)
  await (await token.setAgent(await c.getAddress())).wait();

  const vellore       = territoryCode("vellore");
  const chennai       = territoryCode("chennai");
  const tamilNadu     = territoryCode("tamil_nadu");
  const kadapa        = territoryCode("kadapa");
  const andhraPradesh = territoryCode("andhra_pradesh");

  await (await c.setTerritory(tamilNadu,     "Tamil Nadu",     ethers.ZeroHash)).wait();
  await (await c.setTerritory(vellore,       "Vellore",        tamilNadu)).wait();
  await (await c.setTerritory(chennai,       "Chennai",        tamilNadu)).wait();
  await (await c.setTerritory(andhraPradesh, "Andhra Pradesh", ethers.ZeroHash)).wait();
  await (await c.setTerritory(kadapa,        "Kadapa",         andhraPradesh)).wait();

  // Register properties with declared values (Step 2)
  // Token 1 (Vellore): ₹50 lakh — within District Court limit (₹1 cr)
  // Token 2 (Chennai): ₹50 lakh — within District Court limit
  // Token 3 (Kadapa):  ₹2 lakh  — within Munsif limit (₹3 lakh)
  await (await c.registerProperty(1, vellore, 5_000_000)).wait();
  await (await c.registerProperty(2, chennai, 5_000_000)).wait();
  await (await c.registerProperty(3, kadapa,  200_000)).wait();

  const now     = Math.floor(Date.now() / 1000);
  const oneYear = now + 365 * 24 * 3600;

  // Judge 1: District Court Vellore — ROLE_JUDGE, level 3, territory Vellore
  await (await c.registerJudge(
    judgeVellore.address, "District Court Vellore", 0, oneYear, 3, vellore, 1
  )).wait();

  // Judge 2: Civil Judge Kadapa — ROLE_JUDGE, level 1 (Munsif), territory Kadapa
  await (await c.registerJudge(
    judgeKadapa.address, "Civil Judge Kadapa", 0, oneYear, 1, kadapa, 1
  )).wait();

  // Clerk 1: District Court Vellore — ROLE_CLERK, level 3, territory Vellore
  await (await c.registerJudge(
    clerkVellore.address, "District Court Vellore Clerk", 0, oneYear, 3, vellore, 2
  )).wait();

  // Clerk 2: Civil Court Kadapa — ROLE_CLERK, level 1, territory Kadapa
  await (await c.registerJudge(
    clerkKadapa.address, "Civil Court Kadapa Clerk", 0, oneYear, 1, kadapa, 2
  )).wait();

  // Admin: Land Registry Authority — ROLE_REGISTRAR, national co-signer authority
  // REGISTRAR is exempt from territorial jurisdiction checks.
  await (await c.registerJudge(
    admin.address, "Land Registry Authority", 0, oneYear, 4, tamilNadu, 3
  )).wait();

  return { c, token, admin, judgeVellore, judgeKadapa, clerkVellore, clerkKadapa,
           outsider, attacker,
           vellore, chennai, tamilNadu, kadapa, andhraPradesh };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Negative Corpus (30 cases)", function () {
  this.timeout(600_000);

  // ── Case 1: Unregistered signer ───────────────────────────────────────────
  // Uses staticCall: Besu's eth_estimateGas can hang when the first signer in
  // a multi-sig array is completely unregistered (cold storage read + early
  // revert), even though the receipt path works on Hardhat.
  it("Case 1 — unregistered signer is rejected", async function () {
    const { c, admin, clerkVellore, outsider } = await deploy();
    // outsider is unregistered; clerkVellore and admin are valid
    const o = await makeOrder([outsider, clerkVellore, admin], 1, "CASE-1", 3600, "freeze", 0);
    let caught = false;
    try {
      await c.submitFreezeOrder.staticCall(1, "CASE-1", o.hash, o.expiry, 0, o.sigs);
    } catch (err) {
      const msg = err.reason || err.shortMessage || err.message || String(err);
      if (!msg.includes("Unregistered or revoked signer")) {
        throw new Error('Expected "Unregistered or revoked signer" but got: ' + msg);
      }
      caught = true;
    }
    if (!caught) throw new Error("Expected revert but staticCall succeeded");
  });

  // ── Case 2: Revoked signer ────────────────────────────────────────────────
  it("Case 2 — revoked signer is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    await (await c.revokeJudge(judgeVellore.address)).wait();
    const o = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-2", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-2", o.hash, o.expiry, 0, o.sigs),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 3: Expired judicial key ──────────────────────────────────────────
  // Uses staticCall: Besu's eth_estimateGas can hang on early-revert paths in
  // the signature loop for certain key validity states.
  it("Case 3 — expired judicial key is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore, vellore } = await deploy();
    const past = Math.floor(Date.now() / 1000) - 100;
    await (await c.registerJudge(
      judgeVellore.address, "District Court Vellore", 0, past, 3, vellore, 1
    )).wait();
    const o = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-3", 3600, "freeze", 0);
    let caught = false;
    try {
      await c.submitFreezeOrder.staticCall(1, "CASE-3", o.hash, o.expiry, 0, o.sigs);
    } catch (err) {
      const msg = err.reason || err.shortMessage || err.message || String(err);
      if (!msg.includes("Judicial key expired or not yet valid")) {
        throw new Error('Expected "Judicial key expired or not yet valid" but got: ' + msg);
      }
      caught = true;
    }
    if (!caught) throw new Error("Expected revert but staticCall succeeded");
  });

  // ── Case 4: Not-yet-valid judicial key ───────────────────────────────────
  // Uses staticCall: Besu's gas estimator hangs on early-revert paths in
  // _validateSignatures.  validFrom is set 24 hours ahead — enough to make
  // the key invalid without the extreme far-future value that could also stall
  // Besu's eth_call simulation.
  it("Case 4 — not-yet-valid judicial key is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore, vellore } = await deploy();
    const future = Math.floor(Date.now() / 1000) + 86400; // 24 h from now
    await (await c.registerJudge(
      judgeVellore.address, "District Court Vellore", future, future + 86400, 3, vellore, 1
    )).wait();
    const o = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-4", 3600, "freeze", 0);
    let caught4 = false;
    try {
      await c.submitFreezeOrder.staticCall(1, "CASE-4", o.hash, o.expiry, 0, o.sigs);
    } catch (err) {
      const msg = err.reason || err.shortMessage || err.message || String(err);
      if (!msg.includes("Judicial key expired or not yet valid")) {
        throw new Error('Expected "Judicial key expired or not yet valid" but got: ' + msg);
      }
      caught4 = true;
    }
    if (!caught4) throw new Error("Expected revert but staticCall succeeded");
  });

  // ── Case 5: Expired order ─────────────────────────────────────────────────
  it("Case 5 — expired order is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) - 1;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-5", 1, expiry, "freeze", 0]
    );
    const hash   = ethers.keccak256(packed);
    const sig1   = await judgeVellore.signMessage(ethers.getBytes(hash));
    const sig2   = await clerkVellore.signMessage(ethers.getBytes(hash));
    const sig3   = await admin.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-5", hash, expiry, 0, [sig1, sig2, sig3]),
      "Order has expired"
    );
  });

  // ── Case 6: Replay attack ─────────────────────────────────────────────────
  it("Case 6 — replay attack is rejected (usedOrders check)", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const o = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-6", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-6", o.hash, o.expiry, 0, o.sigs)).wait();
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-6", o.hash, o.expiry, 0, o.sigs),
      "Order already submitted"
    );
  });

  // ── Case 7: Wrong nonce — skipped ────────────────────────────────────────
  it("Case 7 — skipped nonce is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const o = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-7", 3600, "freeze", 5);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-7", o.hash, o.expiry, 5, o.sigs),
      "Invalid nonce"
    );
  });

  // ── Case 8: Wrong nonce — repeated ───────────────────────────────────────
  it("Case 8 — repeated nonce is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const o1 = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-8a", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-8a", o1.hash, o1.expiry, 0, o1.sigs)).wait();
    const o2 = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-8b", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-8b", o2.hash, o2.expiry, 0, o2.sigs),
      "Invalid nonce"
    );
  });

  // ── Case 9: Wrong jurisdiction — Vellore → Kadapa ────────────────────────
  it("Case 9 — Vellore judge cannot freeze Kadapa property", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    // judgeVellore has territory=vellore; token 3 is in kadapa
    // clerkVellore has territory=vellore; also fails for kadapa
    // admin (REGISTRAR) is territory-exempt and passes
    const o = await makeOrder([judgeVellore, clerkVellore, admin], 3, "CASE-9", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(3, "CASE-9", o.hash, o.expiry, 0, o.sigs),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 10: Wrong jurisdiction — Kadapa → Vellore ───────────────────────
  it("Case 10 — Kadapa judge cannot freeze Vellore property", async function () {
    const { c, admin, judgeKadapa, clerkVellore } = await deploy();
    // judgeKadapa territory=Kadapa; token 1 is in Vellore
    // clerkVellore territory=Vellore — passes for token 1
    // But judgeKadapa fails first (checked in loop order)
    const o = await makeOrder([judgeKadapa, clerkVellore, admin], 1, "CASE-10", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-10", o.hash, o.expiry, 0, o.sigs),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 11: Tampered hash ───────────────────────────────────────────────
  it("Case 11 — tampered hash causes unregistered-signer rejection", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const { expiry, sigs } = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-11", 3600, "freeze", 0
    );
    const tamperedData = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-11", 2, expiry, "freeze", 0]
    );
    const tamperedHash = ethers.keccak256(tamperedData);
    await expectRevert(
      c.submitFreezeOrder(2, "CASE-11", tamperedHash, expiry, 0, sigs),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 12: Empty signature ─────────────────────────────────────────────
  it("Case 12 — empty signature is rejected", async function () {
    const { c, admin, clerkVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-12", 1, expiry, "freeze", 0]
    );
    const hash      = ethers.keccak256(packed);
    const clerkSig  = await clerkVellore.signMessage(ethers.getBytes(hash));
    const adminSig  = await admin.signMessage(ethers.getBytes(hash));
    // 3 sigs, first one is empty — fails at recovery
    await expectAnyRevert(
      c.submitFreezeOrder(1, "CASE-12", hash, expiry, 0, ["0x", clerkSig, adminSig])
    );
  });

  // ── Case 13: Malformed signature ─────────────────────────────────────────
  it("Case 13 — malformed signature (63 bytes) is rejected", async function () {
    const { c, admin, clerkVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-13", 1, expiry, "freeze", 0]
    );
    const hash     = ethers.keccak256(packed);
    const badSig   = "0x" + "ab".repeat(63);
    const clerkSig = await clerkVellore.signMessage(ethers.getBytes(hash));
    const adminSig = await admin.signMessage(ethers.getBytes(hash));
    await expectAnyRevert(
      c.submitFreezeOrder(1, "CASE-13", hash, expiry, 0, [badSig, clerkSig, adminSig])
    );
  });

  // ── Case 14: Zero address recovery ──────────────────────────────────────
  it("Case 14 — signature recovering to zero address is rejected", async function () {
    const { c, admin, clerkVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-14", 1, expiry, "freeze", 0]
    );
    const hash     = ethers.keccak256(packed);
    const zeroSig  = "0x" + "00".repeat(64) + "1b"; // v=27, r=0, s=0
    const clerkSig = await clerkVellore.signMessage(ethers.getBytes(hash));
    const adminSig = await admin.signMessage(ethers.getBytes(hash));
    await expectAnyRevert(
      c.submitFreezeOrder(1, "CASE-14", hash, expiry, 0, [zeroSig, clerkSig, adminSig])
    );
  });

  // ── Case 15: Freeze already-frozen token ─────────────────────────────────
  // Design decision: a second authenticated freeze IS accepted (dual-court freeze).
  it("Case 15 — freezing an already-frozen token is accepted (dual-court freeze)", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const o1 = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-15a", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-15a", o1.hash, o1.expiry, 0, o1.sigs)).wait();

    expect(await c.frozen(1)).to.equal(true);

    const o2 = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-15b", 3600, "freeze", 1);
    await (await c.submitFreezeOrder(1, "CASE-15b", o2.hash, o2.expiry, 1, o2.sigs)).wait();

    expect(await c.frozenBy(1)).to.equal("CASE-15b");
    expect(await c.getFreezeHistoryLength(1)).to.equal(2n);
  });

  // ── Case 16: Unfreeze non-frozen token ───────────────────────────────────
  it("Case 16 — unfreezing a non-frozen token is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const o = await makeOrder([judgeVellore, clerkVellore, admin], 1, "CASE-16", 3600, "unfreeze", 0);
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-16", o.hash, o.expiry, 0, o.sigs),
      "Token is not frozen"
    );
  });

  // ── Case 17: Unfreeze — wrong jurisdiction ───────────────────────────────
  it("Case 17 — Kadapa judge cannot unfreeze Vellore property", async function () {
    const { c, admin, judgeVellore, judgeKadapa, clerkVellore } = await deploy();
    const fo = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-17-freeze", 3600, "freeze", 0
    );
    await (await c.submitFreezeOrder(1, "CASE-17-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();
    // judgeKadapa has territory=Kadapa, token 1 is Vellore → jurisdiction fail
    const uo = await makeOrder(
      [judgeKadapa, clerkVellore, admin], 1, "CASE-17-unfreeze", 3600, "unfreeze", 0
    );
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-17-unfreeze", uo.hash, uo.expiry, 0, uo.sigs),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 18: Unfreeze — revoked signer ───────────────────────────────────
  it("Case 18 — revoked signer cannot unfreeze", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const fo = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-18-freeze", 3600, "freeze", 0
    );
    await (await c.submitFreezeOrder(1, "CASE-18-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();
    await (await c.revokeJudge(judgeVellore.address)).wait();
    const uo = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-18-unfreeze", 3600, "unfreeze", 1
    );
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-18-unfreeze", uo.hash, uo.expiry, 1, uo.sigs),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 19: Unfreeze replay ─────────────────────────────────────────────
  it("Case 19 — unfreeze replay is rejected (usedOrders check)", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const fo = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-19-freeze", 3600, "freeze", 0
    );
    await (await c.submitFreezeOrder(1, "CASE-19-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();

    const uo = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-19-unfreeze", 3600, "unfreeze", 1
    );
    await (await c.submitUnfreezeOrder(1, "CASE-19-unfreeze", uo.hash, uo.expiry, 1, uo.sigs)).wait();

    const fo2 = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-19-freeze2", 3600, "freeze", 2
    );
    await (await c.submitFreezeOrder(1, "CASE-19-freeze2", fo2.hash, fo2.expiry, 2, fo2.sigs)).wait();

    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-19-unfreeze", uo.hash, uo.expiry, 1, uo.sigs),
      "Order already submitted"
    );
  });

  // ── Case 20: Wrong nonce on unfreeze ─────────────────────────────────────
  it("Case 20 — wrong nonce on unfreeze is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const fo = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-20-freeze", 3600, "freeze", 0
    );
    await (await c.submitFreezeOrder(1, "CASE-20-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();
    const uo = await makeOrder(
      [judgeVellore, clerkVellore, admin], 1, "CASE-20-unfreeze", 3600, "unfreeze", 99
    );
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-20-unfreeze", uo.hash, uo.expiry, 99, uo.sigs),
      "Invalid nonce"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // New cases: Step 1 (multi-signer quorum) + Step 2 (pecuniary jurisdiction)
  //            + Step 3 (ERC-3643 agent enforcement)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Case 21: Missing co-signer (only JUDGE — below quorum) ───────────────
  it("Case 21 — missing co-signer: only JUDGE signature is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    // Only one signature — below quorumThreshold (3)
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-21", 1, expiry, "freeze", 0]
    );
    const hash = ethers.keccak256(packed);
    const sig  = await judgeVellore.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-21", hash, expiry, 0, [sig]),
      "Signatures below quorum threshold"
    );
  });

  // ── Case 22: Duplicate signer ─────────────────────────────────────────────
  it("Case 22 — duplicate signer is rejected", async function () {
    const { c, admin, judgeVellore, clerkVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-22", 1, expiry, "freeze", 0]
    );
    const hash      = ethers.keccak256(packed);
    const judgeSig  = await judgeVellore.signMessage(ethers.getBytes(hash));
    const clerkSig  = await clerkVellore.signMessage(ethers.getBytes(hash));
    // Third sig is a duplicate of first (judgeVellore signs twice)
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-22", hash, expiry, 0, [judgeSig, clerkSig, judgeSig]),
      "Duplicate signer"
    );
  });

  // ── Case 23: Wrong role — no JUDGE in the signature set ──────────────────
  it("Case 23 — no JUDGE role among signers is rejected", async function () {
    const { c, admin, clerkVellore, outsider, vellore } = await deploy();
    const now = Math.floor(Date.now() / 1000);
    // Register outsider as ROLE_CLERK — a second CLERK
    await (await c.registerJudge(
      outsider.address, "Vellore Court Clerk 2", 0, now + 86400, 3, vellore, 2
    )).wait();
    // Three valid signers: REGISTRAR + CLERK + CLERK — no JUDGE
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-23", 1, expiry, "freeze", 0]
    );
    const hash       = ethers.keccak256(packed);
    const adminSig   = await admin.signMessage(ethers.getBytes(hash));
    const clerkSig   = await clerkVellore.signMessage(ethers.getBytes(hash));
    const outsiderSig = await outsider.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-23", hash, expiry, 0, [adminSig, clerkSig, outsiderSig]),
      "At least one JUDGE signature required"
    );
  });

  // ── Case 24: Empty signatures array ──────────────────────────────────────
  it("Case 24 — empty signatures array is rejected", async function () {
    const { c } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-24", 1, expiry, "freeze", 0]
    );
    const hash = ethers.keccak256(packed);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-24", hash, expiry, 0, []),
      "Signatures below quorum threshold"
    );
  });

  // ── Case 25: Declared value above court pecuniary limit ───────────────────
  it("Case 25 — declared value above court pecuniary limit is rejected", async function () {
    const { c, admin, judgeKadapa, clerkKadapa } = await deploy();
    // judgeKadapa is Munsif (level 1, max ₹3 lakh)
    // Override token 3's declared value to ₹50 lakh — exceeds the limit
    await (await c.setParcelDeclaredValue(3, 5_000_000)).wait();
    const o = await makeOrder([judgeKadapa, clerkKadapa, admin], 3, "CASE-25", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(3, "CASE-25", o.hash, o.expiry, 0, o.sigs),
      "Parcel value exceeds court pecuniary limit"
    );
  });

  // ── Case 26: Token freeze not callable by a non-agent ────────────────────
  it("Case 26 — ParcelToken.setAddressFrozen reverts when caller is not agent", async function () {
    const { token, outsider } = await deploy();
    const addr = "0x000000000000000000000000000000000000dEaD";
    await expectRevert(
      token.connect(outsider).setAddressFrozen(addr, true),
      "ParcelToken: caller is not agent"
    );
  });

  // ── Case 27: Three-signer submit path — happy path with demo-style wallets ─
  //
  // Covers the full freeze → unfreeze lifecycle using freshly created wallets
  // (same pattern as scripts/setup-demo-wallets.js) rather than the Hardhat
  // deterministic accounts used in all other cases.  This gives the demo flow
  // direct automated test coverage.
  //
  // Sprint 0b: three signers — JUDGE + CLERK + REGISTRAR (admin).
  it("Case 27 — three-signer submit succeeds with demo-style random wallets", async function () {
    const { c, token, admin } = await deploy();

    // Create fresh random wallets, fund them from admin, and wire them up
    const provider = ethers.provider;
    const judgeW = ethers.Wallet.createRandom().connect(provider);
    const clerkW = ethers.Wallet.createRandom().connect(provider);

    // Fund with enough for gas
    await (await admin.sendTransaction({ to: judgeW.address, value: ethers.parseEther("1") })).wait();
    await (await admin.sendTransaction({ to: clerkW.address, value: ethers.parseEther("1") })).wait();

    // Register the fresh wallets in the registry
    const vellore = ethers.keccak256(ethers.toUtf8Bytes("vellore"));
    const now     = Math.floor(Date.now() / 1000);
    await (await c.registerJudge(judgeW.address, "Demo District Court",  0, now + 86400, 3, vellore, 1)).wait();
    await (await c.registerJudge(clerkW.address,  "Demo Clerk Office",   0, now + 86400, 3, vellore, 2)).wait();
    // admin is already ROLE_REGISTRAR from the fixture

    // Build and sign the freeze order (JUDGE + CLERK + REGISTRAR)
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["DEMO-CASE-27", 1, expiry, "freeze", 0]
    );
    const orderHash = ethers.keccak256(packed);
    const judgeSig  = await judgeW.signMessage(ethers.getBytes(orderHash));
    const clerkSig  = await clerkW.signMessage(ethers.getBytes(orderHash));
    const adminSig  = await admin.signMessage(ethers.getBytes(orderHash));

    // Submit — must succeed
    const tx = await c.connect(judgeW).submitFreezeOrder(
      1, "DEMO-CASE-27", orderHash, expiry, 0, [judgeSig, clerkSig, adminSig]
    );
    await tx.wait();

    // Verify token is frozen and signers are recorded
    const isFrozen = await c.frozen(1);
    if (!isFrozen) throw new Error("Token should be frozen after three-signer submit");

    const [signers, roles] = await c.getFreezeHistorySigners(1, 0);
    if (signers.length !== 3) throw new Error(`Expected 3 signers recorded, got ${signers.length}`);

    // Unfreeze with new nonce (judgeW nonce is now 1)
    const packed2 = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["DEMO-CASE-27-UNFREEZE", 1, expiry, "unfreeze", 1]
    );
    const hash2     = ethers.keccak256(packed2);
    const judgeSig2 = await judgeW.signMessage(ethers.getBytes(hash2));
    const clerkSig2 = await clerkW.signMessage(ethers.getBytes(hash2));
    const adminSig2 = await admin.signMessage(ethers.getBytes(hash2));

    const tx2 = await c.connect(judgeW).submitUnfreezeOrder(
      1, "DEMO-CASE-27-UNFREEZE", hash2, expiry, 1, [judgeSig2, clerkSig2, adminSig2]
    );
    await tx2.wait();

    const afterUnfreeze = await c.frozen(1);
    if (afterUnfreeze) throw new Error("Token should be unfrozen after unfreeze order");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Sprint 0b new cases: three-signer quorum negative paths
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Case 28: Missing CLERK (JUDGE + REGISTRAR × 2, no CLERK) ─────────────
  it("Case 28 — missing CLERK: JUDGE + two REGISTRARs is rejected", async function () {
    const { c, admin, judgeVellore, outsider, tamilNadu } = await deploy();
    const now = Math.floor(Date.now() / 1000);
    // Register outsider as ROLE_REGISTRAR (territory-exempt, like admin)
    await (await c.registerJudge(
      outsider.address, "National Registry Authority 2", 0, now + 86400, 4, tamilNadu, 3
    )).wait();
    // Three valid signers: JUDGE + REGISTRAR + REGISTRAR — no CLERK
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-28", 1, expiry, "freeze", 0]
    );
    const hash        = ethers.keccak256(packed);
    const judgeSig    = await judgeVellore.signMessage(ethers.getBytes(hash));
    const adminSig    = await admin.signMessage(ethers.getBytes(hash));
    const outsiderSig = await outsider.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-28", hash, expiry, 0, [judgeSig, adminSig, outsiderSig]),
      "At least one CLERK signature required"
    );
  });

  // ── Case 29: Missing REGISTRAR (JUDGE + two CLERKs, no REGISTRAR) ────────
  it("Case 29 — missing REGISTRAR: JUDGE + two CLERKs is rejected", async function () {
    const { c, judgeVellore, clerkVellore, outsider, vellore } = await deploy();
    const now = Math.floor(Date.now() / 1000);
    // Register outsider as ROLE_CLERK, territory Vellore
    await (await c.registerJudge(
      outsider.address, "Vellore Clerk 2", 0, now + 86400, 3, vellore, 2
    )).wait();
    // Three valid signers: JUDGE + CLERK + CLERK — no REGISTRAR
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-29", 1, expiry, "freeze", 0]
    );
    const hash        = ethers.keccak256(packed);
    const judgeSig    = await judgeVellore.signMessage(ethers.getBytes(hash));
    const clerkSig    = await clerkVellore.signMessage(ethers.getBytes(hash));
    const outsiderSig = await outsider.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-29", hash, expiry, 0, [judgeSig, clerkSig, outsiderSig]),
      "At least one REGISTRAR signature required"
    );
  });

  // ── Case 30: Two JUDGEs, no CLERK (JUDGE + JUDGE + REGISTRAR) ────────────
  it("Case 30 — two JUDGEs with no CLERK is rejected", async function () {
    const { c, admin, judgeVellore, outsider, vellore } = await deploy();
    const now = Math.floor(Date.now() / 1000);
    // Register outsider as ROLE_JUDGE, territory Vellore
    await (await c.registerJudge(
      outsider.address, "District Court Vellore 2", 0, now + 86400, 3, vellore, 1
    )).wait();
    // Three valid signers: JUDGE + JUDGE + REGISTRAR — no CLERK
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-30", 1, expiry, "freeze", 0]
    );
    const hash        = ethers.keccak256(packed);
    const judgeSig    = await judgeVellore.signMessage(ethers.getBytes(hash));
    const outsiderSig = await outsider.signMessage(ethers.getBytes(hash));
    const adminSig    = await admin.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-30", hash, expiry, 0, [judgeSig, outsiderSig, adminSig]),
      "At least one CLERK signature required"
    );
  });

});
