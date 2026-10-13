// Deterministic demo scenarios against the local Besu chain.
// Keys are read only in this server-side module and never returned.
"use strict";
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { NyayaDigest } = require("../public/order-digest");

const ROOT = path.resolve(__dirname, "..");
const ABI = [
  "function judgeNonce(address) view returns (uint256)",
  "function getOrderChecks(uint8,uint256,string,uint256,uint256,bytes[]) view returns (uint256)",
  "function submitFreezeOrder(uint256,string,uint256,uint256,bytes[])",
  "function submitUnfreezeOrder(uint256,string,uint256,uint256,bytes[])",
  "function frozen(uint256) view returns (bool)",
  "event OrderAccepted(uint256 indexed tokenId,address indexed signer,string caseNumber,uint256 nonce,uint256 checksBitmask,address[] signers,uint8[] roles)",
  "event OrderVacated(uint256 indexed tokenId,address indexed signer,string caseNumber,uint256 nonce,uint256 checksBitmask,address[] signers,uint8[] roles)"
];
const SCENARIOS = [
  { id:"success-freeze", title:"Success: freeze Token 4", tokenId:4, expected:"OrderAccepted; Token 4 frozen" },
  { id:"pecuniary", title:"Pecuniary failure: Token 5", tokenId:5, expected:"Parcel value exceeds court pecuniary limit" },
  { id:"territorial", title:"Territorial failure: Token 6", tokenId:6, expected:"Judge or clerk lacks territorial jurisdiction" },
  { id:"missing-registrar", title:"Missing registrar", tokenId:4, expected:"Signatures below quorum threshold" },
  { id:"duplicate-signer", title:"Duplicate signer", tokenId:4, expected:"Duplicate signer" },
  { id:"replay", title:"Replay a used order", tokenId:4, expected:"Order already submitted" },
  { id:"success-unfreeze", title:"Success: unfreeze Token 4", tokenId:4, expected:"OrderVacated; Token 4 not frozen" },
  { id:"missing-clerk", title:"Missing clerk", tokenId:4, expected:"Signatures below quorum threshold" },
  { id:"expired", title:"Expired order", tokenId:4, expected:"Order has expired" },
  { id:"wrong-nonce", title:"Wrong judge nonce", tokenId:4, expected:"Invalid nonce" },
  { id:"non-agent", title:"Non-agent ParcelToken call", tokenId:4, expected:"Caller is not an agent" }
];

function getReason(e) {
  return e.reason || e.revert?.args?.[0] || e.shortMessage || e.message?.split("\n")[0] || "Unknown revert";
}
function readSettings() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT,"public/config.json"),"utf8"));
  const wallets = JSON.parse(fs.readFileSync(path.join(ROOT,"demo-wallets.json"),"utf8"));
  for (const role of ["judge","clerk","registrar","citizen"]) {
    if (!wallets[role]?.privateKey || !wallets[role]?.address) throw Error("Demo wallet file is incomplete");
  }
  return { config, wallets };
}
async function runScenario(id) {
  if (process.env.DEMO_MODE !== "1") throw Error("Demo mode is not enabled");
  const scenario = SCENARIOS.find(item => item.id === id);
  if (!scenario) throw Error("Unknown scenario");
  const { config, wallets } = readSettings();
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
  const network = await provider.getNetwork();
  if (network.chainId !== 1337n) throw Error("Demo runner requires chain 1337");
  const chainId = Number(network.chainId);
  const contractAddress = config.contractAddress;
  if (await provider.getCode(config.contractAddress) === "0x") throw Error("Registry contract is not deployed");
  const roles = Object.fromEntries(["judge","clerk","registrar","citizen"].map(role => [
    role,new ethers.Wallet(wallets[role].privateKey,provider)
  ]));
  const contract = new ethers.Contract(config.contractAddress,ABI,roles.citizen);
  const steps = [];
  const step = (name, expected, actual, passed) => steps.push({name,expected,actual,passed});
  step("Connect to Besu","Chain 1337",`Chain ${network.chainId}`,true);
  const tokenId = scenario.tokenId;
  const action = id === "success-unfreeze" ? "unfreeze" : "freeze";
  if (id === "non-agent") {
    const parcel = new ethers.Contract(config.parcelTokenAddress,[
      "function setAddressFrozen(address,bool)"
    ],roles.citizen);
    try {
      await parcel.setAddressFrozen.staticCall(roles.citizen.address,true);
      step("Call ParcelToken directly",scenario.expected,"Unexpected success",false);
    } catch(e) { step("Call ParcelToken directly",scenario.expected,getReason(e),true); }
    return {id,title:scenario.title,expected:scenario.expected,actual:steps.at(-1).actual,passed:steps.at(-1).passed,steps,context:null};
  }
  let nonce = await contract.judgeNonce(roles.judge.address);
  if (id === "wrong-nonce") nonce += 1n;
  const expiry = BigInt(Math.floor(Date.now()/1000) + (id === "expired" ? -60 : 3600));
  const caseNumber = `DEMO-${id.toUpperCase()}-${Date.now()}`;
  // Sprint 0c: digest binds to chainId, contractAddress, action, and all fields.
  const orderHash = NyayaDigest.compute(action, tokenId, caseNumber, expiry, nonce, chainId, contractAddress);
  step("Prepare order",`Token ${tokenId}, ${action}`,`Token ${tokenId}, ${action}; nonce ${nonce}; digest ${orderHash}`,true);
  const signerNames = id === "missing-registrar" ? ["judge","clerk"] :
    id === "missing-clerk" ? ["judge","registrar"] :
    id === "duplicate-signer" ? ["judge","clerk","judge"] :
    ["judge","clerk","registrar"];
  const signatures = [];
  for (const role of signerNames) signatures.push(await roles[role].signMessage(ethers.getBytes(orderHash)));
  step("Collect signatures",signerNames.join(", "),signerNames.join(", "),true);
  const actionId = action === "unfreeze" ? 1 : 0;
  const preflight = await contract.getOrderChecks(actionId,tokenId,caseNumber,expiry,nonce,signatures);
  step("On-chain preflight","Read contract check bits",`0x${preflight.toString(16)}`,true);
  const submit = async () => {
    const method = action === "freeze" ? contract.submitFreezeOrder : contract.submitUnfreezeOrder;
    try {
      // A static call gives the exact Solidity revert string without a failed on-chain transaction.
      await method.staticCall(tokenId,caseNumber,expiry,nonce,signatures);
    } catch(e) { return {ok:false,reason:getReason(e)}; }
    const tx = await method(tokenId,caseNumber,expiry,nonce,signatures);
    const receipt = await tx.wait();
    const eventName = action === "freeze" ? "OrderAccepted" : "OrderVacated";
    const event = receipt.logs.map(log => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    }).find(log => log?.name === eventName);
    return {ok:receipt.status===1 && !!event,reason:receipt.status===1?"Accepted":"Transaction reverted",txHash:receipt.hash,blockNumber:receipt.blockNumber,storedBitmask:event?.args.checksBitmask?.toString()};
  };
  let first = await submit();
  if (id === "replay") {
    step("First submission","Order accepted",first.ok ? `Accepted in block ${first.blockNumber}` : first.reason,first.ok);
    if (first.ok) {
      const replayBits = await contract.getOrderChecks(actionId,tokenId,caseNumber,expiry,nonce,signatures);
      step("Replay preflight","Replay bit unset",`0x${replayBits.toString(16)}`,!(replayBits & 2n));
    }
    first = await submit();
  }
  const expectedSuccess = id === "success-freeze" || id === "success-unfreeze";
  const state = await contract.frozen(tokenId);
  const actual = first.ok ? `Accepted in block ${first.blockNumber}; frozen=${state}` : first.reason;
  const passed = expectedSuccess ? first.ok && state === (action === "freeze") :
    !first.ok && (id === "territorial" ? /jurisdiction/i.test(actual) : actual.includes(scenario.expected));
  step("Submit to contract",scenario.expected,actual,passed);
  const context = {
    order:{tokenId,action,caseNumber,orderHash,orderExpiry:expiry.toString(),nonce:nonce.toString()},
    signatures:signatures.map((signature,i)=>({signer:roles[signerNames[i]].address,role:signerNames[i],signature})),
    status:first.ok?"accepted":"ready",txHash:first.txHash || null,
    checksBitmask:first.ok ? first.storedBitmask : "0"
  };
  return {id,title:scenario.title,expected:scenario.expected,actual,passed,steps,context};
}
module.exports = { SCENARIOS, runScenario };
