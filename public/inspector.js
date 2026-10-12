// Read-only order inspector. The contract and checks.json define the checks.
(function () {
  "use strict";
  const ABI = [
    "function registry(address) view returns (string courtName,uint256 validFrom,uint256 validUntil,bool active,uint8 courtLevel,bytes32 territoryCode,uint8 role)",
    "function propertyTerritory(uint256) view returns (bytes32)",
    "function parentTerritory(bytes32) view returns (bytes32)",
    "function territoryName(bytes32) view returns (string)",
    "function parcelDeclaredValue(uint256) view returns (uint256)",
    "function courtLevelMaxValue(uint8) view returns (uint256)",
    "function judgeNonce(address) view returns (uint256)",
    "function usedOrders(bytes32) view returns (bool)",
    "function frozen(uint256) view returns (bool)",
    "function getOrderChecks(uint256,bytes32,uint256,uint256,bytes[]) view returns (uint256)",
    "function getFreezeHistoryLength(uint256) view returns (uint256)",
    "function getFreezeHistoryEntry(uint256,uint256) view returns (uint256 timestamp,string caseNumber,address signer,bool isFreezeAction,uint256 nonce,uint256 checksBitmask)"
  ];
  const ROLES = { 1: "Judge", 2: "Clerk", 3: "Registrar" };
  const LEVELS = { 1: "Munsif", 2: "Sub Court", 3: "District Court", 4: "High Court" };
  let host, provider, config, checksPromise, revision = 0;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const roleName = role => ROLES[Number(role)] || "Unknown";
  const money = value => "₹" + BigInt(value).toLocaleString("en-IN");
  const date = value => new Date(Number(value) * 1000).toLocaleString("en-IN");
  const contractFor = (p = provider, cfg = config) => new ethers.Contract(cfg.contractAddress, ABI, p);

  function digest(order) {
    // Solidity uses abi.encode here, not abi.encodePacked.
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "string", "uint256", "uint256"],
      [order.tokenId, order.caseNumber, order.orderExpiry, order.nonce]
    );
    const hash = ethers.keccak256(encoded);
    return { encoded, hash, signedHash: ethers.hashMessage(ethers.getBytes(hash)) };
  }
  function loadChecks() {
    if (!checksPromise) checksPromise = fetch("checks.json").then(r => {
      if (!r.ok) throw new Error("Cannot load checks.json");
      return r.json();
    }).catch(e => { checksPromise = null; throw e; });
    return checksPromise;
  }
  function attach({ container, provider: p, config: cfg }) {
    if (!container || !p || !cfg) throw new Error("Inspector needs container, provider and config");
    host = container; provider = p; config = cfg;
    host.classList.add("nyaya-inspector");
    host.innerHTML = '<details><summary>Under the hood <span>— inspect the on-chain checks</span></summary><div class="inspector-content" aria-live="polite">Select an order to inspect.</div></details>';
  }
  async function inspect(context, p = provider, cfg = config) {
    if (!context?.order) throw new Error("No order context supplied");
    const order = context.order, d = digest(order), c = contractFor(p, cfg);
    const catalog = await loadChecks();
    const signatures = (context.signatures || []).filter(s => s.signature);
    const block = await p.getBlock("latest");
    const [parcelCode, declaredValue, used, currentFrozen] = await Promise.all([
      c.propertyTerritory(order.tokenId), c.parcelDeclaredValue(order.tokenId),
      c.usedOrders(d.hash), c.frozen(order.tokenId)
    ]);
    const parentCode = await c.parentTerritory(parcelCode);
    const [parcelName, parentName] = await Promise.all([c.territoryName(parcelCode), c.territoryName(parentCode)]);
    const signerInfo = await Promise.all(signatures.map(async item => {
      let recovered, key, territory = "", maxValue = null, nonce = null, error = "";
      try {
        recovered = ethers.verifyMessage(ethers.getBytes(d.hash), item.signature);
        key = await c.registry(recovered);
        territory = await c.territoryName(key.territoryCode);
        if (Number(key.role) === 1) [maxValue, nonce] = await Promise.all([
          c.courtLevelMaxValue(key.courtLevel), c.judgeNonce(recovered)
        ]);
      } catch (e) { error = e.shortMessage || e.message; }
      return { supplied: item.signer, claimedRole: item.role, recovered, key, territory, maxValue, nonce, error };
    }));
    const accepted = context.status === "accepted" || Boolean(context.checksBitmask);
    let bitmask = accepted ? BigInt(context.checksBitmask || 0) :
      await c.getOrderChecks(order.tokenId, d.hash, order.orderExpiry, order.nonce, signatures.map(s => s.signature));
    if (accepted && !bitmask) {
      const count = Number(await c.getFreezeHistoryLength(order.tokenId));
      if (count) bitmask = BigInt((await c.getFreezeHistoryEntry(order.tokenId, count - 1)).checksBitmask);
    }
    const judge = signerInfo.find(s => Number(s.key?.role) === 1);
    const actual = id => {
      switch (id) {
        case "EXPIRY": return `${date(block.timestamp)} ≤ ${date(order.orderExpiry)}`;
        case "REPLAY": return `usedOrders[${d.hash}] = ${used}`;
        case "RECOVER": return `${signerInfo.filter(s => s.recovered).length}/${signatures.length} recovered`;
        case "NO_DUPE": return `${new Set(signerInfo.map(s => s.recovered?.toLowerCase())).size}/${signerInfo.length} unique`;
        case "REGISTRY": return signerInfo.map(s => `${s.recovered || "invalid"}: active=${s.key?.active ?? false}`).join("; ");
        case "VALIDITY": return signerInfo.map(s => s.key ? `${s.recovered}: ${date(s.key.validFrom)}–${date(s.key.validUntil)}` : "no key").join("; ");
        case "JURISDICTION": return signerInfo.map(s => `${roleName(s.key?.role)} ${s.territory || "unknown"} vs ${parcelName || parcelCode} (parent ${parentName || parentCode})`).join("; ");
        case "QUORUM_JUDGE": return `${signerInfo.filter(s => Number(s.key?.role) === 1).length} judge(s)`;
        case "QUORUM_CLERK": return `${signerInfo.filter(s => Number(s.key?.role) === 2).length} clerk(s)`;
        case "QUORUM_REGISTRAR": return `${signerInfo.filter(s => Number(s.key?.role) === 3).length} registrar(s)`;
        case "NONCE": return `provided ${order.nonce}; judge expected ${judge?.nonce ?? "unknown"}`;
        case "PECUNIARY": return `${money(declaredValue)} ≤ ${judge?.maxValue == null ? "unknown" : money(judge.maxValue)} (${LEVELS[Number(judge?.key?.courtLevel)] || "unknown level"})`;
        case "FROZEN_STATE": return `currently frozen=${currentFrozen}`;
        default: return "Read from contract";
      }
    };
    return { order, d, signerInfo, parcelCode, parcelName, parentName, declaredValue, bitmask: BigInt(bitmask), accepted, checks: catalog.checks.filter(ch => ch.actions.includes(order.action || "freeze")), actual, block };
  }
  async function setOrder(context) {
    if (!host) return;
    const current = ++revision, out = host.querySelector(".inspector-content");
    out.textContent = "Reading chain and checking signatures…";
    try {
      const v = await inspect(context);
      if (current !== revision) return;
      const signerRows = v.signerInfo.map((s, i) => `<tr><td>${i + 1}</td><td><code>${esc(s.recovered || s.error)}</code>${s.supplied && s.recovered?.toLowerCase() !== s.supplied.toLowerCase() ? " ⚠ Claimed address differs" : ""}</td><td>${esc(roleName(s.key?.role))}</td><td>${esc(s.key?.courtName || "—")} · ${esc(LEVELS[Number(s.key?.courtLevel)] || "—")}</td><td>${s.key ? `${s.key.active && Number(v.block.timestamp) >= Number(s.key.validFrom) && Number(v.block.timestamp) <= Number(s.key.validUntil) ? "Valid" : "Invalid"} (${esc(date(s.key.validFrom))}–${esc(date(s.key.validUntil))})` : "—"}</td></tr>`).join("");
      const checkRows = v.checks.map(ch => `<tr><td>${ch.bit}</td><td>${esc(ch.name)}</td><td>${esc(v.actual(ch.id))}</td><td class="${v.bitmask & (1n << BigInt(ch.bit)) ? "check-pass" : "check-fail"}">${v.bitmask & (1n << BigInt(ch.bit)) ? "PASS" : "FAIL"}</td></tr>`).join("");
      out.innerHTML = `<section><h3>Order digest</h3><dl><dt>Fields</dt><dd>Token ${esc(v.order.tokenId)} · ${esc(v.order.caseNumber)} · expiry ${esc(v.order.orderExpiry)} · nonce ${esc(v.order.nonce)}</dd><dt>Encoding</dt><dd>Solidity <code>abi.encode(uint256,string,uint256,uint256)</code> (not packed)</dd><dt>ABI bytes</dt><dd><code>${esc(v.d.encoded)}</code></dd><dt>keccak256</dt><dd><code>${esc(v.d.hash)}</code></dd><dt>EIP-191</dt><dd><code>\\x19Ethereum Signed Message:\\n32 || digest</code> → <code>${esc(v.d.signedHash)}</code></dd></dl></section>
        <section><h3>Signatures</h3><div class="inspector-scroll"><table><thead><tr><th>#</th><th>Recovered signer</th><th>Role</th><th>Court / level</th><th>Validity at latest block</th></tr></thead><tbody>${signerRows || '<tr><td colspan="5">No signatures supplied yet</td></tr>'}</tbody></table></div></section>
        <section><h3>Jurisdiction</h3><p>Parcel ${esc(v.parcelName || v.parcelCode)} → ${esc(v.parentName || "no parent")}; declared value ${esc(money(v.declaredValue))}.</p><p>${v.signerInfo.map(s => `${esc(roleName(s.key?.role))}: ${esc(s.territory || "unknown")}${Number(s.key?.role) === 3 ? " (national exemption)" : ""}`).join(" · ") || "Awaiting signatures"}</p></section>
        <section><h3>${v.accepted ? "Stored acceptance" : "Preflight"} checks</h3><p>Bitmask <code>0x${v.bitmask.toString(16)}</code> ${v.accepted ? "from accepted order" : "from getOrderChecks at latest block"}</p><div class="inspector-scroll"><table><thead><tr><th>Bit</th><th>Check</th><th>Actual comparison</th><th>Result</th></tr></thead><tbody>${checkRows}</tbody></table></div></section>`;
    } catch (e) { if (current === revision) out.textContent = `Inspector could not read this order: ${e.shortMessage || e.message}`; }
  }
  window.NyayaInspector = { attach, setOrder, inspect, digest, loadChecks, ABI, roleName, money };
})();
