# Trip Reality Check Agent (Chrome extension)

A Manifest V3 extension where Gemini runs a **multi-step tool-calling loop** to answer:
*"Can I afford this trip, what's the weather, and what should I pack?"*

Same agent pattern as Session 4 (LLM picks one tool per turn, result is fed back, loop until `final_answer`), but running inside a Chrome extension with keyless public APIs instead of MCP servers.

## Why it is not a "simple tool"
One question needs **8+ dependent calls**; later calls use earlier results:

```
geocode(Paris) ─┐
geocode(Tokyo) ─┴─> distance_km ─> calculate(flight cost) ─┐
                    get_forecast(Tokyo lat/lon, days) ──────┤
                    get_exchange_rate(EUR -> JPY) ──────────┼─> calculate(total, remaining) ─> verdict + packing list
```

| Tool | Source |
|---|---|
| `geocode_city` | Open-Meteo geocoding |
| `distance_km` | local haversine |
| `get_forecast` | Open-Meteo forecast |
| `get_exchange_rate` | Frankfurter (ECB rates) |
| `calculate` | local safe parser (no `eval`); the LLM is forbidden from doing its own math |

## Files
- `tools.js` – tool layer (no LLM logic)
- `prompt.js` – the final qualified system prompt
- `agent.js` – the loop (JSON protocol, duplicate-call guard, error feedback to the LLM)
- `popup.html/js`, `styles.css` – UI that renders every step live
- `test_tools.mjs` / `test_output.txt` – real-API run of the expected tool chain

## Install
1. `chrome://extensions` -> Developer mode -> **Load unpacked** -> select this folder.
2. Put `GEMINI_API_KEY=...` in `../.env` (gitignored), then run `node load-env.mjs`. This writes a gitignored `config.js` that the popup uses to pre-fill the key. A Chrome extension cannot read `.env` directly. Re-run it if the key changes, and reload the extension.
3. Open the popup (the key is pre-filled; if there is no `config.js` you can still paste one, kept in `chrome.storage.local`) and click **Check my trip**.

## Prompt qualification

Step 1 – I wrote a first draft prompt (kept below). Step 2 – I asked an LLM (ChatGPT / Claude) to grade it against the rubric, then rewrote it into the final prompt in `prompt.js`.

**Rubric given to the LLM** (paste this with the draft):
1. Explicit reasoning instructions  2. Structured output format  3. Separation of reasoning and tools
4. Conversation loop support  5. Instructional framing / examples  6. Internal self-checks
7. Reasoning-type awareness  8. Error handling / fallbacks  9. Overall clarity & no ambiguity

**Draft v0** (failed several criteria):
```
You are a travel assistant. Use the tools to check whether the user's trip is affordable,
tell them the weather and what to pack. Use FUNCTION_CALL: name|args to call tools.
```

**Qualification result** – <!-- TODO: paste the real ChatGPT/Claude JSON verdict here before submitting -->

Changes made in the final prompt, driven by the criteria:

| Criterion | What the final prompt does |
|---|---|
| Explicit reasoning | Numbered PROCEDURE; `thought` required before every call |
| Structured output | Exactly one JSON object per turn, two schemas (tool_call / final_answer) |
| Reasoning/tool separation | "NEVER do arithmetic yourself" – all math via `calculate` |
| Loop support | One tool per turn, "reuse earlier results", no duplicate calls (also enforced in `agent.js`) |
| Instructional framing | Worked example + fixed verdict rule (GO / TIGHT / NO-GO thresholds) |
| Self-check | Must verify every cited number appears in a tool result and units are right before final answer |
| Reasoning type | `reasoning_type`: lookup / arithmetic / decision on each call |
| Fallbacks | Retry once on tool error, then continue with a labelled assumption and `confidence: low`; ask for clarification if input is missing |

## Test output

### Tool chain (real APIs, `node test_tools.mjs`, no LLM) 
```
geocode_city({"city":"Paris"}) -> {"city":"Paris","country":"France","lat":48.85341,"lon":2.3488}
geocode_city({"city":"Tokyo"}) -> {"city":"Tokyo","country":"Japan","lat":35.6895,"lon":139.69171}
distance_km({"lat1":48.85341,"lon1":2.3488,"lat2":35.6895,"lon2":139.69171}) -> {"km":9713}
calculate({"expression":"9713 * 2 * 0.09"}) -> {"result":1748.34}
get_forecast({"lat":35.6895,"lon":139.69171,"days":5}) -> {"days":5,"avg_max_c":24.7,"avg_min_c":16.1,"coldest_c":13.5,"hottest_c":26.6,"rainy_days":0}
get_exchange_rate({"from":"EUR","to":"JPY"}) -> {"from":"EUR","to":"JPY","rate":177.28,"date":"2026-10-05"}
calculate({"expression":"1748.34 + 5 * 120"}) -> {"result":2348.34}
calculate({"expression":"1500 - 2348.34"}) -> {"result":-848.34}

-- error / fallback paths --
geocode_city -> error: No city found for "Zzzzqx"
calculate -> error: Unsupported expression: 2 + process.exit()
get_exchange_rate -> error: HTTP 404 from api.frankfurter.dev
```
Reading it: Paris->Tokyo is 9713 km, so flight ≈ 1748 EUR, total ≈ 2348 EUR vs a 1500 EUR budget -> remaining −848 -> expected verdict **NO-GO**. The error lines show the failure modes the prompt's fallback rule handles.

### Live agent run
<!-- TODO: after running the popup with your key, paste the step log + final verdict here, and add the YouTube link. -->

YouTube demo: _TODO_
