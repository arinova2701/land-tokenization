/**
 * generate-keys.js
 *
 * Run once before starting the Besu network:
 *   node docker/generate-keys.js
 *
 * What it does:
 *   1. Generates 4 random validator key pairs
 *   2. Writes private keys to docker/nodes/nodeN/key (raw hex, no 0x)
 *   3. Computes QBFT genesis extraData from the validator addresses
 *   4. Writes docker/genesis.json  (QBFT, Cancun-enabled, chain ID 1337)
 *   5. Writes docker/docker-compose.yml  (4 Besu validator nodes)
 *
 * Re-running this script will regenerate everything and reset the network.
 * Delete docker/nodes/nodeN/database/ to wipe existing chain data.
 */

const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

// ── Hardhat deterministic accounts (from "test test ... junk" mnemonic) ──────
// We pre-fund these in genesis alloc so the same accounts work on Besu as on
// the local Hardhat node, and all existing tests / deploy scripts run unchanged.
// Addresses for the first 5 Hardhat deterministic accounts.
// Must match HARDHAT_KEYS in hardhat.config.js.
const HARDHAT_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // #0 admin
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // #1 judgeVellore
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // #2 judgeKadapa
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // #3 outsider
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", // #4 attacker
];

const CHAIN_ID    = 1337;
const DOCKER_DIR  = __dirname;
const NODES_DIR   = path.join(DOCKER_DIR, "nodes");

// ── Balance large enough to cover all test transactions ──────────────────────
const GENESIS_BALANCE = "0x200000000000000000000000000000000000000000000000000000000000000";

function main() {
  // 1. Generate 4 validator wallets
  const validators = [];
  for (let i = 1; i <= 4; i++) {
    const wallet = ethers.Wallet.createRandom();
    // Uncompressed public key = 0x04 + 64 bytes; enode needs the 64-byte part only
    const pubKeyHex = wallet.signingKey.publicKey.slice(4); // strip '04' prefix
    validators.push({
      index:      i,
      address:    wallet.address,
      privateKey: wallet.privateKey.slice(2), // strip '0x'
      pubKeyHex,
    });
  }

  // 2. Write key files
  for (const v of validators) {
    const dir = path.join(NODES_DIR, `node${v.index}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "key"),     v.privateKey,  "utf8");
    fs.writeFileSync(path.join(dir, "key.pub"), v.pubKeyHex,   "utf8");
  }

  // 3. Build QBFT genesis extraData
  //
  //    Besu 26.x QbftExtraDataCodec encodes/decodes EXACTLY 5 items:
  //
  //      RLP([
  //        bytes32 vanity,          -- 32 zero bytes
  //        List[bytes20 validator], -- sorted validator addresses
  //        <null vote>,             -- empty list  (RLP: c0) — Besu's nextIsNull() checks for empty list
  //        <round int scalar>,      -- empty bytes (RLP: 80) — readIntScalar(0x80) == 0
  //        List[] seals             -- empty list  (RLP: c0)
  //      ])
  //
  //    4-item format [vanity, validators, [], []] fails with:
  //    "Cannot read a int scalar, current item is a list"
  //    because Besu calls readIntScalar() on what it expects to be item[3]=round,
  //    but finds the seals list (c0) there instead.
  //
  //    First format tried (IBFT 2.0 style: 0x + 32 raw zeros + RLP(validators) + 65 raw zeros)
  //    failed with "Expected current item to be a list, but it is: BYTE_ELEMENT".
  const sortedAddresses = [...validators.map(v => v.address)]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const extraData = ethers.encodeRlp([
    ethers.getBytes("0x" + "00".repeat(32)),            // [0] vanity: 32 zero bytes
    sortedAddresses.map(addr => ethers.getBytes(addr)), // [1] validators (sorted)
    [],                                                 // [2] no vote   (empty list = null)
    new Uint8Array(0),                                  // [3] round = 0 (empty bytes = int scalar 0)
    [],                                                 // [4] no seals  (empty list)
  ]);

  // 4. Build alloc — fund validators + all hardhat accounts
  const alloc = {};
  for (const addr of [...HARDHAT_ACCOUNTS, ...validators.map(v => v.address)]) {
    alloc[addr.toLowerCase()] = { balance: GENESIS_BALANCE };
  }

  // 5. Write genesis.json
  const genesis = {
    config: {
      chainId: CHAIN_ID,
      // Block-based forks — all at 0 so the chain starts fully upgraded
      homesteadBlock:      0,
      eip150Block:         0,
      eip155Block:         0,
      eip158Block:         0,
      byzantiumBlock:      0,
      constantinopleBlock: 0,
      petersburgBlock:     0,
      istanbulBlock:       0,
      muirGlacierBlock:    0,
      berlinBlock:         0,
      londonBlock:         0,
      // Timestamp-based forks — 0 means active from genesis
      shanghaiTime: 0,
      cancunTime:   0,   // required for mcopy (OpenZeppelin v5 Bytes.sol)
      // QBFT consensus
      qbft: {
        blockperiodseconds:      2,
        epochlength:             30000,
        requesttimeoutseconds:   4,
      },
    },
    nonce:      "0x0",
    timestamp:  "0x0",
    gasLimit:   "0x1fffffffffffff",
    difficulty: "0x1",
    // Besu QBFT marker in mixHash
    mixHash:    "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
    coinbase:   "0x0000000000000000000000000000000000000000",
    alloc,
    extraData,
  };

  fs.writeFileSync(
    path.join(DOCKER_DIR, "genesis.json"),
    JSON.stringify(genesis, null, 2),
    "utf8"
  );

  // 6. Write docker-compose.yml
  // Besu rejects hostnames in --bootnodes; it requires an IP address.
  // We assign a static IP to node1 on a private subnet so the enode URL
  // is stable across restarts.
  const NODE1_IP = "172.28.0.10";
  const bootnodeEnode =
    `enode://${validators[0].pubKeyHex}@${NODE1_IP}:30303`;

  const compose = buildCompose(validators, bootnodeEnode);
  fs.writeFileSync(
    path.join(DOCKER_DIR, "docker-compose.yml"),
    compose,
    "utf8"
  );

  // 7. Print summary
  console.log("Besu 4-node QBFT network configured\n");
  console.log("Validators:");
  for (const v of validators) {
    console.log(`  node${v.index}: ${v.address}`);
  }
  console.log("\nBootnode enode:");
  console.log("  " + bootnodeEnode.slice(0, 70) + "...");
  console.log("\nPre-funded accounts (Hardhat deterministic):");
  for (const a of HARDHAT_ACCOUNTS.slice(0, 5)) {
    console.log("  " + a);
  }
  console.log("\nFiles written:");
  console.log("  docker/nodes/nodeN/key  (validator private keys)");
  console.log("  docker/genesis.json");
  console.log("  docker/docker-compose.yml");
  console.log("\nNext steps:");
  console.log("  1. docker compose -f docker/docker-compose.yml up -d");
  console.log("  2. npx hardhat run scripts/deploy-besu.js --network besu");
  console.log("  3. npx hardhat test test/negative-corpus.js --network besu");
}

// ── docker-compose.yml generator ─────────────────────────────────────────────

// Static IPs on a private /24 — node1 is always .10, others .11/.12/.13
const SUBNET  = "172.28.0.0/24";
const NODE_IPS = ["172.28.0.10", "172.28.0.11", "172.28.0.12", "172.28.0.13"];

function nodeService(v, bootnodeEnode, isBootnode) {
  const isNode1 = v.index === 1;
  const bootnodesFlag = isBootnode
    ? ""
    : `      --bootnodes=${bootnodeEnode}\n`;

  // Only node1 exposes the RPC port to the host
  const ports = isNode1
    ? `    ports:\n      - "8545:8545"\n      - "8546:8546"\n`
    : "";

  const ip = NODE_IPS[v.index - 1];

  return `  node${v.index}:
    image: hyperledger/besu:latest
    container_name: besu-node${v.index}
    volumes:
      - ./genesis.json:/genesis.json:ro
      - ./nodes/node${v.index}:/keys:ro
      - node${v.index}-data:/data
    command: >
      --data-path=/data
      --genesis-file=/genesis.json
      --node-private-key-file=/keys/key
      --rpc-http-enabled
      --rpc-http-host=0.0.0.0
      --rpc-http-port=8545
      --rpc-http-api=ETH,NET,QBFT,ADMIN,TXPOOL
      --rpc-ws-enabled
      --rpc-ws-host=0.0.0.0
      --rpc-ws-port=8546
      --host-allowlist="*"
      --rpc-http-cors-origins="all"
      --p2p-port=30303
      --p2p-host=${ip}
      --min-gas-price=0
${bootnodesFlag}    networks:
      besu-net:
        ipv4_address: ${ip}
${ports}`;
}

function buildCompose(validators, bootnodeEnode) {
  const services = validators
    .map(v => nodeService(v, bootnodeEnode, v.index === 1))
    .join("\n");

  const volumes = validators
    .map(v => `  node${v.index}-data:`)
    .join("\n");

  return `services:
${services}
networks:
  besu-net:
    driver: bridge
    ipam:
      config:
        - subnet: ${SUBNET}

volumes:
${volumes}
`;
}

main();
