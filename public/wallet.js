// public/wallet.js
// Wallet connection, on-chain role detection and the shared session.
// Session API is defined in docs/interfaces.md §5.
(function () {
  const CHAIN_ID = 1337; // config.chainId from docker/genesis.json
  const RPC_URL = "http://127.0.0.1:8545";
  const METAMASK_URL = "https://metamask.io/download/";
  const SIGNED_OUT_KEY = "nyaya:signedOut";
  const ROLE_MAP = { 1: "JUDGE", 2: "CLERK", 3: "REGISTRAR" };
  const REGISTRY_ABI = [
    "function registry(address) view returns (string courtName, uint256 validFrom, uint256 validUntil, bool active, uint8 courtLevel, bytes32 territoryCode, uint8 role)"
  ];

  // ── Small helpers ────────────────────────────────────────────────────────────
  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (_) { /* storage unavailable: behaviour degrades to no persistence */ }
  }

  function hasMetaMask() { return !!window.ethereum; }

  /** Error thrown when no injected wallet exists; carries the install link. */
  function missingWalletError() {
    const err = new Error("MetaMask not found. Install it from " + METAMASK_URL + " to continue.");
    err.code = "NO_WALLET";
    err.installUrl = METAMASK_URL;
    return err;
  }

  function shortAddress(addr) {
    return addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "";
  }

  async function currentChainId() {
    const hex = await window.ethereum.request({ method: "eth_chainId" });
    return parseInt(hex, 16);
  }

  /** True when a wallet is present but not on the NyayaChain network. */
  async function isWrongNetwork() {
    if (!hasMetaMask()) return false;
    try { return (await currentChainId()) !== CHAIN_ID; } catch (_) { return false; }
  }

  /** Prompts MetaMask to switch to (or add) the NyayaChain network. */
  async function ensureNetwork() {
    if (!hasMetaMask()) throw missingWalletError();
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

  // ── Session ──────────────────────────────────────────────────────────────────
  // _session is kept in sync by _refreshSession and updated on account/chain change.
  let _session = null;
  let _refreshSeq = 0;
  let _configPromise = null;

  function loadConfig() {
    if (!_configPromise) {
      _configPromise = fetch("config.json").then(r => r.json()).catch(e => { _configPromise = null; throw e; });
    }
    return _configPromise;
  }

  function _fireSessionChanged() {
    window.dispatchEvent(new CustomEvent("nyaya:session-changed", { detail: _session }));
  }

  /**
   * Re-reads the connected account and its on-chain role, updates the session and
   * fires "nyaya:session-changed". Uses eth_accounts only, so it never opens a popup.
   * A signed-out flag stops auto-reconnect until the user connects again.
   */
  async function _refreshSession() {
    const seq = ++_refreshSeq;
    let next = null;
    try {
      if (hasMetaMask() && storageGet(SIGNED_OUT_KEY) !== "1") {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts && accounts.length > 0) {
          const address = accounts[0];
          next = { address, role: null, courtName: "" };
          // Role lookup only makes sense on the right chain.
          if (!(await isWrongNetwork())) {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const config = await loadConfig();
            const contract = new ethers.Contract(config.contractAddress, REGISTRY_ABI, provider);
            const key = await contract.registry(address);
            next = {
              address,
              role: key.active ? (ROLE_MAP[Number(key.role)] || null) : null,
              courtName: key.courtName || ""
            };
          }
        }
      }
    } catch (_) {
      // Keep the address if we had one; role stays null when the registry read fails.
      next = next || null;
    }
    if (seq !== _refreshSeq) return _session; // a newer refresh superseded this one
    _session = next;
    _fireSessionChanged();
    return _session;
  }

  /**
   * Returns the current session synchronously, or null if not connected.
   * Shape: { address, role: "JUDGE"|"CLERK"|"REGISTRAR"|null, courtName }
   */
  function getSession() {
    return _session;
  }

  // ── Connect / sign out / switch ─────────────────────────────────────────────
  /**
   * Opens the MetaMask connect popup, switches to the NyayaChain network if needed,
   * and refreshes the session. Only login.html should call this.
   */
  async function connectWallet() {
    if (!hasMetaMask()) throw missingWalletError();
    storageSet(SIGNED_OUT_KEY, null);
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureNetwork();
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    await _refreshSession();
    return { provider, signer, address };
  }

  /**
   * Signs out of the app. MetaMask cannot be disconnected by a page in every version,
   * so we also set a flag that stops auto-reconnect, and revoke permissions when supported.
   */
  async function signOut() {
    storageSet(SIGNED_OUT_KEY, "1");
    if (hasMetaMask()) {
      try {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch (_) { /* older MetaMask: the signed-out flag is enough */ }
    }
    _refreshSeq++;
    _session = null;
    _fireSessionChanged();
  }

  /** Asks MetaMask to let the user pick a different account, then refreshes the session. */
  async function switchAccount() {
    if (!hasMetaMask()) throw missingWalletError();
    storageSet(SIGNED_OUT_KEY, null);
    await window.ethereum.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
    await _refreshSession();
    return _session;
  }

  // Kept for existing callers: runs the callback on account change.
  function onWalletChange(callback) {
    if (!hasMetaMask()) return;
    window.ethereum.on("accountsChanged", callback);
  }

  // Signs the order hash so it matches ECDSA + MessageHashUtils on-chain.
  async function signOrderHash(signer, orderHash) {
    return signer.signMessage(ethers.getBytes(orderHash));
  }

  // Keep the session in sync with MetaMask. A chain change re-detects the role
  // (no page reload) so pages can show a wrong-network message instead of breaking.
  if (hasMetaMask()) {
    window.ethereum.on("accountsChanged", (accounts) => {
      // The user picked an account in MetaMask itself: treat that as intent to connect.
      // An empty list (disconnect/revoke) must not clear the signed-out flag.
      if (accounts && accounts.length > 0) storageSet(SIGNED_OUT_KEY, null);
      _refreshSession();
    });
    window.ethereum.on("chainChanged", () => { _refreshSession(); });
  }

  // Auto-reconnect on load (no popup) and initialise the session.
  const ready = _refreshSession();

  // ── Shared session header ───────────────────────────────────────────────────
  // Where each role belongs after login. No role (or no wallet) means the public page.
  const ROLE_HOME = { JUDGE: "court.html", CLERK: "court.html", REGISTRAR: "registrar.html" };
  function homeFor(role) { return ROLE_HOME[role] || "index.html"; }

  const ROLE_COLORS = {
    JUDGE:     { bg: "#DBEAFE", fg: "#1D4ED8" },
    CLERK:     { bg: "#FEF3C7", fg: "#B45309" },
    REGISTRAR: { bg: "#DCFCE7", fg: "#15803D" },
    NONE:      { bg: "#E2E8F0", fg: "#475569" },
  };

  const HEADER_CSS =
    ".ny-session{display:flex;align-items:center;flex-wrap:wrap;gap:12px;max-width:1200px;margin:0 auto 16px;" +
    "padding:12px 20px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;font-size:16px;color:#475569}" +
    ".ny-badge{padding:3px 12px;border-radius:999px;font-weight:700;font-size:14px;letter-spacing:.5px}" +
    ".ny-addr{font-family:monospace;font-size:15px;color:#0F172A}" +
    ".ny-court{color:#64748B;font-size:15px}" +
    ".ny-spacer{flex:1}" +
    ".ny-btn{border:1px solid #CBD5E1;background:#fff;color:#0F172A;padding:7px 16px;border-radius:8px;font-size:15px;cursor:pointer;font-family:inherit}" +
    ".ny-btn:hover{background:#F1F5F9}" +
    ".ny-warn{max-width:1200px;margin:0 auto 16px;padding:12px 20px;background:#FEF3C7;border:1px solid #FCD34D;" +
    "border-radius:10px;color:#92400E;font-size:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}";

  function injectHeaderCss() {
    if (document.getElementById("ny-session-css")) return;
    const style = document.createElement("style");
    style.id = "ny-session-css";
    style.textContent = HEADER_CSS;
    document.head.appendChild(style);
  }

  function redirectToLogin(reason, extra) {
    const params = new URLSearchParams({ reason });
    if (extra) for (const k of Object.keys(extra)) params.set(k, extra[k]);
    window.location.replace("login.html?" + params.toString());
  }

  /**
   * Renders the shared session header into `container` and guards the page.
   *   allowedRoles: roles that may use this page, e.g. ["JUDGE", "CLERK"].
   *   onSession(session): called once the user is allowed in, and again on every
   *                       later session change that is still allowed.
   * No wallet or a role outside allowedRoles sends the user to login.html with a reason.
   * A wrong MetaMask network shows a switch prompt instead of redirecting.
   */
  async function mountHeader({ container, allowedRoles, onSession }) {
    injectHeaderCss();
    const root = typeof container === "string" ? document.querySelector(container) : container;
    await ready;

    let leaving = false; // set while signing out, so the cleared session does not trigger a second redirect
    async function render() {
      if (leaving) return;
      const s = getSession();
      if (!hasMetaMask()) { redirectToLogin("nowallet"); return; }
      if (!s) { redirectToLogin("connect"); return; }
      if (await isWrongNetwork()) {
        root.innerHTML =
          '<div class="ny-warn"><span>MetaMask is on the wrong network. NyayaChain runs on chain ' + CHAIN_ID + '.</span>' +
          '<button class="ny-btn" id="ny-switch-net">Switch network</button></div>';
        root.querySelector("#ny-switch-net").onclick = async () => {
          try { await ensureNetwork(); } catch (_) { /* user declined */ }
        };
        return;
      }
      if (!allowedRoles.includes(s.role)) {
        redirectToLogin("wrongrole", { role: s.role || "NONE", need: allowedRoles.join(",") });
        return;
      }
      const c = ROLE_COLORS[s.role] || ROLE_COLORS.NONE;
      root.innerHTML =
        '<div class="ny-session">' +
          '<span class="ny-badge" style="background:' + c.bg + ';color:' + c.fg + '">' + s.role + '</span>' +
          '<span class="ny-addr" title="' + s.address + '">' + shortAddress(s.address) + '</span>' +
          '<span class="ny-court"></span>' +
          '<span class="ny-spacer"></span>' +
          '<button class="ny-btn" id="ny-switch">Switch account</button>' +
          '<button class="ny-btn" id="ny-signout">Sign out</button>' +
        '</div>';
      root.querySelector(".ny-court").textContent = s.courtName; // court name comes from chain: never as HTML
      root.querySelector("#ny-signout").onclick = async () => {
        leaving = true;
        await signOut();
        redirectToLogin("signedout");
      };
      root.querySelector("#ny-switch").onclick = async () => {
        try { await switchAccount(); } catch (_) { /* user declined */ }
      };
      if (onSession) onSession(s);
    }

    window.addEventListener("nyaya:session-changed", render);
    await render();
  }

  window.NyayaWallet = {
    CHAIN_ID,
    METAMASK_URL,
    hasMetaMask,
    isWrongNetwork,
    ensureNetwork,
    connectWallet,
    signOut,
    switchAccount,
    onWalletChange,
    signOrderHash,
    getSession,
    homeFor,
    mountHeader,
    shortAddress,
    ready,
  };
})();
