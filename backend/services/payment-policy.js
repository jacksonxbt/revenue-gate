export const WALLET_ACTIVITY_THRESHOLD = 60;

export function assessWalletActivity(profile, modelScore, excluded = false) {
  if (excluded) return { confidence: 0, assessment: "flagged", reasoning: "Excluded: the payer is the payment recipient or a configured project wallet." };
  if (!profile) return { confidence: 0, assessment: "flagged", reasoning: "Excluded: wallet activity data was unavailable." };
  if (profile.isContract) return { confidence: 0, assessment: "flagged", reasoning: "Excluded: the payer is a contract address." };
  if (!Number.isFinite(modelScore) || modelScore < 0 || modelScore > 100) {
    return { confidence: 0, assessment: "flagged", reasoning: "Excluded: the wallet activity score was unavailable." };
  }
  const confidence = Math.round(modelScore);
  const eligible = confidence >= WALLET_ACTIVITY_THRESHOLD;
  return {
    confidence,
    assessment: eligible ? "eligible" : "flagged",
    reasoning: `${eligible ? "Qualified" : "Excluded"}: wallet activity score ${confidence}/100 (minimum 60). Testnet snapshot: ${profile.transactionCount} outgoing transactions and ${profile.balanceBNB.toFixed(4)} tBNB. Activity cannot establish wallet ownership or customer demand.`,
  };
}

const inFlight = new Map();

export async function withPaymentHash(hash, operation) {
  const key = hash.toLowerCase();
  const previous = inFlight.get(key);
  const current = previous ? previous.catch(() => {}).then(() => operation(key)) : Promise.resolve().then(() => operation(key));
  inFlight.set(key, current);
  try {
    return await current;
  } finally {
    if (inFlight.get(key) === current) inFlight.delete(key);
  }
}

export function findPreviousPayment(payments, hash) {
  return payments.find(payment => payment.txHash?.toLowerCase() === hash.toLowerCase());
}

export function isProjectPayer(payer, recipient, projectWallets) {
  return [recipient, ...projectWallets].some(address => address?.trim().toLowerCase() === payer.toLowerCase());
}
