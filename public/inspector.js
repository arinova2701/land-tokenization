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
    "function computeOrderDigest(uint8,uint256,string,uint256,uint256) view returns (bytes32)",
    "function getOrderChecks(uint8,uint256,string,uint256,uint256,bytes[]) view returns (uint256)",
    "function getFreezeHistoryLength(uint256) view returns (uint256)",
    "function getFreezeHistoryEntry(uint256,uint256) view returns (uint256 timestamp,string caseNumber,address signer,bool isFreezeAction,uint256 nonce,uint256 checksBitmask)"
  ];
  const ROLES = { 1: "Judge", 2: "Clerk", 3: "Registrar" };
  const LEVELS = { 1: "Munsif", 2: "Sub Court", 3: "District Court", 4: "High Court" };
  let host, provider, config, checksPromise, revision = 0, _chainId = 1337;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const roleName = role => ROLES[Number(role)] || "Unknown";
  const money = value => "₹" + BigInt(value).toLocaleString("en-IN");
  const date = value => new Date(Number(value) * 1000).toLocaleString("en-IN");
  const contractFor = (p = provider, cfg = config) => new ethers.Contract(cfg.contractAddress, ABI, p);

  function digest(order) {
    // Sprint 0c: digest binds to chainId, contract address, action, and all order fields.
    const hash = NyayaDigest.compute(
      order.action || "freeze", order.tokenId, order.caseNumber,
      order.orderExpiry, order.nonce, _chainId, config.contractAddress
    );
    const encoded = "(computed by NyayaDigest.compute — see public/order-digest.js)";
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
    p.getNetwork().then(net => { _chainId = Number(net.chainId); }).catch(() => {});
    host.classList.add("nyaya-inspector");
    host.innerHTML = '<details><summary>Under the hood <span>— inspect the on-chain checks</span></summary><div class="inspector-content" aria-live="polite">Select an order to inspect.</div></details>';
  }
  async function inspect(context, p = provider, cfg = config) {
    if (!context?.order) throw new Error("No order context supplied");
    const order = context.order, d = digest(order), c = contractFor(p, cfg);
    const catalog = await loadChecks();
    const signatures = (context.signatures || []).filter(s => s.signature);
    const accepted = context.status === "accepted";
    const receipt = accepted && context.txHash ? await p.getTransactionReceipt(context.txHash) : null;
    const block = await p.getBlock(receipt?.blockNumber ?? "latest");
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
    const actionId = (order.action === "unfreeze") ? 1 : 0;
    // Also verify the on-chain digest matches (Sprint 0c: computeOrderDigest is public)
    const onChainDigest = await c.computeOrderDigest(actionId, order.tokenId, order.caseNumber, order.orderExpiry, order.nonce);
    const digestMatch = onChainDigest.toLowerCase() === d.hash.toLowerCase();
    let bitmask = accepted ? BigInt(context.checksBitmask || 0) :
      await c.getOrderChecks(actionId, order.tokenId, order.caseNumber, order.orderExpiry, order.nonce, signatures.map(s => s.signature));
    const rawPreflightBitmask = BigInt(bitmask);
    if (accepted && !bitmask) {
      const count = Number(await c.getFreezeHistoryLength(order.tokenId));
      if (count) bitmask = BigInt((await c.getFreezeHistoryEntry(order.tokenId, count - 1)).checksBitmask);
    }
    const judge = signerInfo.find(s => Number(s.key?.role) === 1);
    const [usedAtCheck, nonceAtCheck] = receipt && judge ? await Promise.all([
      c.usedOrders(d.hash,{blockTag:receipt.blockNumber-1}),
      c.judgeNonce(judge.recovered,{blockTag:receipt.blockNumber-1})
    ]) : [used,judge?.nonce];
    const actual = id => {
      switch (id) {
        case "EXPIRY": return `${date(block.timestamp)} ≤ ${date(order.orderExpiry)}`;
        case "REPLAY": return `usedOrders[${d.hash}] = ${usedAtCheck}`;
        case "RECOVER": return `${signerInfo.filter(s => s.recovered).length}/${signatures.length} recovered`;
        case "NO_DUPE": return `${new Set(signerInfo.map(s => s.recovered?.toLowerCase())).size}/${signerInfo.length} unique`;
        case "REGISTRY": return signerInfo.map(s => `${s.recovered || "invalid"}: active=${s.key?.active ?? false}`).join("; ");
        case "VALIDITY": return signerInfo.map(s => s.key ? `${s.recovered}: ${date(s.key.validFrom)}–${date(s.key.validUntil)}` : "no key").join("; ");
        case "JURISDICTION": return signerInfo.map(s => `${roleName(s.key?.role)} ${s.territory || "unknown"} vs ${parcelName || parcelCode} (parent ${parentName || parentCode})`).join("; ");
        case "QUORUM_JUDGE": return `${signerInfo.filter(s => Number(s.key?.role) === 1).length} judge(s)`;
        case "QUORUM_CLERK": return `${signerInfo.filter(s => Number(s.key?.role) === 2).length} clerk(s)`;
        case "QUORUM_REGISTRAR": return `${signerInfo.filter(s => Number(s.key?.role) === 3).length} registrar(s)`;
        case "NONCE": return `provided ${order.nonce}; judge expected ${nonceAtCheck ?? "unknown"}`;
        case "PECUNIARY": return `${money(declaredValue)} ≤ ${judge?.maxValue == null ? "unknown" : money(judge.maxValue)} (${LEVELS[Number(judge?.key?.courtLevel)] || "unknown level"})`;
        case "FROZEN_STATE": return `currently frozen=${currentFrozen}`;
        default: return "Read from contract";
      }
    };
    return { order, d, digestMatch, onChainDigest, signerInfo, parcelCode, parcelName, parentName, declaredValue, used, currentFrozen, rawPreflightBitmask, bitmask: BigInt(bitmask), accepted, checks: catalog.checks.filter(ch => ch.actions.includes(order.action || "freeze")), actual, block };
  }
  async function extraPanels(context, v) {
    const judge = v.signerInfo.find(s => Number(s.key?.role) === 1);
    const nonce = judge?.nonce == null ? "unknown" : judge.nonce.toString();
    const replay = `<section><h3>Replay and nonce</h3><p>usedOrders[${esc(v.d.hash)}] = <strong>${v.used}</strong>. Judge nonce currently <strong>${esc(nonce)}</strong>; order supplied <strong>${esc(v.order.nonce)}</strong>.${v.accepted ? " The current nonce has advanced since this accepted order." : ""}</p></section>`;
    let receipt = null;
    if (context.txHash) receipt = await provider.getTransactionReceipt(context.txHash);
    let before = "not available", after = String(v.currentFrozen);
    let gas = "—", events = "—", blockText = "Awaiting submission", txState = "Not submitted";
    if (receipt) {
      const blockNumber = receipt.blockNumber;
      const propertyHash = ethers.keccak256(ethers.solidityPacked(["string","uint256"],["parcel",v.order.tokenId]));
      const propertyAddress = ethers.getAddress("0x"+propertyHash.slice(-40));
      const token = new ethers.Contract(config.parcelTokenAddress,["function isFrozen(address) view returns (bool)"],provider);
      try {
        const [pre,post] = await Promise.all([
          token.isFrozen(propertyAddress,{blockTag:blockNumber-1}),
          token.isFrozen(propertyAddress,{blockTag:blockNumber})
        ]);
        before=String(pre);after=String(post);
      } catch { /* Some Besu nodes do not retain historical state. */ }
      gas=receipt.gasUsed.toString();
      const eventInterface=new ethers.Interface([
        "event OrderAccepted(uint256 indexed tokenId,address indexed signer,string caseNumber,uint256 nonce,uint256 checksBitmask,address[] signers,uint8[] roles)",
        "event OrderVacated(uint256 indexed tokenId,address indexed signer,string caseNumber,uint256 nonce,uint256 checksBitmask,address[] signers,uint8[] roles)"
      ]);
      events=receipt.logs.map(log=>{try{return eventInterface.parseLog(log)?.name}catch{return null}}).filter(Boolean).join(", ") || "No order event";
      blockText=`Block #${blockNumber}`;
      txState=receipt.status===1?"Committed by Besu QBFT":"Reverted";
    } else if (context.txHash) txState="Submitted; pending receipt";
    const target = v.order.action === "unfreeze" ? "false" : "true";
    const tokenPanel=`<section><h3>ParcelToken call</h3><p>Agent: <code>${esc(config.contractAddress)}</code> → ParcelToken <code>${esc(config.parcelTokenAddress)}</code>.</p><p>Frozen before: ${esc(before)} · after: ${esc(after)}${receipt?"":` · expected after acceptance: ${target}`}</p></section>`;
    const lifecycle=`<section><h3>Transaction lifecycle</h3><p>${esc(txState)} · ${esc(blockText)} · gas used ${esc(gas)}</p><p>Transaction: <code>${esc(context.txHash || "not submitted")}</code></p><p>Decoded order event: ${esc(events)}</p></section>`;
    return replay+tokenPanel+lifecycle;
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
      const extras = await extraPanels(context,v);
      if (current !== revision) return;
      out.innerHTML = `<section><h3>Order digest</h3><dl><dt>Fields</dt><dd>Action ${esc(v.order.action || "freeze")} · Token ${esc(v.order.tokenId)} · ${esc(v.order.caseNumber)} · expiry ${esc(v.order.orderExpiry)} · nonce ${esc(v.order.nonce)}</dd><dt>Encoding</dt><dd>Sprint 0c: <code>keccak256(abi.encode(chainId, contractAddress, action, tokenId, keccak256(caseNumber), expiry, nonce))</code></dd><dt>JS digest</dt><dd><code>${esc(v.d.hash)}</code></dd><dt>On-chain digest</dt><dd><code>${esc(v.onChainDigest)}</code> ${v.digestMatch ? "✓ match" : "⚠ MISMATCH"}</dd><dt>EIP-191</dt><dd><code>\\x19Ethereum Signed Message:\\n32 || digest</code> → <code>${esc(v.d.signedHash)}</code></dd></dl></section>
        <section><h3>Signatures</h3><div class="inspector-scroll"><table><thead><tr><th>#</th><th>Recovered signer</th><th>Role</th><th>Court / level</th><th>Validity at latest block</th></tr></thead><tbody>${signerRows || '<tr><td colspan="5">No signatures supplied yet</td></tr>'}</tbody></table></div></section>
        <section><h3>Jurisdiction</h3><p>Parcel ${esc(v.parcelName || v.parcelCode)} → ${esc(v.parentName || "no parent")}; declared value ${esc(money(v.declaredValue))}.</p><p>${v.signerInfo.map(s => `${esc(roleName(s.key?.role))}: ${esc(s.territory || "unknown")}${Number(s.key?.role) === 3 ? " (national exemption)" : ""}`).join(" · ") || "Awaiting signatures"}</p></section>
        <section><h3>${v.accepted ? "Stored acceptance" : "Preflight"} checks</h3><p>Bitmask <code>0x${v.bitmask.toString(16)}</code> ${v.accepted ? "from accepted order" : "from getOrderChecks at latest block (Sprint 0c: includes FROZEN_STATE for unfreeze)"}</p><div class="inspector-scroll"><table><thead><tr><th>Bit</th><th>Check</th><th>Actual comparison</th><th>Result</th></tr></thead><tbody>${checkRows}</tbody></table></div></section>${extras}`;
    } catch (e) { if (current === revision) out.textContent = `Inspector could not read this order: ${e.shortMessage || e.message}`; }
  }
  window.NyayaInspector = { attach, setOrder, inspect, digest, loadChecks, ABI, roleName, money };
})();
