/**
 * Negative Corpus — CourtKeyRegistry
 * 20 test cases covering every rejection path.
 *
 * Run on Hardhat (fast):
 *   npx hardhat test test/negative-corpus.js
 *
 * Run on Besu (slow — 2s block time × ~10 tx/setup × 20 tests ≈ 10 min):
 *   npx hardhat test test/negative-corpus.js --network besu
 *
 * Design note on case 15 (freeze already-frozen token):
 *   The contract does NOT prevent re-freezing a token that is already frozen.
 *   A second authenticated freeze order for an already-frozen token is accepted.
 *   This is intentional: multiple court orders can independently freeze the same
 *   property (e.g. different creditors), and the contract records every order in
 *   freezeHistory. frozenBy is updated to the latest case number.
 *
 * Network compatibility note:
 *   hardhat-chai-matchers `revertedWith` works only on Hardhat's in-process chain.
 *   On Besu (and other external JSON-RPC providers) Besu returns revert data as
 *   `{"code":3,"message":"Execution reverted","data":"0x"}` — the reason string is
 *   not included in the eth_call response, so the chai matcher sees no revert.
 *   We use a network-agnostic expectRevert() helper instead, which submits the
 *   transaction, waits for the receipt, and checks the revert reason from the
 *   receipt's revertReason field (Besu) or from the thrown error (Hardhat).
 */

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

// ─── Network-agnostic revert assertion ────────────────────────────────────────

/**
 * Submit a transaction and assert it reverts with the given reason string.
 * Works on both the in-process Hardhat network and external nodes (Besu).
 *
 * @param {Promise} txPromise  - the contract call (NOT yet awaited)
 * @param {string}  reason     - substring expected in the revert message
 */
async function expectRevert(txPromise, reason) {
  let tx, receipt;
  try {
    tx = await txPromise;
    receipt = await tx.wait();
  } catch (err) {
    // The call threw before mining (Hardhat in-process, eth_call simulation, or
    // Besu txpool rejection).  Extract the reason string from wherever ethers
    // embeds it.
    const msg = err.reason || err.shortMessage || err.message || String(err);
    if (reason && !msg.includes(reason)) {
      throw new Error(
        `Expected revert reason to include "${reason}" but got:\n  ${msg}`
      );
    }
    return; // ✓ reverted with expected reason
  }

  // Transaction was mined — check if Besu flagged it as reverted in the receipt.
  if (receipt && receipt.status === 0) {
    // Besu puts the decoded reason in receipt.revertReason (ethers v6 parses it).
    const besuReason = receipt.revertReason || "";
    if (reason && !besuReason.includes(reason)) {
      // Fall back: call eth_call to get the reason
      const callReason = await getRevertReason(tx);
      if (reason && !callReason.includes(reason)) {
        throw new Error(
          `Expected revert reason "${reason}" but receipt shows: "${besuReason}" / call: "${callReason}"`
        );
      }
    }
    return; // ✓ reverted with (approximately) expected reason
  }

  throw new Error(
    `Expected transaction to revert with "${reason}", but it succeeded (status=1)`
  );
}

/**
 * Assert any revert (no specific reason check).
 */
async function expectAnyRevert(txPromise) {
  let tx, receipt;
  try {
    tx = await txPromise;
    receipt = await tx.wait();
  } catch (_) {
    return; // ✓ threw
  }
  if (receipt && receipt.status === 0) return; // ✓ reverted on-chain
  throw new Error("Expected transaction to revert, but it succeeded");
}

/**
 * Re-simulate a mined-but-reverted tx via eth_call to extract the reason string.
 * Used as a fallback when the receipt revertReason is empty.
 */
async function getRevertReason(tx) {
  try {
    const provider = ethers.provider;
    await provider.call({
      to:    tx.to,
      from:  tx.from,
      data:  tx.data,
      value: tx.value,
    });
    return ""; // simulation passed — no reason
  } catch (e) {
    return e.reason || e.shortMessage || e.message || "";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function territoryCode(name) {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

async function makeOrder(signer, tokenId, caseNumber, expiryOffset, action, nonce) {
  const expiry = Math.floor(Date.now() / 1000) + expiryOffset;
  const packed = ethers.solidityPacked(
    ["string", "uint256", "uint256", "string", "uint256"],
    [caseNumber, tokenId, expiry, action, nonce]
  );
  const hash = ethers.keccak256(packed);
  const sig  = await signer.signMessage(ethers.getBytes(hash));
  return { hash, expiry, sig };
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

async function deploy() {
  const [admin, judgeVellore, judgeKadapa, outsider, attacker] =
    await ethers.getSigners();

  const Factory = await ethers.getContractFactory("CourtKeyRegistry");
  const c = await Factory.deploy();
  await c.waitForDeployment(); // explicit wait — needed on Besu (2s block time)

  const vellore       = territoryCode("vellore");
  const chennai       = territoryCode("chennai");
  const tamilNadu     = territoryCode("tamil_nadu");
  const kadapa        = territoryCode("kadapa");
  const andhraPradesh = territoryCode("andhra_pradesh");

  // Wait for every setup tx so the chain state is consistent before the test
  // runs its assertions.  On Hardhat this is instant; on Besu each .wait() costs
  // ~2 s.  Without these waits, eth_call / eth_sendRawTransaction can race
  // against pending setup txs, causing nonce desync on live networks.
  await (await c.setTerritory(tamilNadu,     "Tamil Nadu",     ethers.ZeroHash)).wait();
  await (await c.setTerritory(vellore,       "Vellore",        tamilNadu)).wait();
  await (await c.setTerritory(chennai,       "Chennai",        tamilNadu)).wait();
  await (await c.setTerritory(andhraPradesh, "Andhra Pradesh", ethers.ZeroHash)).wait();
  await (await c.setTerritory(kadapa,        "Kadapa",         andhraPradesh)).wait();

  await (await c.registerProperty(1, vellore)).wait();
  await (await c.registerProperty(2, chennai)).wait();
  await (await c.registerProperty(3, kadapa)).wait();

  const now     = Math.floor(Date.now() / 1000);
  const oneYear = now + 365 * 24 * 3600;

  await (await c.registerJudge(
    judgeVellore.address, "District Court Vellore", 0, oneYear, 3, vellore
  )).wait();
  await (await c.registerJudge(
    judgeKadapa.address, "Civil Judge Kadapa", 0, oneYear, 1, kadapa
  )).wait();

  return { c, admin, judgeVellore, judgeKadapa, outsider, attacker,
           vellore, chennai, tamilNadu, kadapa, andhraPradesh };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Negative Corpus (20 cases)", function () {
  // 10 min per test — each Besu block is 2s and some tests submit many tx
  this.timeout(600_000);

  // ── Case 1: Unregistered signer ────────────────────────────────────────────
  it("Case 1 — unregistered signer is rejected", async function () {
    const { c, outsider } = await deploy();
    const { hash, expiry, sig } = await makeOrder(outsider, 1, "CASE-1", 3600, "freeze", 0);
    await expectRevert(
      c.connect(outsider).submitFreezeOrder(1, "CASE-1", hash, expiry, 0, sig),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 2: Revoked signer ─────────────────────────────────────────────────
  it("Case 2 — revoked signer is rejected", async function () {
    const { c, admin, judgeVellore } = await deploy();
    await (await c.connect(admin).revokeJudge(judgeVellore.address)).wait();
    const { hash, expiry, sig } = await makeOrder(judgeVellore, 1, "CASE-2", 3600, "freeze", 0);
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-2", hash, expiry, 0, sig),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 3: Expired judicial key ───────────────────────────────────────────
  it("Case 3 — expired judicial key is rejected", async function () {
    const { c, admin, judgeVellore, vellore } = await deploy();
    const past = Math.floor(Date.now() / 1000) - 100;
    await (await c.connect(admin).registerJudge(
      judgeVellore.address, "District Court Vellore", 0, past, 3, vellore
    )).wait();
    const { hash, expiry, sig } = await makeOrder(judgeVellore, 1, "CASE-3", 3600, "freeze", 0);
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-3", hash, expiry, 0, sig),
      "Judicial key expired or not yet valid"
    );
  });

  // ── Case 4: Not-yet-valid judicial key ────────────────────────────────────
  it("Case 4 — not-yet-valid judicial key is rejected", async function () {
    const { c, admin, judgeVellore, vellore } = await deploy();
    const future = Math.floor(Date.now() / 1000) + 9999999;
    await (await c.connect(admin).registerJudge(
      judgeVellore.address, "District Court Vellore", future, future + 1, 3, vellore
    )).wait();
    const { hash, expiry, sig } = await makeOrder(judgeVellore, 1, "CASE-4", 3600, "freeze", 0);
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-4", hash, expiry, 0, sig),
      "Judicial key expired or not yet valid"
    );
  });

  // ── Case 5: Expired order ─────────────────────────────────────────────────
  it("Case 5 — expired order is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) - 1;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-5", 1, expiry, "freeze", 0]
    );
    const hash = ethers.keccak256(packed);
    const sig  = await judgeVellore.signMessage(ethers.getBytes(hash));
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-5", hash, expiry, 0, sig),
      "Order has expired"
    );
  });

  // ── Case 6: Replay attack ─────────────────────────────────────────────────
  it("Case 6 — replay attack is rejected (usedOrders check)", async function () {
    const { c, judgeVellore } = await deploy();
    const { hash, expiry, sig } = await makeOrder(judgeVellore, 1, "CASE-6", 3600, "freeze", 0);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-6", hash, expiry, 0, sig)).wait();
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-6", hash, expiry, 0, sig),
      "Order already submitted"
    );
  });

  // ── Case 7: Wrong nonce — skipped ────────────────────────────────────────
  it("Case 7 — skipped nonce is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const { hash, expiry, sig } = await makeOrder(judgeVellore, 1, "CASE-7", 3600, "freeze", 5);
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-7", hash, expiry, 5, sig),
      "Invalid nonce"
    );
  });

  // ── Case 8: Wrong nonce — repeated ───────────────────────────────────────
  it("Case 8 — repeated nonce is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const o1 = await makeOrder(judgeVellore, 1, "CASE-8a", 3600, "freeze", 0);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-8a", o1.hash, o1.expiry, 0, o1.sig)).wait();
    // Nonce is now 1; token 1 is Vellore so jurisdiction passes, nonce check fires
    const o2 = await makeOrder(judgeVellore, 1, "CASE-8b", 3600, "freeze", 0);
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-8b", o2.hash, o2.expiry, 0, o2.sig),
      "Invalid nonce"
    );
  });

  // ── Case 9: Wrong jurisdiction — Vellore → Kadapa ────────────────────────
  it("Case 9 — Vellore judge cannot freeze Kadapa property", async function () {
    const { c, judgeVellore } = await deploy();
    const { hash, expiry, sig } = await makeOrder(judgeVellore, 3, "CASE-9", 3600, "freeze", 0);
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(3, "CASE-9", hash, expiry, 0, sig),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 10: Wrong jurisdiction — Kadapa → Vellore ───────────────────────
  it("Case 10 — Kadapa judge cannot freeze Vellore property", async function () {
    const { c, judgeKadapa } = await deploy();
    const { hash, expiry, sig } = await makeOrder(judgeKadapa, 1, "CASE-10", 3600, "freeze", 0);
    await expectRevert(
      c.connect(judgeKadapa).submitFreezeOrder(1, "CASE-10", hash, expiry, 0, sig),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 11: Tampered hash ───────────────────────────────────────────────
  it("Case 11 — tampered hash causes unregistered-signer rejection", async function () {
    const { c, judgeVellore } = await deploy();
    const { expiry, sig } = await makeOrder(judgeVellore, 1, "CASE-11", 3600, "freeze", 0);
    const tamperedData = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-11", 2, expiry, "freeze", 0]
    );
    const tamperedHash = ethers.keccak256(tamperedData);
    await expectRevert(
      c.connect(judgeVellore).submitFreezeOrder(2, "CASE-11", tamperedHash, expiry, 0, sig),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 12: Empty signature ─────────────────────────────────────────────
  it("Case 12 — empty signature is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-12", 1, expiry, "freeze", 0]
    );
    const hash = ethers.keccak256(packed);
    await expectAnyRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-12", hash, expiry, 0, "0x")
    );
  });

  // ── Case 13: Malformed signature ─────────────────────────────────────────
  it("Case 13 — malformed signature (63 bytes) is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-13", 1, expiry, "freeze", 0]
    );
    const hash   = ethers.keccak256(packed);
    const badSig = "0x" + "ab".repeat(63);
    await expectAnyRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-13", hash, expiry, 0, badSig)
    );
  });

  // ── Case 14: Zero address recovery ──────────────────────────────────────
  it("Case 14 — signature recovering to zero address is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "string", "uint256"],
      ["CASE-14", 1, expiry, "freeze", 0]
    );
    const hash    = ethers.keccak256(packed);
    const zeroSig = "0x" + "00".repeat(64) + "1b"; // v=27, r=0, s=0
    await expectAnyRevert(
      c.connect(judgeVellore).submitFreezeOrder(1, "CASE-14", hash, expiry, 0, zeroSig)
    );
  });

  // ── Case 15: Freeze already-frozen token ─────────────────────────────────
  // Design decision: a second authenticated freeze IS accepted.
  it("Case 15 — freezing an already-frozen token is accepted (dual-court freeze)", async function () {
    const { c, judgeVellore } = await deploy();
    const o1 = await makeOrder(judgeVellore, 1, "CASE-15a", 3600, "freeze", 0);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-15a", o1.hash, o1.expiry, 0, o1.sig)).wait();

    expect(await c.frozen(1)).to.equal(true);

    const o2 = await makeOrder(judgeVellore, 1, "CASE-15b", 3600, "freeze", 1);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-15b", o2.hash, o2.expiry, 1, o2.sig)).wait();

    expect(await c.frozenBy(1)).to.equal("CASE-15b");
    expect(await c.getFreezeHistoryLength(1)).to.equal(2n);
  });

  // ── Case 16: Unfreeze non-frozen token ───────────────────────────────────
  it("Case 16 — unfreezing a non-frozen token is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const { hash, expiry, sig } = await makeOrder(judgeVellore, 1, "CASE-16", 3600, "unfreeze", 0);
    await expectRevert(
      c.connect(judgeVellore).submitUnfreezeOrder(1, "CASE-16", hash, expiry, 0, sig),
      "Token is not frozen"
    );
  });

  // ── Case 17: Unfreeze — wrong jurisdiction ───────────────────────────────
  it("Case 17 — Kadapa judge cannot unfreeze Vellore property", async function () {
    const { c, judgeVellore, judgeKadapa } = await deploy();
    const fo = await makeOrder(judgeVellore, 1, "CASE-17-freeze", 3600, "freeze", 0);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-17-freeze", fo.hash, fo.expiry, 0, fo.sig)).wait();
    const uo = await makeOrder(judgeKadapa, 1, "CASE-17-unfreeze", 3600, "unfreeze", 0);
    await expectRevert(
      c.connect(judgeKadapa).submitUnfreezeOrder(1, "CASE-17-unfreeze", uo.hash, uo.expiry, 0, uo.sig),
      "Court lacks territorial jurisdiction over this property"
    );
  });

  // ── Case 18: Unfreeze — revoked signer ───────────────────────────────────
  it("Case 18 — revoked signer cannot unfreeze", async function () {
    const { c, admin, judgeVellore } = await deploy();
    const fo = await makeOrder(judgeVellore, 1, "CASE-18-freeze", 3600, "freeze", 0);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-18-freeze", fo.hash, fo.expiry, 0, fo.sig)).wait();
    await (await c.connect(admin).revokeJudge(judgeVellore.address)).wait();
    const uo = await makeOrder(judgeVellore, 1, "CASE-18-unfreeze", 3600, "unfreeze", 1);
    await expectRevert(
      c.connect(judgeVellore).submitUnfreezeOrder(1, "CASE-18-unfreeze", uo.hash, uo.expiry, 1, uo.sig),
      "Unregistered or revoked signer"
    );
  });

  // ── Case 19: Unfreeze replay ─────────────────────────────────────────────
  it("Case 19 — unfreeze replay is rejected (usedOrders check)", async function () {
    const { c, judgeVellore } = await deploy();
    const fo = await makeOrder(judgeVellore, 1, "CASE-19-freeze", 3600, "freeze", 0);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-19-freeze", fo.hash, fo.expiry, 0, fo.sig)).wait();

    const uo = await makeOrder(judgeVellore, 1, "CASE-19-unfreeze", 3600, "unfreeze", 1);
    await (await c.connect(judgeVellore).submitUnfreezeOrder(1, "CASE-19-unfreeze", uo.hash, uo.expiry, 1, uo.sig)).wait();

    // Re-freeze so token is frozen again (nonce now 2)
    const fo2 = await makeOrder(judgeVellore, 1, "CASE-19-freeze2", 3600, "freeze", 2);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-19-freeze2", fo2.hash, fo2.expiry, 2, fo2.sig)).wait();

    await expectRevert(
      c.connect(judgeVellore).submitUnfreezeOrder(1, "CASE-19-unfreeze", uo.hash, uo.expiry, 1, uo.sig),
      "Order already submitted"
    );
  });

  // ── Case 20: Wrong nonce on unfreeze ─────────────────────────────────────
  it("Case 20 — wrong nonce on unfreeze is rejected", async function () {
    const { c, judgeVellore } = await deploy();
    const fo = await makeOrder(judgeVellore, 1, "CASE-20-freeze", 3600, "freeze", 0);
    await (await c.connect(judgeVellore).submitFreezeOrder(1, "CASE-20-freeze", fo.hash, fo.expiry, 0, fo.sig)).wait();
    const uo = await makeOrder(judgeVellore, 1, "CASE-20-unfreeze", 3600, "unfreeze", 99);
    await expectRevert(
      c.connect(judgeVellore).submitUnfreezeOrder(1, "CASE-20-unfreeze", uo.hash, uo.expiry, 99, uo.sig),
      "Invalid nonce"
    );
  });

});
