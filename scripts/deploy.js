const hre = require("hardhat");

async function main() {
  const [admin, judge] = await hre.ethers.getSigners();

  const Factory = await hre.ethers.getContractFactory("CourtKeyRegistry");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("Contract deployed at:", address);
  console.log("Admin (Registrar):", admin.address);
  console.log("Judge account:", judge.address);

  // Register the judge
  const now = Math.floor(Date.now() / 1000);
  const tx = await contract.registerJudge(
    judge.address,
    "XVI Assistant City Civil Court, Chennai",
    0,                    // valid from epoch (always valid)
    now + 365 * 24 * 3600 // valid for 1 year
  );
  await tx.wait();
  console.log("Judge registered successfully");

  // Write config for the frontend
  const config = {
    contractAddress: address,
    adminAddress: admin.address,
    judgeAddress: judge.address
  };

  const fs = require("fs");
  fs.writeFileSync(
    "public/config.json",
    JSON.stringify(config, null, 2)
  );
  console.log("Frontend config written to public/config.json");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
