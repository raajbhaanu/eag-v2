// Agent loop: LLM decides -> we execute the tool -> result goes back -> repeat.
import { TOOLS } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const MODEL = "gemini-2.5-flash";
const MAX_STEPS = 14;

async function askGemini(apiKey, history) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: history,
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

// onStep({kind, ...}) lets the UI (or a test) render each step as it happens.
export async function runAgent(query, apiKey, onStep = () => {}) {
  const history = [{ role: "user", parts: [{ text: query }] }];
  const seen = new Set();

  for (let step = 1; step <= MAX_STEPS; step++) {
    const raw = await askGemini(apiKey, history);
    history.push({ role: "model", parts: [{ text: raw }] });

    let msg;
    try { msg = JSON.parse(raw); }
    catch {
      onStep({ kind: "error", step, text: "LLM returned invalid JSON; asking it to retry" });
      history.push({ role: "user", parts: [{ text: "Invalid JSON. Reply with exactly one JSON object." }] });
      continue;
    }

    if (msg.type === "final_answer") { onStep({ kind: "final", step, msg }); return msg; }

    const sig = `${msg.tool}:${JSON.stringify(msg.args)}`;
    onStep({ kind: "call", step, msg });
    let result;
    if (seen.has(sig)) result = { error: "Duplicate call. Reuse the earlier result." };
    else if (!TOOLS[msg.tool]) result = { error: `Unknown tool ${msg.tool}` };
    else {
      seen.add(sig);
      try { result = await TOOLS[msg.tool](msg.args); }
      catch (e) { result = { error: e.message }; }
    }
    onStep({ kind: "result", step, result });
    history.push({ role: "user", parts: [{ text: `Tool result: ${JSON.stringify(result)}\nWhat next?` }] });
  }
  throw new Error(`No final answer after ${MAX_STEPS} steps`);
}
