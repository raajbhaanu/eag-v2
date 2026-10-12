// Reads GEMINI_API_KEY from ../.env and writes config.js (gitignored) for the extension popup.
// Run: node load-env.mjs   (then reload the extension in chrome://extensions)
import { readFileSync, writeFileSync } from "node:fs";

const envPath = new URL("../.env", import.meta.url);
const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("GEMINI_API_KEY="));
const key = line?.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
if (!key) { console.error("GEMINI_API_KEY not found in ../.env"); process.exit(1); }

writeFileSync(new URL("./config.js", import.meta.url), `export const GEMINI_API_KEY = ${JSON.stringify(key)};\n`);
console.log("Wrote config.js (gitignored). Reload the extension.");
