require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun"
    }
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      gas: 12000000
    }
  }
};
