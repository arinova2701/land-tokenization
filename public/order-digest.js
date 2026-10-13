/**
 * order-digest.js — Shared order digest helper for NyayaChain.
 *
 * Exports NyayaDigest.compute(), which mirrors the on-chain
 * computeOrderDigest() in CourtKeyRegistry.sol (Sprint 0c).
 *
 * Digest recipe:
 *   keccak256(abi.encode(
 *     chainId,                  // uint256
 *     contractAddress,          // address
 *     action,                   // uint8  (FREEZE=0, UNFREEZE=1)
 *     tokenId,                  // uint256
 *     keccak256(bytes(caseNumber)),  // bytes32
 *     orderExpiry,              // uint256
 *     nonce                     // uint256
 *   ))
 *
 * Works in both browser (ethers global) and Node.js (require('ethers')).
 */
(function () {
  "use strict";

  // Resolve ethers: global in browser, require() in Node.
  function getEthers() {
    if (typeof ethers !== "undefined") return ethers;
    if (typeof require !== "undefined") return require("ethers");
    throw new Error("NyayaDigest: ethers library not found");
  }

  const NyayaDigest = {
    /** Freeze action constant — matches CourtKeyRegistry.FREEZE */
    FREEZE: 0,

    /** Unfreeze action constant — matches CourtKeyRegistry.UNFREEZE */
    UNFREEZE: 1,

    /**
     * Compute the order digest.
     *
     * @param {string|number} action       "freeze"/0 or "unfreeze"/1
     * @param {number|bigint} tokenId      Property token identifier
     * @param {string}        caseNumber   Court case number string
     * @param {number|bigint} orderExpiry  Unix timestamp (seconds)
     * @param {number|bigint} nonce        Per-judge sequential counter
     * @param {number|bigint} chainId      EVM chain ID
     * @param {string}        contractAddress  CourtKeyRegistry address (checksummed or lowercase hex)
     * @returns {string} 0x-prefixed 32-byte hex digest
     */
    compute(action, tokenId, caseNumber, orderExpiry, nonce, chainId, contractAddress) {
      const lib = getEthers();
      const actionValue =
        typeof action === "string" ? (action === "freeze" ? 0 : 1) : Number(action);
      const caseHash = lib.keccak256(lib.toUtf8Bytes(caseNumber));
      const encoded = lib.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "uint8", "uint256", "bytes32", "uint256", "uint256"],
        [chainId, contractAddress, actionValue, tokenId, caseHash, orderExpiry, nonce]
      );
      return lib.keccak256(encoded);
    }
  };

  // Browser global
  if (typeof window !== "undefined") window.NyayaDigest = NyayaDigest;
  // Node.js module
  if (typeof module !== "undefined" && module.exports) module.exports = { NyayaDigest };
})();
