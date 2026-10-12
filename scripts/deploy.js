const hre = require("hardhat");

async function main() {
  const [admin, judge, outsideJudge] = await hre.ethers.getSigners();

  // Deploy ParcelToken (ERC-3643-compatible subset) — Step 3
  const TokenFactory = await hre.ethers.getContractFactory("ParcelToken");
  const token = await TokenFactory.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("ParcelToken deployed at:", tokenAddress);

  // Deploy CourtKeyRegistry with ParcelToken address
  const Factory = await hre.ethers.getContractFactory("CourtKeyRegistry");
  const contract = await Factory.deploy(tokenAddress);
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("CourtKeyRegistry deployed at:", address);
  console.log("Admin (Registrar):", admin.address);
  console.log("Judge (TN):", judge.address);
  console.log("Judge (outside TN):", outsideJudge.address);

  // Set registry as token agent (ERC-3643 agent role) — Step 3
  await (await token.setAgent(address)).wait();
  console.log("Token agent set to CourtKeyRegistry");

  // Territory codes
  const vellore      = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("vellore"));
  const chennai      = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("chennai"));
  const tamilNadu    = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("tamil_nadu"));
  const kadapa       = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("kadapa"));
  const andhraPradesh = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("andhra_pradesh"));

  await (await contract.setTerritory(tamilNadu,     "Tamil Nadu",     hre.ethers.ZeroHash)).wait();
  await (await contract.setTerritory(vellore,       "Vellore",        tamilNadu)).wait();
  await (await contract.setTerritory(chennai,       "Chennai",        tamilNadu)).wait();
  await (await contract.setTerritory(andhraPradesh, "Andhra Pradesh", hre.ethers.ZeroHash)).wait();
  await (await contract.setTerritory(kadapa,        "Kadapa",         andhraPradesh)).wait();
  console.log("Territories configured");

  // Register properties with declared values (Step 2)
  // Token 1: Vellore — ₹50 lakh (within District Court limit ₹1cr)
  await (await contract.registerProperty(1, vellore, 5_000_000)).wait();
  // Token 2: Chennai — ₹50 lakh
  await (await contract.registerProperty(2, chennai, 5_000_000)).wait();
  // Token 3: Kadapa — ₹2 lakh (within Munsif limit ₹3L)
  await (await contract.registerProperty(3, kadapa,  200_000)).wait();
  console.log("Properties registered with declared values");

  const now     = Math.floor(Date.now() / 1000);
  const oneYear = now + 365 * 24 * 3600;

  // Judge 1: District Court Vellore — ROLE_JUDGE (1), level 3
  await (await contract.registerJudge(
    judge.address,
    "District Court Vellore",
    0, oneYear,
    3,       // District Court
    vellore,
    1        // ROLE_JUDGE
  )).wait();
  console.log("Judge 1 registered: District Court Vellore (ROLE_JUDGE)");

  // Judge 2: Civil Judge Kadapa — ROLE_JUDGE (1), level 1 (Munsif)
  await (await contract.registerJudge(
    outsideJudge.address,
    "III Additional Junior Civil Judge Kadapa",
    0, oneYear,
    1,       // Munsif
    kadapa,
    1        // ROLE_JUDGE
  )).wait();
  console.log("Judge 2 registered: Civil Judge Kadapa (ROLE_JUDGE)");

  // Admin: Land Registry Authority — ROLE_REGISTRAR (3), national co-signer
  // REGISTRAR is exempt from territorial jurisdiction — can co-sign any order.
  await (await contract.registerJudge(
    admin.address,
    "Land Registry Authority",
    0, oneYear,
    4,        // High Court level for registrar
    tamilNadu,
    3         // ROLE_REGISTRAR
  )).wait();
  console.log("Admin registered as ROLE_REGISTRAR (national co-signer authority)");

  // Write config for frontend
  const config = {
    contractAddress:      address,
    parcelTokenAddress:   tokenAddress,
    adminAddress:         admin.address,
    judgeAddress:         judge.address,
    outsideJudgeAddress:  outsideJudge.address,
    registrarAddress:     admin.address,  // admin is also the REGISTRAR co-signer
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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
