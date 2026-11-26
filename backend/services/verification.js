import { assessWalletActivity } from "./payment-policy.js";
import { chatCompletion } from "./groq.js";

const RPC_URL = () =>
  process.env.BSC_TESTNET_RPC ||
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// Confirms the hash is a mined, successful transfer of at least minWei to recipient.
export async function checkTransfer(txHash, recipient, minWei) {
  let tx, receipt, head;
  try {
    [tx, receipt, head] = await Promise.all([
      rpcCall("eth_getTransactionByHash", [txHash]),
      rpcCall("eth_getTransactionReceipt", [txHash]),
      rpcCall("eth_blockNumber", []),
    ]);
  } catch {
    return { status: "pending", reason: "Couldn't reach the BNB testnet node. Try again in a moment." };
  }
  if (!tx) return { status: "pending", reason: "No transaction with this hash on BNB testnet yet. Check the hash, or wait for the transfer to confirm." };
  if (!receipt) return { status: "pending", reason: "The transfer is still confirming. Wait a moment, then verify again." };
  if (receipt.status !== "0x1") return { status: "failed", reason: "This transaction failed on-chain. Send a new transfer and paste its hash." };
  if ((tx.to || "").toLowerCase() !== recipient.toLowerCase()) return { status: "failed", reason: "This transaction went to a different address than the one in your quote." };
  if (BigInt(tx.value) < BigInt(minWei)) return { status: "failed", reason: "This transaction sent less than the quoted amount." };
  return {
    status: "confirmed",
    from: tx.from.toLowerCase(),
    confirmations: Math.max(1, parseInt(head, 16) - parseInt(receipt.blockNumber, 16) + 1),
  };
}

async function getWalletProfile(address) {
  address = address.toLowerCase();
  const [balanceHex, txCountHex, code] = await Promise.all([
    rpcCall("eth_getBalance", [address, "latest"]),
    rpcCall("eth_getTransactionCount", [address, "latest"]),
    rpcCall("eth_getCode", [address, "latest"]),
  ]);

  if (![balanceHex, txCountHex, code].every(value => typeof value === "string" && /^0x[0-9a-f]*$/i.test(value)) || !Number.isFinite(parseInt(balanceHex, 16)) || !Number.isSafeInteger(parseInt(txCountHex, 16))) {
    throw new Error("Incomplete wallet data");
  }
  return {
    address,
    balanceBNB: parseInt(balanceHex, 16) / 1e18,
    transactionCount: parseInt(txCountHex, 16),
    isContract: code !== "0x",
  };
}

const VERIFY_PROMPT = `Score observable testnet wallet activity. Return only JSON with a numeric confidence from 0 to 100.
Use the existing scoring guide: more than 10 outgoing transactions and reasonable balance typically scores 70–95; 3–10 transactions typically scores 40–69; 0–2 transactions or very low balance typically scores 10–39. Do not infer wallet ownership, intent, or customer demand.`;

export async function verifyPayment(walletAddress, excluded = false) {
  if (excluded) return assessWalletActivity(null, null, true);
  let profile;
  try {
    profile = await getWalletProfile(walletAddress);
  } catch {
    return assessWalletActivity(null, null);
  }

  let score;
  try {
    const raw = await chatCompletion({
      messages: [
        { role: "system", content: VERIFY_PROMPT },
        { role: "user", content: JSON.stringify({ balanceBNB: profile.balanceBNB, transactionCount: profile.transactionCount }) },
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: "json_object" },
    });
    score = JSON.parse(raw).confidence;
  } catch {
    // Payments can still receive a report when scoring is unavailable.
  }
  return { ...assessWalletActivity(profile, score), walletProfile: profile, verifiedAt: new Date().toISOString() };
}
