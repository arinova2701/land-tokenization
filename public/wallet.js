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

  // ── Session ──────────────────────────────────────────────────────────────────
  // _session is kept in sync by _refreshSession and updated on account/chain change.
  let _session = null;

  /**
   * Re-reads the on-chain role for the current account and updates _session.
   * Fires "nyaya:session-changed" on window after every update.
   */
  async function _refreshSession() {
    try {
      if (!window.ethereum) { _session = null; _fireSessionChanged(); return; }
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (!accounts || accounts.length === 0) { _session = null; _fireSessionChanged(); return; }

      const address = accounts[0];
      const provider = new ethers.BrowserProvider(window.ethereum);
      const config = await fetch("/config.json").then(r => r.json());
      const abi = [
        "function registry(address) view returns (string courtName, uint256 validFrom, uint256 validUntil, bool active, uint8 courtLevel, bytes32 territoryCode, uint8 role)"
      ];
      const contract = new ethers.Contract(config.contractAddress, abi, provider);
      const key = await contract.registry(address);
      const roleMap = { 1: "JUDGE", 2: "CLERK", 3: "REGISTRAR" };
      _session = {
        address,
        role: key.active ? (roleMap[Number(key.role)] || null) : null,
        courtName: key.courtName || ""
      };
    } catch (_) {
      _session = null;
    }
    _fireSessionChanged();
  }

  function _fireSessionChanged() {
    window.dispatchEvent(new CustomEvent("nyaya:session-changed", { detail: _session }));
  }

  /**
   * Returns the current session synchronously, or null if not connected.
   * Shape: { address, role: "JUDGE"|"CLERK"|"REGISTRAR"|null, courtName }
   */
  function getSession() {
    return _session;
  }

  // Keep session in sync with MetaMask account/chain changes.
  if (window.ethereum) {
    window.ethereum.on("accountsChanged", _refreshSession);
    window.ethereum.on("chainChanged", () => window.location.reload());
  }

  // Auto-reconnect on load (no popup) and initialise session.
  _refreshSession();

  window.NyayaWallet = { connectWallet, onWalletChange, signOrderHash, getSession };
})();
