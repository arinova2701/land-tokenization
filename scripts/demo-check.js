/**
 * scripts/demo-check.js
 *
 * Preflight check script — prints PASS or FAIL for each condition
 * and exits non-zero if any check fails.
 *
 * Usage:
 *   node scripts/demo-check.js
 *
 * Reads public/config.json for contract addresses.
 * Reads demo-wallets.json for demo wallet addresses.
 */

const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL        = process.env.RPC_URL || "http://127.0.0.1:8545";
const EXPECTED_CHAIN = 1337;

const ABI = [
  "function admin() view returns (address)",
  "function registry(address) view returns (string courtName, uint256 validFrom, uint256 validUntil, bool active, uint8 courtLevel, bytes32 territoryCode, uint8 role)",
  "function propertyTerritory(uint256) view returns (bytes32)",
  "function quorumThreshold() view returns (uint256)"
];

const PARCEL_TOKEN_ABI = [
  "function agent() view returns (address)"
];

let passed = 0;
let failed = 0;

function result(label, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  const line   = "[" + status + "] " + label + (detail ? " — " + detail : "");
  console.log(line);
  if (ok) passed++; else failed++;
}

async function main() {
  console.log("NyayaChain Demo Preflight Check");
  console.log("================================");

  // Load config files
  if (!fs.existsSync("public/config.json")) {
    result("public/config.json present", false, "file not found — run deploy-besu.js first");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync("public/config.json", "utf8"));

  if (!fs.existsSync("demo-wallets.json")) {
    result("demo-wallets.json present", false, "file not found — run setup-demo-wallets.js first");
    process.exit(1);
  }
  const wallets = JSON.parse(fs.readFileSync("demo-wallets.json", "utf8"));

  // Connect
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
  } catch (e) {
    result("RPC connection", false, e.message); process.exit(1);
  }

  // Check 1: Chain ID matches genesis.json
  let chainId;
  try {
    const network = await provider.getNetwork();
    chainId = Number(network.chainId);
    result("Chain ID matches genesis.json (" + EXPECTED_CHAIN + ")", chainId === EXPECTED_CHAIN,
      "got " + chainId);
  } catch (e) {
    result("Chain ID check", false, e.message); process.exit(1);
  }

  // Check 2: Blocks are advancing
  try {
    const b1 = await provider.getBlockNumber();
    // Poll for a new block (max 5s — Besu block time is 2s)
    let b2 = b1;
    const deadline = Date.now() + 5000;
    while (b2 === b1 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
      b2 = await provider.getBlockNumber();
    }
    result("Blocks are advancing", b2 > b1, "block #" + b1 + " → #" + b2);
  } catch (e) {
    result("Blocks advancing", false, e.message);
  }

  // Check 3: All four demo wallets have a balance
  const roles = ["registrar", "judge", "clerk", "citizen"];
  for (const role of roles) {
    try {
      const bal = await provider.getBalance(wallets[role].address);
      const eth = parseFloat(ethers.formatEther(bal)).toFixed(4);
      result("Demo wallet " + role + " has balance", bal > 0n, wallets[role].address + " — " + eth + " ETH");
    } catch (e) {
      result("Demo wallet " + role, false, e.message);
    }
  }

  // Check 4: CourtKeyRegistry deployed (has code)
  try {
    const code = await provider.getCode(config.contractAddress);
    result("CourtKeyRegistry deployed", code !== "0x", config.contractAddress);
  } catch (e) {
    result("CourtKeyRegistry deployed", false, e.message);
  }

  // Check 5: ParcelToken deployed (has code)
  try {
    const code = await provider.getCode(config.parcelTokenAddress);
    result("ParcelToken deployed", code !== "0x", config.parcelTokenAddress);
  } catch (e) {
    result("ParcelToken deployed", false, e.message);
  }

  const contract = new ethers.Contract(config.contractAddress, ABI, provider);
  const ptContract = new ethers.Contract(config.parcelTokenAddress, PARCEL_TOKEN_ABI, provider);

  // Check 6: ParcelToken agent is CourtKeyRegistry
  try {
    const agent = await ptContract.agent();
    result("ParcelToken agent is CourtKeyRegistry",
      agent.toLowerCase() === config.contractAddress.toLowerCase(), agent);
  } catch (e) {
    result("ParcelToken agent", false, e.message);
  }

  // Check 7: Judge key registered with ROLE_JUDGE
  try {
    const info = await contract.registry(wallets.judge.address);
    result("Judge key registered (ROLE_JUDGE)",
      info.active && Number(info.role) === 1,
      wallets.judge.address + " — role=" + info.role + " active=" + info.active);
  } catch (e) {
    result("Judge key", false, e.message);
  }

  // Check 8: Clerk key registered with ROLE_CLERK
  try {
    const info = await contract.registry(wallets.clerk.address);
    result("Clerk key registered (ROLE_CLERK)",
      info.active && Number(info.role) === 2,
      wallets.clerk.address + " — role=" + info.role + " active=" + info.active);
  } catch (e) {
    result("Clerk key", false, e.message);
  }

  // Check 9: Three demo parcels exist (Tokens 4, 5, 6)
  const parcelNames = { 4: "Parcel A (success)", 5: "Parcel B (pecuniary fail)", 6: "Parcel C (territorial fail)" };
  for (const [tokenId, name] of Object.entries(parcelNames)) {
    try {
      const terr = await contract.propertyTerritory(tokenId);
      result("Demo parcel registered — Token " + tokenId + " " + name,
        terr !== ethers.ZeroHash, "territory hash: " + terr.slice(0, 18) + "...");
    } catch (e) {
      result("Demo parcel Token " + tokenId, false, e.message);
    }
  }

  // Check 10: Quorum threshold is set (≥ 2)
  try {
    const threshold = await contract.quorumThreshold();
    result("Quorum threshold set (≥ 2)", Number(threshold) >= 2, "threshold=" + threshold.toString());
  } catch (e) {
    result("Quorum threshold", false, e.message);
  }

  // Summary
  console.log("");
  console.log("================================");
  console.log("Results: " + passed + " PASS  /  " + failed + " FAIL");
  if (failed > 0) {
    console.log("Demo is NOT ready — fix the failing checks above.");
    process.exit(1);
  } else {
    console.log("All checks passed. The demo chain is ready.");
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
