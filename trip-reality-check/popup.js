import { runAgent } from "./agent.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// Key priority: config.js (generated from ../.env by `node load-env.mjs`), then chrome.storage.local.
import("./config.js")
  .then(({ GEMINI_API_KEY }) => { $("apiKey").value = GEMINI_API_KEY; })
  .catch(() => chrome.storage.local.get("apiKey", ({ apiKey }) => { if (apiKey) $("apiKey").value = apiKey; }));

function addStep(cls, title, body) {
  const d = document.createElement("div");
  d.className = `step ${cls}`;
  d.innerHTML = `<b>${esc(title)}</b><code>${esc(body)}</code>`;
  $("steps").appendChild(d);
}

$("go").onclick = async () => {
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) return addStep("error", "Missing key", "Enter your Gemini API key.");
  chrome.storage.local.set({ apiKey });
  $("steps").innerHTML = ""; $("final").classList.add("hidden"); $("go").disabled = true;

  try {
    await runAgent($("query").value, apiKey, (e) => {
      if (e.kind === "call") addStep("call", `Step ${e.step}: ${e.msg.tool} [${e.msg.reasoning_type}]`, `${e.msg.thought}\n${JSON.stringify(e.msg.args)}`);
      else if (e.kind === "result") addStep("result", "  ↳ result", JSON.stringify(e.result));
      else if (e.kind === "error") addStep("error", `Step ${e.step}`, e.text);
      else if (e.kind === "final") renderFinal(e.msg);
    });
  } catch (err) {
    addStep("error", "Agent failed", err.message);
  }
  $("go").disabled = false;
};

function renderFinal(m) {
  const f = $("final");
  f.classList.remove("hidden");
  if (m.verdict === undefined) { f.textContent = m.summary || m.thought; return; }
  f.innerHTML = `<div class="verdict ${esc(m.verdict)}">${esc(m.verdict)} <small>(${esc(m.confidence)} confidence)</small></div>
    <p>${esc(m.summary)}</p><p><b>Weather:</b> ${esc(m.weather)}</p>
    <p><b>Pack:</b> ${esc((m.packing || []).join(", "))}</p>
    <p><small>${esc(JSON.stringify(m.numbers))}</small></p>`;
}
