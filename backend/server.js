import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReport } from "./services/research.js";
import { verifyPayment } from "./services/verification.js";
import { recordPaymentOnChain, getGraduationProgress } from "./services/onchain.js";
import { db } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = resolve(__dirname, "../.env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const PORT = process.env.PORT || 3001;
const CHAIN_ID = 97;
const REPORT_PRICE_WEI = "10000000000000000"; // 0.01 BNB
const TARGET_WEI = "500000000000000000"; // 0.5 BNB (50 payments x 0.01)
const RECIPIENT = process.env.RECIPIENT_ADDRESS || "0x0000000000000000000000000000000000000000";

function bnbToWei(bnb) {
  return String(BigInt(Math.round(bnb * 1e18)));
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

function formatPaymentForFrontend(p) {
  return {
    chainId: CHAIN_ID,
    txHash: p.txHash || "0x" + "0".repeat(64),
    amountWei: bnbToWei(p.amount),
    status: p.txHash ? "confirmed" : "confirmed",
    confirmations: p.txHash ? 12 : 1,
    assessment: p.verification
      ? p.verification.assessment
      : "pending",
    reason: p.verification
      ? p.verification.reasoning
      : "Verification pending",
  };
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, null);

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // POST /api/quote -- create a payment quote for research
    if (req.method === "POST" && url.pathname === "/api/quote") {
      const { asset, chainId } = await readBody(req);
      if (chainId && chainId !== CHAIN_ID) {
        return json(res, 400, { error: "Only BNB testnet (97) supported" });
      }
      if (!asset || typeof asset !== "string" || asset.length > 40) {
        return json(res, 400, { error: "Invalid asset (1-40 chars)" });
      }
      const requestId = "REQ-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
      const quote = {
        requestId,
        asset: asset.trim().toUpperCase(),
        chainId: CHAIN_ID,
        amountWei: REPORT_PRICE_WEI,
        recipient: RECIPIENT,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
      db.quotes.set(requestId, { ...quote, status: "pending" });
      return json(res, 200, quote);
    }

    // POST /api/payment -- submit a payment tx hash for verification
    if (req.method === "POST" && url.pathname === "/api/payment") {
      const { requestId, txHash, chainId } = await readBody(req);
      if (chainId && chainId !== CHAIN_ID) {
        return json(res, 400, { error: "Only BNB testnet (97) supported" });
      }
      if (!requestId || !txHash) {
        return json(res, 400, { error: "requestId and txHash required" });
      }
      const quote = db.quotes.get(requestId);
      if (!quote) {
        return json(res, 404, { error: "Quote not found" });
      }

      // Extract wallet from txHash via RPC (or use a placeholder for demo)
      const walletAddress = req.headers["x-wallet-address"] || "0x0000000000000000000000000000000000000001";
      const verification = await verifyPayment(walletAddress);

      // Record on-chain via smart contract (oracle submits AI result)
      const onChainTx = await recordPaymentOnChain(
        requestId,
        walletAddress,
        verification.confidence,
        REPORT_PRICE_WEI
      );

      const payment = {
        id: requestId,
        walletAddress,
        asset: quote.asset,
        amount: 0.01,
        txHash,
        onChainTx,
        timestamp: new Date().toISOString(),
        verification,
      };
      db.payments.push(payment);
      quote.status = "confirmed";

      return json(res, 200, {
        chainId: CHAIN_ID,
        txHash,
        amountWei: REPORT_PRICE_WEI,
        status: "confirmed",
        confirmations: 1,
        assessment: verification.assessment,
        reason: verification.reasoning,
        onChainTx,
      });
    }

    // POST /api/report -- get research report for a request
    if (req.method === "POST" && url.pathname === "/api/report") {
      const { requestId } = await readBody(req);
      if (!requestId) {
        return json(res, 400, { error: "requestId required" });
      }
      const quote = db.quotes.get(requestId);
      if (!quote) {
        return json(res, 404, { error: "Quote not found" });
      }

      const existing = db.reports.get(requestId);
      if (existing) {
        return json(res, 200, existing);
      }

      const report = await generateReport(quote.asset);
      const formatted = {
        status: "ready",
        title: report.title,
        summary: report.summary,
        observations: report.observations.filter(Boolean),
        sources: report.sources.filter((s) => s.url && s.label),
      };
      db.reports.set(requestId, formatted);
      return json(res, 200, formatted);
    }

    // POST /api/launch -- get launch/graduation status
    if (req.method === "POST" && url.pathname === "/api/launch") {
      const onChain = await getGraduationProgress();
      const payments = db.payments.map(formatPaymentForFrontend);

      if (onChain) {
        return json(res, 200, {
          chainId: CHAIN_ID,
          revenueWei: bnbToWei(onChain.eligiblePayments * 0.01),
          targetWei: TARGET_WEI,
          eligible: onChain.graduated,
          enforcement: "on-chain",
          state: onChain.graduated ? "graduated" : "accumulating",
          payments,
          contractAddress: process.env.CONTRACT_ADDRESS,
          onChainProgress: onChain,
          evidenceTxHash: null,
        });
      }

      const eligible = db.payments.filter(
        (p) => p.verification && p.verification.confidence >= 60
      );
      const revenueWei = bnbToWei(
        eligible.reduce((sum, p) => sum + p.amount, 0)
      );
      return json(res, 200, {
        chainId: CHAIN_ID,
        revenueWei,
        targetWei: TARGET_WEI,
        eligible: BigInt(revenueWei) >= BigInt(TARGET_WEI),
        enforcement: "informational",
        state: BigInt(revenueWei) >= BigInt(TARGET_WEI) ? "graduated" : "accumulating",
        payments,
        contractAddress: process.env.CONTRACT_ADDRESS || null,
        evidenceTxHash: null,
      });
    }

    // GET /api/health
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, {
        status: "ok",
        payments: db.payments.length,
        reports: db.reports.size,
        quotes: db.quotes.size,
      });
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Revenue Gate API running on port ${PORT}`);
  console.log(`Test: curl http://localhost:${PORT}/api/health`);
});
