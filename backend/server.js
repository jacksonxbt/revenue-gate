import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReport } from "./services/research.js";
import { verifyPayment, checkTransfer } from "./services/verification.js";
import { recordPaymentOnChain, getGraduationProgress } from "./services/onchain.js";
import * as dynamo from "./services/dynamo.js";
import { uploadReport } from "./services/s3.js";
import { loadSecrets } from "./services/secrets.js";
import { db } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env first (fallback)
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

// Try loading from Secrets Manager (overrides .env on EC2)
await loadSecrets();

const PORT = process.env.PORT || 3001;
const CHAIN_ID = 97;
const REPORT_PRICE_WEI = "10000000000000000"; // 0.01 BNB
const TARGET_WEI = "500000000000000000"; // 0.5 BNB (50 payments x 0.01)
const RECIPIENT = process.env.RECIPIENT_ADDRESS || "0xc2013a8a76bac5914a88bf2f809334468332589d";
const USE_DYNAMO = process.env.USE_DYNAMO === "true";

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
    confidence: p.verification ? Number(p.verification.confidence) : null,
  };
}

// Storage helpers -- DynamoDB when USE_DYNAMO=true, in-memory otherwise
async function saveQuote(quote) {
  if (USE_DYNAMO) await dynamo.putQuote(quote);
  db.quotes.set(quote.requestId, quote);
}

async function loadQuote(requestId) {
  if (USE_DYNAMO) {
    const q = await dynamo.getQuote(requestId);
    if (q) return q;
  }
  return db.quotes.get(requestId) || null;
}

async function savePayment(payment) {
  if (USE_DYNAMO) await dynamo.putPayment(payment);
  db.payments.push(payment);
}

async function loadPayments() {
  if (USE_DYNAMO) return dynamo.getPayments();
  return db.payments;
}

async function saveReport(requestId, report) {
  if (USE_DYNAMO) await dynamo.putReport({ requestId, ...report });
  db.reports.set(requestId, report);
}

async function loadReport(requestId) {
  if (USE_DYNAMO) {
    const r = await dynamo.getReport(requestId);
    if (r) return r;
  }
  return db.reports.get(requestId) || null;
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
        status: "pending",
      };
      await saveQuote(quote);
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
      const quote = await loadQuote(requestId);
      if (!quote) {
        return json(res, 404, { error: "Quote not found" });
      }

      if (!/^0x[0-9a-f]{64}$/i.test(txHash)) {
        return json(res, 400, { error: "txHash must be 0x followed by 64 hex characters" });
      }
      const notConfirmed = (status, reason) => json(res, 200, {
        chainId: CHAIN_ID, txHash, amountWei: REPORT_PRICE_WEI, status, confirmations: 0, assessment: "pending", reason,
      });

      const previous = (await loadPayments()).find((p) => p.txHash?.toLowerCase() === txHash.toLowerCase());
      if (previous && previous.id !== requestId) {
        return notConfirmed("failed", "This transaction already paid for another report. Send a new transfer for this one.");
      }

      const transfer = await checkTransfer(txHash, quote.recipient || RECIPIENT, REPORT_PRICE_WEI);
      if (transfer.status !== "confirmed") return notConfirmed(transfer.status, transfer.reason);

      if (previous) {
        return json(res, 200, {
          chainId: CHAIN_ID, txHash, amountWei: REPORT_PRICE_WEI, status: "confirmed",
          confirmations: transfer.confirmations, assessment: previous.verification.assessment,
          reason: previous.verification.reasoning, confidence: previous.verification.confidence, onChainTx: previous.onChainTx,
        });
      }

      const walletAddress = transfer.from;
      const verification = await verifyPayment(walletAddress);
      // The contract counts a payment when confidence >= 60, so the label follows the same rule.
      verification.confidence = Math.max(0, Math.min(100, Math.round(Number(verification.confidence) || 0)));
      verification.assessment = verification.confidence >= 60 ? "eligible" : "flagged";

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
      await savePayment(payment);
      quote.status = "confirmed";
      await saveQuote(quote);

      return json(res, 200, {
        chainId: CHAIN_ID,
        txHash,
        amountWei: REPORT_PRICE_WEI,
        status: "confirmed",
        confirmations: transfer.confirmations,
        assessment: verification.assessment,
        reason: verification.reasoning,
        confidence: verification.confidence,
        onChainTx,
      });
    }

    // POST /api/report -- get research report for a request
    if (req.method === "POST" && url.pathname === "/api/report") {
      const { requestId } = await readBody(req);
      if (!requestId) {
        return json(res, 400, { error: "requestId required" });
      }
      const quote = await loadQuote(requestId);
      if (!quote) {
        return json(res, 404, { error: "Quote not found" });
      }
      if (quote.status !== "confirmed") {
        return json(res, 402, { error: "Pay for this report before requesting it" });
      }

      const existing = await loadReport(requestId);
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
      await saveReport(requestId, formatted);
      if (USE_DYNAMO) {
        try { await uploadReport(requestId, formatted); } catch (e) { console.error("S3 upload failed:", e.message); }
      }
      return json(res, 200, formatted);
    }

    // POST /api/launch -- get launch/graduation status
    if (req.method === "POST" && url.pathname === "/api/launch") {
      const onChain = await getGraduationProgress();
      const allPayments = await loadPayments();
      const payments = allPayments.map(formatPaymentForFrontend);

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

      const eligible = allPayments.filter(
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
      const allPayments = await loadPayments();
      return json(res, 200, {
        status: "ok",
        storage: USE_DYNAMO ? "dynamodb" : "in-memory",
        payments: allPayments.length,
        reports: db.reports.size,
        quotes: db.quotes.size,
      });
    }

    // Serve frontend static files
    const frontendDir = resolve(__dirname, "../frontend");
    const filePath = url.pathname === "/" ? resolve(frontendDir, "index.html") : resolve(frontendDir, url.pathname.slice(1));
    if (filePath.startsWith(frontendDir) && existsSync(filePath)) {
      const mimeTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
      const ext = extname(filePath);
      try {
        const content = readFileSync(filePath);
        res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream", "Access-Control-Allow-Origin": "*" });
        return res.end(content);
      } catch {}
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Revenue Gate API running on port ${PORT}`);
  console.log(`Storage: ${USE_DYNAMO ? "DynamoDB" : "in-memory"}`);
  console.log(`Test: curl http://localhost:${PORT}/api/health`);
});
