// public/wallet.js
(function () {
  const CHAIN_ID = 1337; // config.chainId from docker/genesis.json
  const RPC_URL = "http://127.0.0.1:8545";

  async function ensureNetwork() {
    const hex = "0x" + CHAIN_ID.toString(16);
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }],
      });
    } catch (err) {
      if (err.code === 4902 || err.code === -32603) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: "NyayaChain Besu QBFT",
              rpcUrls: [RPC_URL],
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      throw new Error("MetaMask not found. Install it to continue.");
    }
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureNetwork();
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    return { provider, signer, address };
  }

  function onWalletChange(callback) {
    if (!window.ethereum) return;
    window.ethereum.on("accountsChanged", callback);
    window.ethereum.on("chainChanged", () => window.location.reload());
  }

  // Signs the order hash so it matches ECDSA + MessageHashUtils on-chain.
  // Verify this against the contract's signature recovery before relying on it.
  async function signOrderHash(signer, orderHash) {
    return signer.signMessage(ethers.getBytes(orderHash));
  }

  window.NyayaWallet = { connectWallet, onWalletChange, signOrderHash };
})();
