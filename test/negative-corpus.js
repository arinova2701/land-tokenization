/**
 * Negative Corpus — CourtKeyRegistry + ParcelToken
 * 26 test cases: 20 original rejection paths + 6 new (Steps 1–3 additions).
 *
 * Run on Hardhat (fast):
 *   npx hardhat test test/negative-corpus.js
 *
 * Run on Besu (slow — 2s block time × ~10 tx/setup × 26 tests ≈ 13 min):
 *   npx hardhat test test/negative-corpus.js --network besu
 *
 * Design note on case 15 (freeze already-frozen token):
 *   The contract does NOT prevent re-freezing a token that is already frozen.
 *   A second authenticated freeze order for an already-frozen token is accepted.
 *   This is intentional: multiple court orders can independently freeze the same
 *   property (e.g. different creditors), and the contract records every order in
 *   freezeHistory.  frozenBy is updated to the latest case number.
 *
 * Multi-signer quorum (Step 1):
 *   Every valid order requires at least 1 JUDGE + 1 CLERK/REGISTRAR signature.
 *   The fixture registers admin as ROLE_REGISTRAR (national authority, no territory
 *   restriction) so that all 20 existing tests can co-sign with admin without
 *   adding more funded accounts.
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
 *                            Typically [judgeXxx, admin] for valid orders,
 *                            or a subset for negative-path tests.
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
  const [admin, judgeVellore, judgeKadapa, outsider, attacker] =
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

  // Admin: Land Registry Authority — ROLE_REGISTRAR, national co-signer authority
  // REGISTRAR is exempt from territorial jurisdiction checks.
  await (await c.registerJudge(
    admin.address, "Land Registry Authority", 0, oneYear, 4, tamilNadu, 3
  )).wait();

  return { c, token, admin, judgeVellore, judgeKadapa, outsider, attacker,
           vellore, chennai, tamilNadu, kadapa, andhraPradesh };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Negative Corpus (26 cases)", function () {
  this.timeout(600_000);

  // ── Case 1: Unregistered signer ───────────────────────────────────────────
  it("Case 1 — unregistered signer is rejected", async function () {
    const { c, admin, outsider } = await deploy();
    // outsider is unregistered; admin is valid REGISTRAR co-signer
    const o = await makeOrder([outsider, admin], 1, "CASE-1", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-1", o.hash, o.expiry, 0, o.sigs),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 2: Revoked signer ────────────────────────────────────────────────
  it("Case 2 — revoked signer is rejected", async function () {
    const { c, admin, judgeVellore } = await deploy();
    await (await c.revokeJudge(judgeVellore.address)).wait();
    const o = await makeOrder([judgeVellore, admin], 1, "CASE-2", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-2", o.hash, o.expiry, 0, o.sigs),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 3: Expired judicial key ──────────────────────────────────────────
  it("Case 3 — expired judicial key is rejected", async function () {
    const { c, admin, judgeVellore, vellore } = await deploy();
    const past = Math.floor(Date.now() / 1000) - 100;
    await (await c.registerJudge(
      judgeVellore.address, "District Court Vellore", 0, past, 3, vellore, 1
    )).wait();
    const o = await makeOrder([judgeVellore, admin], 1, "CASE-3", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-3", o.hash, o.expiry, 0, o.sigs),
      "Judicial key expired or not yet valid"
    );
  });

  // ── Case 4: Not-yet-valid judicial key ───────────────────────────────────
  it("Case 4 — not-yet-valid judicial key is rejected", async function () {
    const { c, admin, judgeVellore, vellore } = await deploy();
    const future = Math.floor(Date.now() / 1000) + 9999999;
    await (await c.registerJudge(
      judgeVellore.address, "District Court Vellore", future, future + 1, 3, vellore, 1
    )).wait();
    const o = await makeOrder([judgeVellore, admin], 1, "CASE-4", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-4", o.hash, o.expiry, 0, o.sigs),
      "Judicial key expired or not yet valid"
    );
  });

  // ── Case 5: Expired order ─────────────────────────────────────────────────
  it("Case 5 — expired order is rejected", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) - 1;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-5", 1, expiry, "freeze", 0]
    );
    const hash   = ethers.keccak256(packed);
    const sig1   = await judgeVellore.signMessage(ethers.getBytes(hash));
    const sig2   = await admin.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-5", hash, expiry, 0, [sig1, sig2]),
      "Order has expired"
    );
  });

  // ── Case 6: Replay attack ─────────────────────────────────────────────────
  it("Case 6 — replay attack is rejected (usedOrders check)", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const o = await makeOrder([judgeVellore, admin], 1, "CASE-6", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-6", o.hash, o.expiry, 0, o.sigs)).wait();
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-6", o.hash, o.expiry, 0, o.sigs),
      "Order already submitted"
    );
  });

  // ── Case 7: Wrong nonce — skipped ────────────────────────────────────────
  it("Case 7 — skipped nonce is rejected", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const o = await makeOrder([judgeVellore, admin], 1, "CASE-7", 3600, "freeze", 5);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-7", o.hash, o.expiry, 5, o.sigs),
      "Invalid nonce"
    );
  });

  // ── Case 8: Wrong nonce — repeated ───────────────────────────────────────
  it("Case 8 — repeated nonce is rejected", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const o1 = await makeOrder([judgeVellore, admin], 1, "CASE-8a", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-8a", o1.hash, o1.expiry, 0, o1.sigs)).wait();
    const o2 = await makeOrder([judgeVellore, admin], 1, "CASE-8b", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-8b", o2.hash, o2.expiry, 0, o2.sigs),
      "Invalid nonce"
    );
  });

  // ── Case 9: Wrong jurisdiction — Vellore → Kadapa ────────────────────────
  it("Case 9 — Vellore judge cannot freeze Kadapa property", async function () {
    const { c, admin, judgeVellore } = await deploy();
    // judgeVellore has territory=vellore; token 3 is in kadapa
    // admin (REGISTRAR) is territory-exempt and passes
    const o = await makeOrder([judgeVellore, admin], 3, "CASE-9", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(3, "CASE-9", o.hash, o.expiry, 0, o.sigs),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 10: Wrong jurisdiction — Kadapa → Vellore ───────────────────────
  it("Case 10 — Kadapa judge cannot freeze Vellore property", async function () {
    const { c, admin, judgeKadapa } = await deploy();
    const o = await makeOrder([judgeKadapa, admin], 1, "CASE-10", 3600, "freeze", 0);
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-10", o.hash, o.expiry, 0, o.sigs),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 11: Tampered hash ───────────────────────────────────────────────
  it("Case 11 — tampered hash causes unregistered-signer rejection", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const { expiry, sigs } = await makeOrder([judgeVellore, admin], 1, "CASE-11", 3600, "freeze", 0);
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
    const { c, admin } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-12", 1, expiry, "freeze", 0]
    );
    const hash    = ethers.keccak256(packed);
    const adminSig = await admin.signMessage(ethers.getBytes(hash));
    await expectAnyRevert(
      c.submitFreezeOrder(1, "CASE-12", hash, expiry, 0, ["0x", adminSig])
    );
  });

  // ── Case 13: Malformed signature ─────────────────────────────────────────
  it("Case 13 — malformed signature (63 bytes) is rejected", async function () {
    const { c, admin } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-13", 1, expiry, "freeze", 0]
    );
    const hash    = ethers.keccak256(packed);
    const badSig  = "0x" + "ab".repeat(63);
    const adminSig = await admin.signMessage(ethers.getBytes(hash));
    await expectAnyRevert(
      c.submitFreezeOrder(1, "CASE-13", hash, expiry, 0, [badSig, adminSig])
    );
  });

  // ── Case 14: Zero address recovery ──────────────────────────────────────
  it("Case 14 — signature recovering to zero address is rejected", async function () {
    const { c, admin } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-14", 1, expiry, "freeze", 0]
    );
    const hash    = ethers.keccak256(packed);
    const zeroSig = "0x" + "00".repeat(64) + "1b"; // v=27, r=0, s=0
    const adminSig = await admin.signMessage(ethers.getBytes(hash));
    await expectAnyRevert(
      c.submitFreezeOrder(1, "CASE-14", hash, expiry, 0, [zeroSig, adminSig])
    );
  });

  // ── Case 15: Freeze already-frozen token ─────────────────────────────────
  // Design decision: a second authenticated freeze IS accepted (dual-court freeze).
  it("Case 15 — freezing an already-frozen token is accepted (dual-court freeze)", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const o1 = await makeOrder([judgeVellore, admin], 1, "CASE-15a", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-15a", o1.hash, o1.expiry, 0, o1.sigs)).wait();

    expect(await c.frozen(1)).to.equal(true);

    const o2 = await makeOrder([judgeVellore, admin], 1, "CASE-15b", 3600, "freeze", 1);
    await (await c.submitFreezeOrder(1, "CASE-15b", o2.hash, o2.expiry, 1, o2.sigs)).wait();

    expect(await c.frozenBy(1)).to.equal("CASE-15b");
    expect(await c.getFreezeHistoryLength(1)).to.equal(2n);
  });

  // ── Case 16: Unfreeze non-frozen token ───────────────────────────────────
  it("Case 16 — unfreezing a non-frozen token is rejected", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const o = await makeOrder([judgeVellore, admin], 1, "CASE-16", 3600, "unfreeze", 0);
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-16", o.hash, o.expiry, 0, o.sigs),
      "Token is not frozen"
    );
  });

  // ── Case 17: Unfreeze — wrong jurisdiction ───────────────────────────────
  it("Case 17 — Kadapa judge cannot unfreeze Vellore property", async function () {
    const { c, admin, judgeVellore, judgeKadapa } = await deploy();
    const fo = await makeOrder([judgeVellore, admin], 1, "CASE-17-freeze", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-17-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();
    const uo = await makeOrder([judgeKadapa, admin], 1, "CASE-17-unfreeze", 3600, "unfreeze", 0);
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-17-unfreeze", uo.hash, uo.expiry, 0, uo.sigs),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 18: Unfreeze — revoked signer ───────────────────────────────────
  it("Case 18 — revoked signer cannot unfreeze", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const fo = await makeOrder([judgeVellore, admin], 1, "CASE-18-freeze", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-18-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();
    await (await c.revokeJudge(judgeVellore.address)).wait();
    const uo = await makeOrder([judgeVellore, admin], 1, "CASE-18-unfreeze", 3600, "unfreeze", 1);
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-18-unfreeze", uo.hash, uo.expiry, 1, uo.sigs),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 19: Unfreeze replay ─────────────────────────────────────────────
  it("Case 19 — unfreeze replay is rejected (usedOrders check)", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const fo = await makeOrder([judgeVellore, admin], 1, "CASE-19-freeze", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-19-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();

    const uo = await makeOrder([judgeVellore, admin], 1, "CASE-19-unfreeze", 3600, "unfreeze", 1);
    await (await c.submitUnfreezeOrder(1, "CASE-19-unfreeze", uo.hash, uo.expiry, 1, uo.sigs)).wait();

    const fo2 = await makeOrder([judgeVellore, admin], 1, "CASE-19-freeze2", 3600, "freeze", 2);
    await (await c.submitFreezeOrder(1, "CASE-19-freeze2", fo2.hash, fo2.expiry, 2, fo2.sigs)).wait();

    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-19-unfreeze", uo.hash, uo.expiry, 1, uo.sigs),
      "Order already submitted"
    );
  });

  // ── Case 20: Wrong nonce on unfreeze ─────────────────────────────────────
  it("Case 20 — wrong nonce on unfreeze is rejected", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const fo = await makeOrder([judgeVellore, admin], 1, "CASE-20-freeze", 3600, "freeze", 0);
    await (await c.submitFreezeOrder(1, "CASE-20-freeze", fo.hash, fo.expiry, 0, fo.sigs)).wait();
    const uo = await makeOrder([judgeVellore, admin], 1, "CASE-20-unfreeze", 3600, "unfreeze", 99);
    await expectRevert(
      c.submitUnfreezeOrder(1, "CASE-20-unfreeze", uo.hash, uo.expiry, 99, uo.sigs),
      "Invalid nonce"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // New cases: Step 1 (multi-signer quorum) + Step 2 (pecuniary jurisdiction)
  //            + Step 3 (ERC-3643 agent enforcement)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Case 21: Missing co-signer (only JUDGE, no CLERK/REGISTRAR) ──────────
  it("Case 21 — missing co-signer: only JUDGE signature is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    // Only one signature — below quorumThreshold (2)
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
    const { c, judgeVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-22", 1, expiry, "freeze", 0]
    );
    const hash = ethers.keccak256(packed);
    const sig  = await judgeVellore.signMessage(ethers.getBytes(hash));
    // Same signer twice — count meets threshold but duplicate check fires
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-22", hash, expiry, 0, [sig, sig]),
      "Duplicate signer"
    );
  });

  // ── Case 23: Wrong role — no JUDGE in the signature set ──────────────────
  it("Case 23 — no JUDGE role among signers is rejected", async function () {
    const { c, admin, outsider, vellore } = await deploy();
    const now = Math.floor(Date.now() / 1000);
    // Register outsider as ROLE_CLERK (not a JUDGE)
    await (await c.registerJudge(
      outsider.address, "Vellore Court Clerk", 0, now + 86400, 3, vellore, 2
    )).wait();
    // Two valid signers: REGISTRAR + CLERK — no JUDGE
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-23", 1, expiry, "freeze", 0]
    );
    const hash    = ethers.keccak256(packed);
    const adminSig   = await admin.signMessage(ethers.getBytes(hash));
    const outsiderSig = await outsider.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.submitFreezeOrder(1, "CASE-23", hash, expiry, 0, [adminSig, outsiderSig]),
      "At least one JUDGE signature required"
    );
  });

  // ── Case 24: Empty signatures array (threshold = 0 < 2) ──────────────────
  it("Case 24 — empty signatures array is rejected", async function () {
    const { c, judgeVellore } = await deploy();
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
    const { c, admin, judgeKadapa } = await deploy();
    // judgeKadapa is Munsif (level 1, max ₹3 lakh)
    // Override token 3's declared value to ₹50 lakh — exceeds the limit
    await (await c.setParcelDeclaredValue(3, 5_000_000)).wait();
    const o = await makeOrder([judgeKadapa, admin], 3, "CASE-25", 3600, "freeze", 0);
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

});
