// Local-only HTTP runner. Can mount on Niharika's Express server or run alone.
"use strict";
const http = require("http");
const { SCENARIOS, runScenario } = require("../scripts/scenarios");
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3000", "http://localhost:3000",
  "http://127.0.0.1:8080", "http://localhost:8080"
]);
function localAddress(value) {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}
function reply(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
async function handle(req, res) {
  if (!localAddress(req.socket.remoteAddress)) return reply(res,403,{error:"Loopback clients only"});
  const host = (req.headers.host || "").split(":")[0].replace(/^\[|\]$/g,"");
  if (!["127.0.0.1","localhost","::1"].includes(host)) return reply(res,403,{error:"Loopback host only"});
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply(res,403,{error:"Origin not allowed"});
  if (origin) res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  if (process.env.DEMO_MODE !== "1") return reply(res,403,{error:"Demo mode is not enabled"});
  if (req.method === "OPTIONS") return reply(res,204,{});
  const pathname = new URL(req.originalUrl || req.url,"http://localhost").pathname;
  if (req.method === "GET" && pathname === "/demo/scenarios") {
    return reply(res,200,{scenarios:SCENARIOS.map(({id,title,tokenId,expected})=>({id,title,tokenId,expected}))});
  }
  const match = pathname.match(/^\/demo\/run\/([a-z-]+)$/);
  if (req.method !== "POST" || !match) return reply(res,404,{error:"Unknown demo route"});
  try {
    const result = await runScenario(match[1]);
    return reply(res,200,result);
  } catch(e) {
    const message = e.message === "Unknown scenario" ? "Unknown scenario" :
      e.code === "ENOENT" ? "Demo wallets or chain config are missing" :
      "Scenario setup or RPC failed";
    return reply(res,message === "Unknown scenario" ? 404 : 500,{error:message});
  }
}
function mountDemoRunner(app) { app.use("/demo",(req,res)=>{handle(req,res).catch(()=>reply(res,500,{error:"Demo runner failed"}));}); }
module.exports = mountDemoRunner;
module.exports.handle = handle;

if (require.main === module) {
  http.createServer((req,res)=>{handle(req,res).catch(()=>reply(res,500,{error:"Demo runner failed"}));})
    .listen(3001,"127.0.0.1",()=>console.log("Demo runner listening on http://127.0.0.1:3001"));
}
