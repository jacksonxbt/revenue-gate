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

// BNB mainnet is read only, to see whether the wallet has real history outside the testnet.
const MAINNET_RPC = () => process.env.BSC_MAINNET_RPC || "https://bsc-dataseed.bnbchain.org";

async function rpcOn(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(6000),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

async function getWalletProfile(address) {
  address = address.toLowerCase();
  const [balanceHex, txCountHex, code] = await Promise.all([
    rpcCall("eth_getBalance", [address, "latest"]),
    rpcCall("eth_getTransactionCount", [address, "latest"]),
    rpcCall("eth_getCode", [address, "latest"]),
  ]);

  let mainnetTx = 0, mainnetBNB = 0, mainnetChecked = true;
  try {
    const [b, n] = await Promise.all([
      rpcOn(MAINNET_RPC(), "eth_getBalance", [address, "latest"]),
      rpcOn(MAINNET_RPC(), "eth_getTransactionCount", [address, "latest"]),
    ]);
    mainnetBNB = parseInt(b, 16) / 1e18;
    mainnetTx = parseInt(n, 16);
  } catch {
    mainnetChecked = false;
  }

  return {
    address,
    balanceBNB: parseInt(balanceHex, 16) / 1e18,
    transactionCount: parseInt(txCountHex, 16),
    mainnetBalanceBNB: mainnetBNB,
    mainnetTransactionCount: mainnetTx,
    mainnetChecked,
    isContract: code !== "0x",
  };
}

// The published scoring rules. The frontend chart on the Gate page shows the same tiers.
export const SCORE_RULES = {
  countsFrom: 60,
  activity: [[50, 50], [10, 40], [3, 30], [1, 10]],          // [min transactions sent, points]
  balance: [[0.1, 25], [0.02, 18], [0.005, 10], [0, 3]],     // [min BNB held, points]
  personalWallet: 15,
  contractCap: 40,
  aiAdjustment: 5,
};

const tier = (table, value) => (table.find(([min]) => value >= min) || [0, 0])[1];

export function scoreWallet(profile) {
  const tx = profile.transactionCount + profile.mainnetTransactionCount;
  const bnb = profile.balanceBNB + profile.mainnetBalanceBNB;
  const activity = tier(SCORE_RULES.activity, tx);
  const balance = tier(SCORE_RULES.balance, bnb);
  const walletType = profile.isContract ? 0 : SCORE_RULES.personalWallet;
  let base = activity + balance + walletType;
  if (profile.isContract) base = Math.min(base, SCORE_RULES.contractCap);
  return { activity, balance, walletType, base, transactions: tx, bnb };
}

const VERIFY_PROMPT = `You review a wallet that just paid for a product on a token launch platform. A rule-based score has already been computed from the wallet's activity, balance and type. Your job is to explain it in one plain sentence and, only if the data looks unusual, adjust it slightly.

Return JSON with this exact shape:
{
  "adjustment": an integer from -5 to 5,
  "evidence": ["evidence point 1", "evidence point 2"],
  "reasoning": "one sentence explanation of why this wallet looks genuine or not"
}

Use 0 for the adjustment unless something stands out. On-chain signals only: do not claim to know the owner's identity or intent.

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

  const breakdown = scoreWallet(profile);
  let ai = { adjustment: 0, evidence: [], reasoning: "" };
  try {
    const raw = await chatCompletion({
      messages: [
        { role: "system", content: VERIFY_PROMPT },
        {
          role: "user",
          content: `Wallet: ${profile.address}\nBNB testnet: ${profile.balanceBNB.toFixed(4)} tBNB, ${profile.transactionCount} transactions sent\nBNB mainnet: ${profile.mainnetChecked ? `${profile.mainnetBalanceBNB.toFixed(4)} BNB, ${profile.mainnetTransactionCount} transactions sent` : "could not be read"}\nIs contract: ${profile.isContract}\nRule-based score: ${breakdown.base} of 100 (activity ${breakdown.activity}/50, balance ${breakdown.balance}/25, wallet type ${breakdown.walletType}/15). A score of ${SCORE_RULES.countsFrom} or more counts.`,
        },
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: "json_object" },
    });
    ai = { ...ai, ...JSON.parse(raw) };
  } catch {
    ai.reasoning = "The AI explanation was unavailable, so the rule-based score is used as is.";
  }

  const limit = SCORE_RULES.aiAdjustment;
  const adjustment = Math.max(-limit, Math.min(limit, Math.round(Number(ai.adjustment) || 0)));
  const confidence = Math.max(0, Math.min(100, breakdown.base + adjustment));
  const sign = adjustment > 0 ? "+" : "";
  const parts = `Activity ${breakdown.activity}/50, balance ${breakdown.balance}/25, wallet type ${breakdown.walletType}/15, AI adjustment ${sign}${adjustment}.`;

  let sentence = String(ai.reasoning || "").trim();
  if (sentence) sentence = sentence[0].toUpperCase() + sentence.slice(1) + (/[.!?]$/.test(sentence) ? "" : ".");

  return {
    confidence,
    assessment: confidence >= SCORE_RULES.countsFrom ? "eligible" : "flagged",
    evidence: Array.isArray(ai.evidence) ? ai.evidence : [],
    reasoning: `${sentence} ${parts}`.trim(),
    breakdown: { ...breakdown, adjustment },
    walletProfile: profile,
    verifiedAt: new Date().toISOString(),
  };
}
