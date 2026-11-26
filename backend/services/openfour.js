import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const config = JSON.parse(readFileSync(new URL("../openfour.json", import.meta.url), "utf8"));
const VAULT_ABI = [
  "function totalRaised() view returns (uint256)",
  "function remainingForSale() view returns (uint256)",
  "function phase() view returns (uint8)",
];
const MIGRATE_ABI = [
  "function gateOpen() view returns (bool)",
  "function evaluate((address token,uint256 totalRaised,uint256 remainingForSale,bool soldOut,uint256 timestamp) ctx) view returns ((bool canMigrate,bytes data,string reason))",
];
const PHASES = { 1: "Trading", 2: "Migrating", 3: "Graduated", 5: "Sold out" };

// Reads the OpenFour token's sale state and asks its migrate module the same question OpenFour Core asks.
export async function getOpenFourStatus() {
  try {
    const rpc = process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
    const provider = new ethers.JsonRpcProvider(rpc, 97);
    const vault = new ethers.Contract(config.vault, VAULT_ABI, provider);
    const migrate = new ethers.Contract(config.migrateModule, MIGRATE_ABI, provider);
    const [raised, remaining, phase, gateOpen, block] = await Promise.all([
      vault.totalRaised(), vault.remainingForSale(), vault.phase(), migrate.gateOpen(), provider.getBlock("latest"),
    ]);
    const ctx = { token: config.token, totalRaised: raised, remainingForSale: remaining, soldOut: false, timestamp: BigInt(block.timestamp) };
    // evaluate() only answers OpenFour Core, so the read is made as Core.
    const raw = await provider.call({ to: config.migrateModule, from: config.core, data: migrate.interface.encodeFunctionData("evaluate", [ctx]) });
    const [verdict] = migrate.interface.decodeFunctionResult("evaluate", raw);
    return {
      network: config.network, core: config.core, presetId: config.presetId, presetName: config.presetName,
      token: config.token, name: config.name, symbol: config.symbol,
      migrateModule: config.migrateModule, migrateTag: config.migrateTag, buyTx: config.buyTx,
      raisedWei: raised.toString(), softCapWei: config.softCapWei,
      saleConditionMet: raised >= BigInt(config.softCapWei),
      gateOpen, phase: PHASES[Number(phase)] || `Phase ${phase}`,
      canGraduate: verdict.canMigrate, reason: verdict.reason,
    };
  } catch (err) {
    console.error("OpenFour status read failed:", err.message);
    return null;
  }
}
