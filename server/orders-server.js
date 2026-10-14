// server/orders-server.js
//
// Coordination service for the court workflow (docs/interfaces.md §4).
//
// This is an UNTRUSTED off-chain mailbox: it holds orders and signatures so signers on
// different browser profiles can hand an order along. It has no authority. The browser
// re-verifies every order and signature, and the contract enforces every rule. The only
// checks done here are cheap hygiene checks (shape, digest, signature recovery) so the
// mailbox does not fill with junk.
//
// Uses Node's built-in http module, so there is no dependency to install. The `app`
// object below is a small Express-compatible subset (use, res.status, res.json), which is
// all server/demo-runner.js needs to be mounted with one line.
//
//   node server/orders-server.js            (default port 3001, 127.0.0.1 only)
//   PORT=3002 node server/orders-server.js

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const PORT = Number(process.env.PORT) || 3001;
const HOST = "127.0.0.1";                       // localhost only, on purpose
const DATA_FILE = process.env.ORDERS_FILE || path.join(__dirname, "..", "data", "pending-orders.json");
const MAX_BODY = 64 * 1024;                     // bytes
const MAX_ORDERS = 500;                         // oldest submitted orders are dropped past this
const ROLES = ["JUDGE", "CLERK", "REGISTRAR"];
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000", "http://localhost:3000",
  "http://127.0.0.1:8080", "http://localhost:8080"
]);
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// ── Storage ──────────────────────────────────────────────────────────────────
// orders: { [orderHashLowercase]: order }. Written atomically after every change.

let orders = {};
try {
  orders = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!orders || typeof orders !== "object" || Array.isArray(orders)) orders = {};
} catch (_) { orders = {}; }

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error("Could not save orders:", e.message);
  }
}

function prune() {
  const keys = Object.keys(orders);
  if (keys.length <= MAX_ORDERS) return;
  keys.sort((a, b) => orders[a].updatedAt - orders[b].updatedAt);
  for (const k of keys) {
    if (Object.keys(orders).length <= MAX_ORDERS) break;
    if (orders[k].txHash) delete orders[k];     // never drop an order still being collected
  }
}

// ── Order helpers ────────────────────────────────────────────────────────────

class BadRequest extends Error {}
const bad = (m) => { throw new BadRequest(m); };

// Same digest the contract computes (Sprint 0c): bound to chain id, contract address and action.
// The contract address is re-read from public/config.json on each order, so a redeploy needs no restart.
const { NyayaDigest } = require("../public/order-digest.js");
const CONFIG_FILE = path.join(__dirname, "..", "public", "config.json");
const CHAIN_ID = Number(process.env.CHAIN_ID) || 1337;

function digest(o) {
  let contractAddress;
  try { contractAddress = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).contractAddress; }
  catch (_) { bad("Server cannot read public/config.json, so it cannot check the order hash."); }
  return NyayaDigest.compute(o.action, o.tokenId, o.caseNumber, o.orderExpiry, o.nonce, CHAIN_ID, contractAddress);
}

function statusOf(o) {
  if (o.txHash) return "submitted";
  if (o.signatures.length >= ROLES.length) return "ready";
  return o.signatures.length === 0 ? "pending" : "collecting";
}

// A signature is accepted only if it recovers to the signer it names, with a valid role label.
// Whether that signer actually holds the role is the registry's business (checked in the browser).
function checkSignature(orderHash, s) {
  if (!s || typeof s !== "object") bad("Malformed signature entry.");
  if (!ROLES.includes(s.role)) bad("Unknown role.");
  if (typeof s.signer !== "string" || !ethers.isAddress(s.signer)) bad("Invalid signer address.");
  if (typeof s.signature !== "string" || !ethers.isHexString(s.signature, 65)) bad("Invalid signature.");
  let recovered;
  try { recovered = ethers.verifyMessage(ethers.getBytes(orderHash), s.signature); }
  catch (_) { bad("Signature could not be recovered."); }
  if (recovered.toLowerCase() !== s.signer.toLowerCase()) bad("Signature does not recover to the listed signer.");
  return { signer: ethers.getAddress(recovered), role: s.role, signature: s.signature };
}

function addSignature(order, s) {
  const clean = checkSignature(order.orderHash, s);
  if (order.signatures.some(x => x.signer.toLowerCase() === clean.signer.toLowerCase())) bad("This signer has already signed.");
  if (order.signatures.some(x => x.role === clean.role)) bad("The " + clean.role + " slot is already filled.");
  order.signatures.push(clean);
  order.signatures.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

function parseOrder(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) bad("Body must be an order object.");
  if (body.version !== 1) bad("Unsupported order version.");
  if (!Number.isInteger(body.tokenId) || body.tokenId < 0) bad("Invalid tokenId.");
  if (body.action !== "freeze" && body.action !== "unfreeze") bad("Action must be freeze or unfreeze.");
  if (typeof body.caseNumber !== "string" || !body.caseNumber.trim() || body.caseNumber.length > 200) bad("Invalid case number.");
  if (!Number.isInteger(body.orderExpiry) || body.orderExpiry <= 0) bad("Invalid expiry.");
  if (!Number.isInteger(body.nonce) || body.nonce < 0) bad("Invalid nonce.");
  if (typeof body.orderHash !== "string" || !ethers.isHexString(body.orderHash, 32)) bad("Invalid order hash.");
  if (!Array.isArray(body.signatures) || body.signatures.length > ROLES.length) bad("Invalid signatures list.");
  if (digest(body).toLowerCase() !== body.orderHash.toLowerCase()) bad("Order hash does not match the order fields.");
  const now = Date.now();
  const order = {
    version: 1, tokenId: body.tokenId, action: body.action, caseNumber: body.caseNumber,
    orderExpiry: body.orderExpiry, nonce: body.nonce, orderHash: body.orderHash.toLowerCase(),
    signatures: [], txHash: null, createdAt: now, updatedAt: now
  };
  for (const s of body.signatures) addSignature(order, s);
  return order;
}

function view(o) {
  return { ...o, orderHash: o.orderHash, status: statusOf(o) };
}

// ── Routes ───────────────────────────────────────────────────────────────────

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

async function route(req, res, url, body) {
  const { pathname } = url;
  const m = pathname.match(/^\/orders\/(0x[0-9a-fA-F]{64})(\/signatures|\/submitted)?$/);

  if (req.method === "GET" && pathname === "/health") return res.json(200, { ok: true });

  if (pathname === "/orders") {
    if (req.method === "POST") {
      const incoming = parseOrder(body);
      const existing = orders[incoming.orderHash];
      if (existing) {
        // Same order sent again (for example by another signer): merge any new signatures.
        let added = 0;
        for (const s of incoming.signatures) {
          if (!existing.signatures.some(x => x.signer.toLowerCase() === s.signer.toLowerCase())) {
            try { addSignature(existing, s); added++; } catch (_) { /* slot taken: ignore */ }
          }
        }
        if (added) { existing.updatedAt = Date.now(); save(); }
        return res.json(200, { hash: existing.orderHash });
      }
      orders[incoming.orderHash] = incoming;
      prune(); save();
      return res.json(201, { hash: incoming.orderHash });
    }
    if (req.method === "GET") {
      const status = url.searchParams.get("status");
      const awaiting = url.searchParams.get("roleAwaiting");
      if (status && !["pending", "collecting", "ready", "submitted"].includes(status)) bad("Unknown status filter.");
      if (awaiting && !ROLES.includes(awaiting)) bad("Unknown role filter.");
      let list = Object.values(orders).map(view);
      if (status) list = list.filter(o => o.status === status);
      // "Awaiting a role" means: not submitted, and that role has not signed yet.
      if (awaiting) list = list.filter(o => o.status !== "submitted" && !o.signatures.some(s => s.role === awaiting));
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      return res.json(200, list);
    }
    return res.json(405, { error: "Method not allowed" });
  }

  if (m) {
    const order = orders[m[1].toLowerCase()];
    const tail = m[2];
    if (!order) return res.json(404, { error: "Order not found" });

    if (!tail && req.method === "GET") return res.json(200, view(order));

    if (tail === "/signatures" && req.method === "POST") {
      if (order.txHash) bad("This order has already been submitted.");
      addSignature(order, body);
      order.updatedAt = Date.now(); save();
      return res.json(200, view(order));
    }

    if (tail === "/submitted" && req.method === "POST") {
      if (!body || typeof body.txHash !== "string" || !HASH_RE.test(body.txHash)) bad("txHash must be a 32-byte hex string.");
      order.txHash = body.txHash.toLowerCase();
      order.updatedAt = Date.now(); save();
      return res.json(200, { ok: true });
    }
    return res.json(405, { error: "Method not allowed" });
  }

  return res.json(404, { error: "Not found" });
}

// ── Minimal Express-compatible app ───────────────────────────────────────────

const mounts = [];
const app = { use(prefix, fn) { mounts.push({ prefix, fn }); } };

function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (a, b) => {                       // res.json(body) or res.json(status, body)
    const [code, data] = b === undefined ? [res.statusCode || 200, a] : [a, b];
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(data));
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const chunks = [];
    req.on("data", c => {
      if (tooBig) return;                       // drain the rest without buffering it
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; reject(new BadRequest("Request body too large.")); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return;
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (_) { reject(new BadRequest("Body is not valid JSON.")); }
    });
    req.on("error", reject);
  });
}

async function handler(req, res) {
  decorate(res);
  try {
    // Loopback only, and only for our own host names (blocks DNS-rebinding from other sites).
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    if (!ALLOWED_HOSTS.has(host)) return res.json(403, { error: "Host not allowed" });

    const url = new URL(req.url, "http://localhost");

    // Mounted sub-apps (the demo runner) do their own origin and DEMO_MODE checks.
    for (const { prefix, fn } of mounts) {
      if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) {
        req.originalUrl = req.url;
        req.url = req.url.slice(prefix.length) || "/";
        return fn(req, res, () => res.json(404, { error: "Not found" }));
      }
    }

    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) return res.json(403, { error: "Origin not allowed" });
    if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

    const body = req.method === "POST" ? await readBody(req) : null;
    await route(req, res, url, body);
  } catch (e) {
    if (e instanceof BadRequest) return res.json(400, { error: e.message });
    console.error(e);
    res.json(500, { error: "Internal error" });
  }
}

// One-line mount of the demo runner (Vijay owns server/demo-runner.js).
require("./demo-runner")(app);

if (require.main === module) {
  http.createServer(handler).listen(PORT, HOST, () => {
    console.log("Orders mailbox (untrusted, off-chain) on http://" + HOST + ":" + PORT +
      (process.env.DEMO_MODE === "1" ? "  [DEMO_MODE=1]" : ""));
  });
}

module.exports = { handler, app };
