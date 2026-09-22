/**
 * benchmark.js
 *
 * Submits 100 authenticated freeze orders sequentially, measures the wall-clock
 * latency (tx-submit → receipt confirmed) for each, and prints + saves stats.
 *
 * Usage:
 *   npx hardhat run scripts/benchmark.js --network localhost   (Hardhat node)
 *   npx hardhat run scripts/benchmark.js --network besu        (4-node QBFT)
 *
 * Each run appends its results under a key matching the network name in:
 *   data/benchmark-results.json
 *
 * Running both networks gives a side-by-side comparison in that file.
 */

const hre   = require("hardhat");
const fs    = require("fs");
const path  = require("path");

const RESULTS_FILE = path.join(__dirname, "../data/benchmark-results.json");
const TX_COUNT     = 100;
const TOKEN_ID     = 1;                // all 100 orders target token 1 (Vellore)
const ORDER_TTL_S  = 3600;             // order valid for 1 hour

// ─── Order construction ───────────────────────────────────────────────────────

async function makeOrder(signer, tokenId, caseNumber, expiryOffset, nonce) {
  const expiry = Math.floor(Date.now() / 1000) + expiryOffset;
  const packed = hre.ethers.solidityPacked(
    ["string", "uint256", "uint256", "string", "uint256"],
    [caseNumber, tokenId, expiry, "freeze", nonce]
  );
  const hash = hre.ethers.keccak256(packed);
  const sig  = await signer.signMessage(hre.ethers.getBytes(hash));
  return { hash, expiry, sig };
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  // Nearest-rank method
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function stats(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum    = sorted.reduce((a, b) => a + b, 0);
  return {
    min_ms:     sorted[0],
    max_ms:     sorted[sorted.length - 1],
    average_ms: Math.round(sum / sorted.length),
    median_ms:  percentile(sorted, 50),
    p95_ms:     percentile(sorted, 95),
    p99_ms:     percentile(sorted, 99),
  };
}

// ─── Printing ─────────────────────────────────────────────────────────────────

function printTable(label, s, count, elapsed) {
  const w = 36;
  const line = "─".repeat(w);
  console.log(`\n┌${line}┐`);
  console.log(`│  ${label.padEnd(w - 2)}│`);
  console.log(`├${line}┤`);
  console.log(`│  Transactions  : ${String(count).padStart(8)} ms        │`);
  console.log(`│  Total time    : ${String(elapsed).padStart(8)} ms        │`);
  console.log(`├${line}┤`);
  console.log(`│  Min           : ${String(s.min_ms).padStart(8)} ms        │`);
  console.log(`│  Average       : ${String(s.average_ms).padStart(8)} ms        │`);
  console.log(`│  Median (p50)  : ${String(s.median_ms).padStart(8)} ms        │`);
  console.log(`│  p95           : ${String(s.p95_ms).padStart(8)} ms        │`);
  console.log(`│  p99           : ${String(s.p99_ms).padStart(8)} ms        │`);
  console.log(`│  Max           : ${String(s.max_ms).padStart(8)} ms        │`);
  console.log(`└${line}┘`);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function setupContracts(admin, judge) {
  console.log("  Deploying CourtKeyRegistry...");
  const Factory  = await hre.ethers.getContractFactory("CourtKeyRegistry");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  console.log("  Deployed at:", await contract.getAddress());

  const vellore   = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("vellore"));
  const tamilNadu = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("tamil_nadu"));

  await (await contract.setTerritory(tamilNadu, "Tamil Nadu", hre.ethers.ZeroHash)).wait();
  await (await contract.setTerritory(vellore,   "Vellore",    tamilNadu)).wait();
  await (await contract.registerProperty(TOKEN_ID, vellore)).wait();

  const now     = Math.floor(Date.now() / 1000);
  const oneYear = now + 365 * 24 * 3600;
  await (await contract.registerJudge(
    judge.address, "District Court Vellore", 0, oneYear, 3, vellore
  )).wait();

  console.log("  Setup complete (territories, property, judge registered)");
  return contract;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const networkName = hre.network.name;
  const provider    = hre.ethers.provider;
  const { chainId } = await provider.getNetwork();

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  Benchmark — ${networkName}  (chain ID ${chainId})`);
  console.log(`${"═".repeat(50)}`);
  console.log(`  Transactions  : ${TX_COUNT}`);
  console.log(`  Token         : #${TOKEN_ID}`);

  const [admin, judge] = await hre.ethers.getSigners();
  console.log(`  Admin         : ${admin.address}`);
  console.log(`  Judge         : ${judge.address}`);

  // ── Setup ──────────────────────────────────────────────────────────────────
  console.log("\n[ Setup ]");
  const contract = await setupContracts(admin, judge);

  // ── Benchmark loop ────────────────────────────────────────────────────────
  console.log(`\n[ Sending ${TX_COUNT} freeze orders ]`);
  const latencies = [];
  const suiteStart = Date.now();

  for (let i = 0; i < TX_COUNT; i++) {
    const caseNumber = `BENCH-${networkName.toUpperCase()}-${String(i).padStart(3, "0")}`;
    const order      = await makeOrder(judge, TOKEN_ID, caseNumber, ORDER_TTL_S, i);

    const t0 = Date.now();
    const tx = await contract.connect(judge).submitFreezeOrder(
      TOKEN_ID, caseNumber, order.hash, order.expiry, i, order.sig
    );
    await tx.wait();
    const latency = Date.now() - t0;

    latencies.push(latency);

    // Progress indicator
    const pct   = Math.round(((i + 1) / TX_COUNT) * 100);
    const bar   = "█".repeat(Math.round(pct / 5)).padEnd(20, "░");
    process.stdout.write(
      `\r  [${bar}] ${pct}%  tx ${i + 1}/${TX_COUNT}  last=${latency}ms   `
    );
  }

  const suiteElapsed = Date.now() - suiteStart;
  process.stdout.write("\n");

  // ── Stats ──────────────────────────────────────────────────────────────────
  const s = stats(latencies);
  const label = networkName === "besu"
    ? "Besu QBFT (4-node)"
    : `Hardhat localhost`;

  printTable(label, s, TX_COUNT, suiteElapsed);

  // ── Save ───────────────────────────────────────────────────────────────────
  let existing = {};
  if (fs.existsSync(RESULTS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")); }
    catch (_) { existing = {}; }
  }

  existing[networkName] = {
    network:      networkName,
    chainId:      Number(chainId),
    timestamp:    new Date().toISOString(),
    count:        TX_COUNT,
    latencies_ms: latencies,
    stats:        s,
  };

  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(existing, null, 2));
  console.log(`\n  Results saved → data/benchmark-results.json`);

  // ── If both networks have been run, print comparison ──────────────────────
  const keys = Object.keys(existing);
  if (keys.length >= 2) {
    printComparison(existing);
  }
}

// ─── Side-by-side comparison ──────────────────────────────────────────────────

function printComparison(results) {
  const nets = Object.keys(results);
  console.log(`\n${"═".repeat(62)}`);
  console.log("  Side-by-side comparison");
  console.log(`${"═".repeat(62)}`);
  const header = "Metric".padEnd(18) +
    nets.map(n => n.padStart(18)).join("") + "   ratio";
  console.log("  " + header);
  console.log("  " + "─".repeat(58));

  const metrics = [
    ["min_ms",     "Min (ms)"],
    ["average_ms", "Average (ms)"],
    ["median_ms",  "Median p50 (ms)"],
    ["p95_ms",     "p95 (ms)"],
    ["p99_ms",     "p99 (ms)"],
    ["max_ms",     "Max (ms)"],
  ];

  const [a, b] = nets;
  for (const [key, label] of metrics) {
    const va = results[a].stats[key];
    const vb = results[b] ? results[b].stats[key] : null;
    const ratio = vb ? `${(vb / va).toFixed(1)}×` : "";
    const row = label.padEnd(18) +
      String(va).padStart(18) +
      (vb !== null ? String(vb).padStart(18) : "".padStart(18)) +
      "   " + ratio;
    console.log("  " + row);
  }
  console.log(`${"═".repeat(62)}\n`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
