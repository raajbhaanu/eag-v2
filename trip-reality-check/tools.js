// Tool layer: deterministic functions the LLM may call. No LLM logic lives here.
// Pure ES module so it runs in the extension popup and in Node (test_tools.mjs).

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const FX = "https://api.frankfurter.dev/v1/latest";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

export async function geocode_city({ city }) {
  const data = await getJson(`${GEO}?name=${encodeURIComponent(city)}&count=1`);
  const r = data.results?.[0];
  if (!r) throw new Error(`No city found for "${city}"`);
  return { city: r.name, country: r.country, lat: r.latitude, lon: r.longitude };
}

export async function distance_km({ lat1, lon1, lat2, lon2 }) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return { km: Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) };
}

export async function get_forecast({ lat, lon, days }) {
  const n = Math.min(Math.max(Math.round(days), 1), 14);
  const data = await getJson(
    `${FORECAST}?latitude=${lat}&longitude=${lon}&forecast_days=${n}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`);
  const d = data.daily;
  const avg = (xs) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
  return {
    days: n,
    avg_max_c: avg(d.temperature_2m_max),
    avg_min_c: avg(d.temperature_2m_min),
    coldest_c: Math.min(...d.temperature_2m_min),
    hottest_c: Math.max(...d.temperature_2m_max),
    rainy_days: d.precipitation_probability_max.filter((p) => p >= 50).length,
  };
}

export async function get_exchange_rate({ from, to }) {
  const f = String(from).toUpperCase(), t = String(to).toUpperCase();
  if (f === t) return { from: f, to: t, rate: 1 };
  const data = await getJson(`${FX}?base=${f}&symbols=${t}`);
  const rate = data.rates?.[t];
  if (rate === undefined) throw new Error(`No rate for ${f}->${t}`);
  return { from: f, to: t, rate, date: data.date };
}

// Safe arithmetic (+ - * / ** parentheses, unary minus). No eval().
export async function calculate({ expression }) {
  const tokens = String(expression).match(/\d+\.?\d*|\*\*|[-+*/()]/g);
  if (!tokens || tokens.join("") !== String(expression).replace(/\s+/g, "")) {
    throw new Error(`Unsupported expression: ${expression}`);
  }
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const primary = () => {
    const t = next();
    if (t === "(") { const v = add(); next(); return v; }
    if (t === "-") return -primary();
    return parseFloat(t);
  };
  const pow = () => { const b = primary(); return peek() === "**" ? (next(), b ** pow()) : b; };
  const mul = () => {
    let v = pow();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * pow() : v / pow();
    return v;
  };
  const add = () => {
    let v = mul();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + mul() : v - mul();
    return v;
  };
  const result = add();
  if (!Number.isFinite(result)) throw new Error("Result is not finite");
  return { result: Math.round(result * 100) / 100 };
}

export const TOOLS = { geocode_city, distance_km, get_forecast, get_exchange_rate, calculate };

export const TOOL_DOCS = `1. geocode_city(city: string) -> {city, country, lat, lon}
2. distance_km(lat1: number, lon1: number, lat2: number, lon2: number) -> {km}  (great-circle distance)
3. get_forecast(lat: number, lon: number, days: integer 1-14) -> {avg_max_c, avg_min_c, coldest_c, hottest_c, rainy_days}
4. get_exchange_rate(from: ISO currency, to: ISO currency) -> {rate}  (1 unit of from = rate units of to)
5. calculate(expression: string) -> {result}  (only + - * / ** and parentheses, numbers only; ALL arithmetic must go through this tool)`;
