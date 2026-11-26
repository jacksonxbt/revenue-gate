const ADDRESS = /^0x[0-9a-f]{40}$/i;
const MAX_AGE_MS = 5 * 60 * 1000;
const SOURCE = "DEX Screener";

export function parseResearchToken(asset) {
  if (typeof asset !== "string") return null;
  // The research chain is independent of the testnet payment chain.
  const [chain, address, extra] = asset.trim().toLowerCase().split(":");
  return chain === "bsc" && ADDRESS.test(address ?? "") && extra === undefined
    ? { chain, address } : null;
}

export async function getLiquidity(token, { request = fetch, now = Date.now } = {}) {
  const unavailable = { status: "unavailable", source: SOURCE };
  if (!token) return unavailable;
  try {
    const response = await request(`https://api.dexscreener.com/token-pairs/v1/${token.chain}/${token.address}`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) return unavailable;
    const pairs = await response.json();
    const retrieved = now();
    const date = Date.parse(response.headers.get("date"));
    const age = Number(response.headers.get("age") ?? 0) * 1000;
    if (!Number.isFinite(date) || date > retrieved + 30000 || !Number.isFinite(age) || age < 0 ||
        Math.max(retrieved - date, age) >= MAX_AGE_MS || !Array.isArray(pairs)) return unavailable;

    const pair = pairs.filter(p => p?.chainId === token.chain && ADDRESS.test(p.pairAddress ?? "") &&
      [p.baseToken, p.quoteToken].some(t => t?.address?.toLowerCase?.() === token.address) &&
      Number.isFinite(p.liquidity?.usd) && p.liquidity.usd >= 0)
      .sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];
    if (!pair) return unavailable;
    return {
      status: "available", source: SOURCE, usd: pair.liquidity.usd,
      url: `https://dexscreener.com/${token.chain}/${pair.pairAddress}`,
      retrievedAt: new Date(retrieved).toISOString(),
      expiresAt: new Date(retrieved + MAX_AGE_MS - Math.max(0, retrieved - date, age)).toISOString(),
    };
  } catch {
    return unavailable;
  }
}

export async function generateReport(token) {
  const liquidity = await getLiquidity(token);
  return {
    status: "ready",
    title: "Token research report",
    summary: "Pool liquidity describes funds in one trading pool. It does not establish token legitimacy or predict how much a buyer can trade.",
    token,
    liquidity,
    observations: [],
    sources: [{ label: SOURCE, url: liquidity.url ?? "https://dexscreener.com" }],
  };
}
