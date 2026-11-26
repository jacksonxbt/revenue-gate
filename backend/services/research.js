import { chatCompletion } from "./groq.js";

const SYSTEM_PROMPT = `You are a crypto research analyst. Given an asset name or symbol, produce a structured research report. Be factual and balanced. Never give financial advice or buy/sell recommendations.

Return JSON with this exact shape:
{
  "title": "Asset Name Research Report",
  "summary": "2-3 sentence overview of the asset",
  "metrics": {
    "category": "Layer 1 / DeFi / Meme / etc",
    "chain": "which blockchain",
    "launchYear": "year or unknown"
  },
  "observations": [
    "observation 1 about fundamentals",
    "observation 2 about recent activity",
    "observation 3 about risks or concerns"
  ],
  "risks": [
    "risk 1",
    "risk 2"
  ],
  "sources": [
    {"label": "source name", "url": "https://..."}
  ]
}

Only return valid JSON, no markdown fences, no extra text.`;

export async function generateReport(asset) {
  const raw = await chatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Research report for: ${asset}` },
    ],
    temperature: 0.3,
    max_tokens: 1024,
    response_format: { type: "json_object" },
  });

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    report = {
      title: `${asset} Research Report`,
      summary: "Report generation encountered a parsing issue.",
      metrics: { category: "Unknown", chain: "Unknown", launchYear: "Unknown" },
      observations: [raw || "No data returned"],
      risks: ["Unable to parse structured data"],
      sources: [],
    };
  }

  return {
    id: "RPT-" + String(Date.now()).slice(-8),
    asset,
    createdAt: new Date().toISOString(),
    ...report,
  };
}
