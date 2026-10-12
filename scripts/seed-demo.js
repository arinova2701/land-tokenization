/**
 * scripts/seed-demo.js
 *
 * Seeds the demo state on a freshly deployed Besu chain:
 *  - Registers the judge key (ROLE_JUDGE, Vellore territory, District Court level 3)
 *  - Registers the clerk key (ROLE_CLERK, Vellore territory, District Court level 3)
 *  - Sets court level value limits
 *  - Registers three demo parcels with declared values:
 *      Parcel A (Token 4): Vellore, ₹50L  — success case (within District Court limit)
 *      Parcel B (Token 5): Vellore, ₹2Cr  — pecuniary failure case (above District Court ₹1Cr limit)
 *      Parcel C (Token 6): Kadapa, ₹10L   — territorial failure case (wrong territory)
 *
 * Reads:
 *   demo-wallets.json  — wallets created by setup-demo-wallets.js
 *   public/config.json — deployed contract addresses
 *
 * Usage:
 *   node scripts/seed-demo.js
 *
 * Requires Besu to be running and contracts deployed.
 * Set RPC_URL if not using the default http://127.0.0.1:8545.
 */

const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

const ABI = [
  "function admin() view returns (address)",
  "function registry(address) view returns (string courtName, uint256 validFrom, uint256 validUntil, bool active, uint8 courtLevel, bytes32 territoryCode, uint8 role)",
  "function parcelDeclaredValue(uint256) view returns (uint256)",
  "function propertyTerritory(uint256) view returns (bytes32)",
  "function courtLevelMaxValue(uint8) view returns (uint256)",
  "function quorumThreshold() view returns (uint256)",
  "function setTerritory(bytes32 code, string name, bytes32 parent)",
  "function registerJudge(address signer, string courtName, uint256 validFrom, uint256 validUntil, uint8 courtLevel, bytes32 territory, uint8 role)",
  "function registerProperty(uint256 tokenId, bytes32 territory, uint256 declaredValue)",
  "function setCourtLevelMaxValue(uint8 courtLevel, uint256 maxValue)"
];

async function main() {
  // Load demo-wallets.json
  if (!fs.existsSync("demo-wallets.json")) {
    throw new Error("demo-wallets.json not found. Run scripts/setup-demo-wallets.js first.");
  }
  const wallets = JSON.parse(fs.readFileSync("demo-wallets.json", "utf8"));

  // Load public/config.json
  if (!fs.existsSync("public/config.json")) {
    throw new Error("public/config.json not found. Deploy the contracts first.");
  }
  const config = JSON.parse(fs.readFileSync("public/config.json", "utf8"));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network  = await provider.getNetwork();
  console.log("Network chain ID:", network.chainId.toString());

  const registrarWallet = new ethers.Wallet(wallets.registrar.privateKey, provider);
  const contract = new ethers.Contract(config.contractAddress, ABI, registrarWallet);

  // Verify the demo registrar matches the on-chain admin
  const onChainAdmin = await contract.admin();
  if (registrarWallet.address.toLowerCase() !== onChainAdmin.toLowerCase()) {
    throw new Error(
      "demo-wallets.json registrar (" + registrarWallet.address + ") does not match on-chain admin (" + onChainAdmin + ").\n" +
      "The chain may have been reset without re-running setup-demo-wallets.js with --force, or the wrong wallet was created."
    );
  }

  const vellore   = ethers.keccak256(ethers.toUtf8Bytes("vellore"));
  const kadapa    = ethers.keccak256(ethers.toUtf8Bytes("kadapa"));
  const tamilNadu = ethers.keccak256(ethers.toUtf8Bytes("tamil_nadu"));

  const now     = Math.floor(Date.now() / 1000);
  const oneYear = now + 365 * 24 * 3600;

  // ── Register judge key ─────────────────────────────────────────────────────
  const judgeInfo = await contract.registry(wallets.judge.address);
  if (judgeInfo.active) {
    console.log("Judge already registered:", wallets.judge.address,
      "— skipping (reset chain and re-run with fresh wallets to re-seed)");
  } else {
    const tx = await contract.registerJudge(
      wallets.judge.address,
      "District Court Vellore (Demo)",
      0, oneYear,
      3,          // District Court level
      vellore,    // Vellore territory
      1           // ROLE_JUDGE
    );
    await tx.wait();
    console.log("Judge registered:", wallets.judge.address);
  }

  // ── Register clerk key ─────────────────────────────────────────────────────
  const clerkInfo = await contract.registry(wallets.clerk.address);
  if (clerkInfo.active) {
    console.log("Clerk already registered:", wallets.clerk.address, "— skipping");
  } else {
    const tx = await contract.registerJudge(
      wallets.clerk.address,
      "District Court Vellore (Demo Clerk)",
      0, oneYear,
      3,          // District Court level
      vellore,    // Vellore territory
      2           // ROLE_CLERK
    );
    await tx.wait();
    console.log("Clerk registered:", wallets.clerk.address);
  }

  // ── Set court level value limits ───────────────────────────────────────────
  // Only set if not already configured (courtLevelMaxValue[3] = District Court = ₹1Cr)
  const existingMax = await contract.courtLevelMaxValue(3);
  if (existingMax.toString() === "0") {
    await (await contract.setCourtLevelMaxValue(1, 300_000)).wait();     // Munsif: ₹3L
    await (await contract.setCourtLevelMaxValue(2, 2_500_000)).wait();   // Sub Court: ₹25L
    await (await contract.setCourtLevelMaxValue(3, 10_000_000)).wait();  // District: ₹1Cr
    // Level 4 (HC) = type(uint256).max = unlimited — left as contract default
    console.log("Court level max values set");
  } else {
    console.log("Court level max values already set — skipping");
  }

  // ── Register three demo parcels ────────────────────────────────────────────
  // Token IDs 4, 5, 6 to avoid collision with the seed tokens (1–3) from deploy.

  // Parcel A — success case: Vellore, ₹50L (within District Court ₹1Cr limit)
  const terrA = await contract.propertyTerritory(4);
  if (terrA !== ethers.ZeroHash) {
    console.log("Parcel A (Token 4) already registered — skipping");
  } else {
    await (await contract.registerProperty(4, vellore, 5_000_000)).wait();
    console.log("Parcel A (Token 4): Vellore, ₹50L — registered (success case)");
  }

  // Parcel B — pecuniary failure: Vellore, ₹2Cr (above District Court ₹1Cr limit)
  const terrB = await contract.propertyTerritory(5);
  if (terrB !== ethers.ZeroHash) {
    console.log("Parcel B (Token 5) already registered — skipping");
  } else {
    await (await contract.registerProperty(5, vellore, 20_000_000)).wait();
    console.log("Parcel B (Token 5): Vellore, ₹2Cr — registered (pecuniary failure case)");
  }

  // Parcel C — territorial failure: Kadapa (AP), ₹10L (wrong territory for Vellore judge)
  const terrC = await contract.propertyTerritory(6);
  if (terrC !== ethers.ZeroHash) {
    console.log("Parcel C (Token 6) already registered — skipping");
  } else {
    await (await contract.registerProperty(6, kadapa, 1_000_000)).wait();
    console.log("Parcel C (Token 6): Kadapa, ₹10L — registered (territorial failure case)");
  }

  console.log("\nSeed complete. Token IDs for the demo:");
  console.log("  Token 4 — Parcel A (Vellore, success case)");
  console.log("  Token 5 — Parcel B (Vellore, pecuniary failure — value above District Court limit)");
  console.log("  Token 6 — Parcel C (Kadapa, territorial failure — outside Vellore judge jurisdiction)");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
