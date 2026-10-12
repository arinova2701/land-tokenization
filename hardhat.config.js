require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

// First 7 Hardhat deterministic private keys (from "test test ... junk" mnemonic).
// Accounts #0–#6.  #0–#4 were pre-funded in docker/genesis.json.
// Sprint 0b adds #5 (clerkVellore) and #6 (clerkKadapa); update genesis.json
// with their addresses before running the Besu test suite.
const HARDHAT_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // #0 admin
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1 judgeVellore
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2 judgeKadapa
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // #3 outsider
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // #4 attacker
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // #5 clerkVellore
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // #6 clerkKadapa
];

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      gas: 12000000,
    },
    // 4-node Besu QBFT network (docker/docker-compose.yml)
    // Start with: docker compose -f docker/docker-compose.yml up -d
    // node1 exposes RPC on host port 8545
    besu: {
      url:      "http://127.0.0.1:8545",
      chainId:  1337,
      accounts: HARDHAT_KEYS,
      gas:      12000000,
      // Besu QBFT has ~2s block time; allow longer polling
      timeout:  120000,
    },
  },
};
