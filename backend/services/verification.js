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

  return {
    address,
    balanceBNB: parseInt(balanceHex, 16) / 1e18,
    transactionCount: parseInt(txCountHex, 16),
    isContract: code !== "0x",
  };
}

const VERIFY_PROMPT = `You are a payment verification analyst for a token launch platform. Given wallet data, assess whether this payment looks like genuine product usage or potential wash trading.

Return JSON with this exact shape:
{
  "confidence": 0-100,
  "assessment": "eligible" or "flagged" or "uncertain",
  "evidence": [
    "evidence point 1",
    "evidence point 2"
  ],
  "reasoning": "one sentence explanation"
}

Scoring guide:
- Wallet with many transactions (>10) and reasonable balance: high confidence (70-95)
- Wallet with some history (3-10 tx): medium confidence (40-69)
- Brand new wallet (0-2 tx) or very low balance: low confidence (10-39), likely flagged
- Contract address paying: flagged (could be automated)

Be honest about limitations: on-chain signals only, cannot confirm real-world identity or intent.

Only return valid JSON, no markdown fences, no extra text.`;

export async function verifyPayment(walletAddress) {
  let profile;
  try {
    profile = await getWalletProfile(walletAddress);
  } catch (err) {
    return {
      confidence: 0,
      assessment: "uncertain",
      evidence: ["Could not fetch wallet data: " + err.message],
      reasoning: "RPC call failed, cannot assess wallet.",
      walletProfile: null,
    };
  }

  const raw = await chatCompletion({
    messages: [
      { role: "system", content: VERIFY_PROMPT },
      {
        role: "user",
        content: `Verify this wallet:\nAddress: ${profile.address}\nBalance: ${profile.balanceBNB.toFixed(4)} BNB\nTransaction count: ${profile.transactionCount}\nIs contract: ${profile.isContract}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 512,
    response_format: { type: "json_object" },
  });

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    result = {
      confidence: 30,
      assessment: "uncertain",
      evidence: ["AI response could not be parsed"],
      reasoning: "Verification encountered a parsing issue.",
    };
  }

  return {
    ...result,
    walletProfile: profile,
    verifiedAt: new Date().toISOString(),
  };
}
