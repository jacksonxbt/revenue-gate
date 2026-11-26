const API_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function chatCompletion({ messages, model, temperature, max_tokens, response_format }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || "openai/gpt-oss-120b",
      messages,
      temperature: temperature ?? 0.3,
      max_tokens: max_tokens || 1024,
      response_format,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq API ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices[0]?.message?.content;
}
