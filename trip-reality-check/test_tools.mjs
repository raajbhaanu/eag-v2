// Offline-of-LLM check: runs the exact tool chain the agent is expected to produce
// for "Paris -> Tokyo, 5 days, 1500 EUR", against the real APIs. No API key needed.
//   node test_tools.mjs
import { TOOLS } from "./tools.js";

const log = (name, args, r) => console.log(`${name}(${JSON.stringify(args)}) -> ${JSON.stringify(r)}`);
const call = async (name, args) => { const r = await TOOLS[name](args); log(name, args, r); return r; };

const a = await call("geocode_city", { city: "Paris" });
const b = await call("geocode_city", { city: "Tokyo" });
const { km } = await call("distance_km", { lat1: a.lat, lon1: a.lon, lat2: b.lat, lon2: b.lon });
const flight = (await call("calculate", { expression: `${km} * 2 * 0.09` })).result;
await call("get_forecast", { lat: b.lat, lon: b.lon, days: 5 });
await call("get_exchange_rate", { from: "EUR", to: "JPY" });
const total = (await call("calculate", { expression: `${flight} + 5 * 120` })).result;
await call("calculate", { expression: `1500 - ${total}` });

console.log("\n-- error / fallback paths --");
for (const [n, args] of [["geocode_city", { city: "Zzzzqx" }], ["calculate", { expression: "2 + process.exit()" }], ["get_exchange_rate", { from: "EUR", to: "XXX" }]]) {
  try { await TOOLS[n](args); } catch (e) { console.log(`${n} -> error: ${e.message}`); }
}
