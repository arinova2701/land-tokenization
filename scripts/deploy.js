const hre = require("hardhat");

async function main() {
  const [admin, judge, outsideJudge] = await hre.ethers.getSigners();

  const Factory = await hre.ethers.getContractFactory("CourtKeyRegistry");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("Contract deployed at:", address);
  console.log("Admin (Registrar):", admin.address);
  console.log("Judge (TN):", judge.address);
  console.log("Judge (outside TN):", outsideJudge.address);

  // Territory codes
  const vellore = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("vellore"));
  const chennai = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("chennai"));
  const tamilNadu = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("tamil_nadu"));
  const kadapa = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("kadapa"));
  const andhraPradesh = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("andhra_pradesh"));

  // Set up territory hierarchy
  // Tamil Nadu is a state (no parent)
  await (await contract.setTerritory(tamilNadu, "Tamil Nadu", hre.ethers.ZeroHash)).wait();
  // Vellore and Chennai are districts under Tamil Nadu
  await (await contract.setTerritory(vellore, "Vellore", tamilNadu)).wait();
  await (await contract.setTerritory(chennai, "Chennai", tamilNadu)).wait();
  // Andhra Pradesh is a state (no parent)
  await (await contract.setTerritory(andhraPradesh, "Andhra Pradesh", hre.ethers.ZeroHash)).wait();
  // Kadapa is a district under AP
  await (await contract.setTerritory(kadapa, "Kadapa", andhraPradesh)).wait();
  console.log("Territories configured");

  // Register properties
  // Token 1: property in Vellore
  await (await contract.registerProperty(1, vellore)).wait();
  // Token 2: property in Chennai
  await (await contract.registerProperty(2, chennai)).wait();
  // Token 3: property in Kadapa (AP)
  await (await contract.registerProperty(3, kadapa)).wait();
  console.log("Properties registered");

  // Register judges
  const now = Math.floor(Date.now() / 1000);
  const oneYear = now + 365 * 24 * 3600;

  // Judge 1: District Court judge in Vellore (level 3, covers Vellore district)
  await (await contract.registerJudge(
    judge.address,
    "District Court Vellore",
    0, oneYear,
    3,       // courtLevel: District Court
    vellore  // territory: Vellore
  )).wait();
  console.log("Judge 1 registered: District Court Vellore");

  // Judge 2: HC judge in Tamil Nadu (level 4, covers all of TN)
  // We'll use outsideJudge address for this but register as TN HC
  // Actually let's make outsideJudge an AP judge for the jurisdiction demo
  await (await contract.registerJudge(
    outsideJudge.address,
    "III Additional Junior Civil Judge Kadapa",
    0, oneYear,
    1,       // courtLevel: Munsif-level
    kadapa   // territory: Kadapa (AP)
  )).wait();
  console.log("Judge 2 registered: Civil Judge Kadapa (AP)");

  // Write config for frontend
  const config = {
    contractAddress: address,
    adminAddress: admin.address,
    judgeAddress: judge.address,
    outsideJudgeAddress: outsideJudge.address,
    territories: {
      vellore: vellore,
      chennai: chennai,
      tamilNadu: tamilNadu,
      kadapa: kadapa,
      andhraPradesh: andhraPradesh
    }
  };

  const fs = require("fs");
  fs.writeFileSync("public/config.json", JSON.stringify(config, null, 2));
  console.log("Frontend config written to public/config.json");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
