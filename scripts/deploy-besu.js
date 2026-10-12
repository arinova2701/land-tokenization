/**
 * deploy-besu.js
 *
 * Deploys ParcelToken + CourtKeyRegistry to the 4-node Besu QBFT network
 * and writes public/config.json so the frontend works against Besu.
 *
 * Prerequisites:
 *   node docker/generate-keys.js          (once, to create keys + genesis)
 *   docker compose -f docker/docker-compose.yml up -d
 *   Wait ~10s for the network to produce its first blocks
 *
 * Run:
 *   npx hardhat run scripts/deploy-besu.js --network besu
 *
 * Behavioral differences vs Hardhat localhost:
 *   - Block time is ~2s (QBFT blockperiodseconds=2), not instant.
 *   - Gas price: Besu is configured with --min-gas-price=0, so free txs work.
 *   - Chain ID: 1337 (same as Hardhat default).
 *   - Accounts: the first 5 Hardhat deterministic accounts are pre-funded
 *     in genesis alloc, so signers[0..4] work on both the local node and Besu.
 */

const hre = require("hardhat");

async function main() {
  const [admin, judge, outsideJudge] = await hre.ethers.getSigners();

  console.log("Network: Besu QBFT (chain ID 1337)");
  console.log("Deploying from:", admin.address);

  // Deploy ParcelToken (ERC-3643-compatible subset) — Step 3
  const TokenFactory = await hre.ethers.getContractFactory("ParcelToken");
  const token = await TokenFactory.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("ParcelToken deployed at:", tokenAddress);

  // Deploy CourtKeyRegistry
  const Factory = await hre.ethers.getContractFactory("CourtKeyRegistry");
  const contract = await Factory.deploy(tokenAddress);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("CourtKeyRegistry deployed at:", address);
  console.log("Admin (Registrar):", admin.address);
  console.log("Judge (TN):", judge.address);
  console.log("Judge (outside TN):", outsideJudge.address);

  // Set registry as token agent
  await (await token.setAgent(address)).wait();
  console.log("Token agent set to CourtKeyRegistry");

  // Territory codes
  const vellore       = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("vellore"));
  const chennai       = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("chennai"));
  const tamilNadu     = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("tamil_nadu"));
  const kadapa        = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("kadapa"));
  const andhraPradesh = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("andhra_pradesh"));

  await (await contract.setTerritory(tamilNadu,     "Tamil Nadu",     hre.ethers.ZeroHash)).wait();
  await (await contract.setTerritory(vellore,       "Vellore",        tamilNadu)).wait();
  await (await contract.setTerritory(chennai,       "Chennai",        tamilNadu)).wait();
  await (await contract.setTerritory(andhraPradesh, "Andhra Pradesh", hre.ethers.ZeroHash)).wait();
  await (await contract.setTerritory(kadapa,        "Kadapa",         andhraPradesh)).wait();
  console.log("Territories configured");

  // Properties with declared values (Step 2)
  await (await contract.registerProperty(1, vellore, 5_000_000)).wait();
  await (await contract.registerProperty(2, chennai, 5_000_000)).wait();
  await (await contract.registerProperty(3, kadapa,  200_000)).wait();
  console.log("Properties registered with declared values");

  const now     = Math.floor(Date.now() / 1000);
  const oneYear = now + 365 * 24 * 3600;

  await (await contract.registerJudge(
    judge.address, "District Court Vellore", 0, oneYear, 3, vellore, 1
  )).wait();
  console.log("Judge 1 registered: District Court Vellore (ROLE_JUDGE)");

  await (await contract.registerJudge(
    outsideJudge.address, "III Additional Junior Civil Judge Kadapa", 0, oneYear, 1, kadapa, 1
  )).wait();
  console.log("Judge 2 registered: Civil Judge Kadapa (ROLE_JUDGE)");

  await (await contract.registerJudge(
    admin.address, "Land Registry Authority", 0, oneYear, 4, tamilNadu, 3
  )).wait();
  console.log("Admin registered as ROLE_REGISTRAR (national co-signer)");

  // Write config for frontend
  const config = {
    contractAddress:     address,
    parcelTokenAddress:  tokenAddress,
    adminAddress:        admin.address,
    judgeAddress:        judge.address,
    outsideJudgeAddress: outsideJudge.address,
    registrarAddress:    admin.address,
    network:             "besu",
    territories: {
      vellore,
      chennai,
      tamilNadu,
      kadapa,
      andhraPradesh,
    },
  };

  const fs = require("fs");
  fs.writeFileSync("public/config.json", JSON.stringify(config, null, 2));
  console.log("Frontend config written to public/config.json");
  console.log("\nDone. Point your browser at http://localhost:3000");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
