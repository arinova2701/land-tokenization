// scripts/setup-demo-wallets.js
const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const FUNDER_KEY = process.env.FUNDER_KEY;
const ROLES = ["registrar", "judge", "clerk", "citizen"];

async function main() {
  if (!FUNDER_KEY) throw new Error("Set FUNDER_KEY to a pre-funded Besu account key");

  if (fs.existsSync("demo-wallets.json") && !process.argv.includes("--force")) {
    console.log("demo-wallets.json already exists. Use --force to overwrite.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const funder = new ethers.Wallet(FUNDER_KEY, provider);
  const wallets = {};

  for (const role of ROLES) {
    const w = ethers.Wallet.createRandom();
    wallets[role] = { address: w.address, privateKey: w.privateKey };

    const tx = await funder.sendTransaction({
      to: w.address,
      value: ethers.parseEther("10"),
    });
    await tx.wait();
    console.log(`${role}: ${w.address} funded`);
  }

  fs.writeFileSync("demo-wallets.json", JSON.stringify(wallets, null, 2));
  console.log("Saved demo-wallets.json. Do not commit this file.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
