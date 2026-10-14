// scripts/setup-demo-wallets.js
const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const FUNDER_KEY = process.env.FUNDER_KEY;
const ROLES = ["registrar", "judge", "clerk", "citizen"];

async function main() {
  const exists = fs.existsSync("demo-wallets.json");
  const wallets = exists ? JSON.parse(fs.readFileSync("demo-wallets.json", "utf8")) : {};
  if (exists) {
    for (const role of ROLES) {
      if (!wallets[role]?.address || !wallets[role]?.privateKey) {
        throw new Error(`Existing demo-wallets.json is missing ${role}; refusing to replace an existing wallet`);
      }
    }
    if (wallets.admin && (!wallets.admin.address || !wallets.admin.privateKey)) {
      throw new Error("Existing demo admin wallet is incomplete; refusing to replace it");
    }
  }
  const rolesToCreate = exists ? (wallets.admin ? [] : ["admin"]) : [...ROLES, "admin"];
  if (!rolesToCreate.length) {
    console.log("Demo wallets already include admin; no wallets changed.");
    return;
  }
  if (!FUNDER_KEY) throw new Error("Set FUNDER_KEY to a pre-funded Besu account key");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const funder = new ethers.Wallet(FUNDER_KEY, provider);

  for (const role of rolesToCreate) {
    const w = ethers.Wallet.createRandom();
    wallets[role] = { address: w.address, privateKey: w.privateKey };

    const tx = await funder.sendTransaction({
      to: w.address,
      value: ethers.parseEther("10"),
    });
    await tx.wait();
    console.log(`${role}: ${w.address} funded`);
  }

  fs.writeFileSync("demo-wallets.json", JSON.stringify(wallets, null, 2), { mode: 0o600 });
  console.log(exists ? "Added admin to demo-wallets.json without changing existing wallets." : "Saved demo-wallets.json with admin. Do not commit this file.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
