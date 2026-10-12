# Session 5 – Prompt Engineering

Goal: write a system prompt for a multi-step tool-calling agent, grade it against a rubric, and refine it until it passes.

## Project

| Folder | What it is |
|---|---|
| [`trip-reality-check/`](trip-reality-check/) | Manifest V3 Chrome extension. Gemini runs a tool-calling loop to answer *"Can I afford this trip, what's the weather, and what should I pack?"* |

See [`trip-reality-check/README.md`](trip-reality-check/README.md) for install steps, the tool chain and test output.

## How the agent works

```
user query ─> Gemini (system prompt) ─> one JSON message per turn
                  ^                          │
                  │                  tool_call │ final_answer
                  │                          v        v
                  └── tool result ◄── run tool     render verdict
```

- The LLM picks **one tool per turn** and replies with a single JSON object.
- `agent.js` executes the tool, appends the result to the history and loops (max 14 steps).
- Duplicate calls and unknown tools are rejected in code, not just in the prompt.
- All arithmetic goes through a local `calculate` tool; the LLM is forbidden from doing its own math.

## The system prompt (`trip-reality-check/prompt.js`)

| Section | Purpose |
|---|---|
| Core behavior | One tool per turn, no invented data, reuse earlier results |
| Required user inputs | Origin, destination, days, budget, currency; ask for missing ones before any tool call |
| Procedure | 15 ordered steps from geocoding to verdict |
| Reasoning type awareness | `thought` + `reasoning_type` (`lookup` / `arithmetic` / `decision`) before every call |
| Arithmetic rule | Every derived number must come from `calculate` |
| Verdict rule | `remaining_percentage` >= 20 is GO, 0 to 20 is TIGHT, below 0 is NO-GO |
| Fallbacks | Retry once, never fabricate, set `confidence: low` when assuming |
| Internal self-check | 16 checks before the final answer, not shown to the user |
| Output format | Exactly one JSON object: tool call, final answer, or clarification |

## Prompt rubric

The prompt was graded against nine criteria: explicit reasoning, structured output, reasoning/tool separation, loop support, instructional framing, self-checks, reasoning-type awareness, error handling, and overall clarity.

## Known limitations

- The clarification response uses `verdict: "NO-GO"`, so the popup shows it as a verdict card rather than a question.
- `local_daily_spend` is calculated but has no field in the final JSON.
- A non-EUR budget needs an EUR to budget-currency rate, which the procedure does not fetch explicitly.
