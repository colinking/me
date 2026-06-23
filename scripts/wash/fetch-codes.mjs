#!/usr/bin/env node
// One-off scraper for the WASH Connect site-code namespaces.
// See docs/WASH_CONNECT_API.md ("Building a geo index") for the rationale,
// the namespace shapes, and the script policy (<=5 RPS, cache, review first).
//
// Sweeps the `wsh####` band, then the `W######` band, caching every code's raw
// API response to a single JSON map keyed by code — so a rerun never hits the
// endpoint twice for the same code (including known-404s). Throttled to
// MAX_RPS real requests/sec; cached codes are skipped for free.
//
//   node scripts/wash/fetch-codes.mjs            # full sweep: wsh band, then W band
//   LIMIT=10 node scripts/wash/fetch-codes.mjs   # smoke test: 10 new fetches then stop
//   ONLY=W node scripts/wash/fetch-codes.mjs     # only the W band
//   ONLY=W FROM=15000 TO=20000 node scripts/wash/fetch-codes.mjs   # re-probe the W frontier
//   ONLY=W FROM=16000 TO=999999 STEP=500 node …  # coarse-grid insurance pass above the cliff
//   DUMP=1 node scripts/wash/fetch-codes.mjs      # also print every cached location at the end
//
// Env knobs: MAX_RPS (5), LIMIT (new fetches this run, default unlimited),
// ONLY (namespace name), FROM/TO (override range; needs ONLY), STEP (1),
// DUMP (print full dump), RETRIES (3).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WASH_API = "https://us-central1-washmobilepay.cloudfunctions.net";

// The two confirmed namespaces, swept in this order. Ranges are inclusive and
// cover each populated band with margin (the W band cliffs at ~W015000–016000;
// see docs). Re-probe the frontier / coarse-grid above via FROM/TO/STEP.
const NAMESPACES = [
  { name: "wsh", prefix: "wsh", digits: 4, from: 0, to: 9999 },
  { name: "W", prefix: "W", digits: 6, from: 0, to: 16000 },
];

const MAX_RPS = Number(process.env.MAX_RPS ?? 5);
const MIN_INTERVAL_MS = 1000 / MAX_RPS; // 5 rps -> 200ms between real requests
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const ONLY = process.env.ONLY || null;
const FROM = process.env.FROM ? Number(process.env.FROM) : null;
const TO = process.env.TO ? Number(process.env.TO) : null;
const STEP = Number(process.env.STEP ?? 1);
const RETRIES = Number(process.env.RETRIES ?? 3);
const DUMP = Boolean(process.env.DUMP);
const FLUSH_EVERY = 100; // persist the cache every N new fetches
const PROGRESS_EVERY = 500; // print a progress/ETA line every N new fetches

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(SCRIPT_DIR, "cache.json");

const codeFor = (ns, n) => `${ns.prefix}${String(n).padStart(ns.digits, "0")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The cache is a single object: { "wsh0000": <record>, ... }.
const loadCache = async () => {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {}; // first run
    throw err;
  }
};

// Write the whole map atomically (temp file + rename) so an interrupted flush
// can never truncate the existing cache.
const saveCache = async (cache) => {
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, CACHE_FILE);
};

// Fetch one code's raw response. Returns the record we store in the cache.
// `outcome` lets us cache misses cheaply without re-deriving them on reload.
const fetchCode = async (c) => {
  const url = `${WASH_API}/locations?srcode=${encodeURIComponent(c)}`;
  const res = await fetch(url, {
    headers: { provider: "kiosoft" },
    signal: AbortSignal.timeout(10_000),
  });

  // 404 = code doesn't exist. Cache it so we never probe it again.
  if (res.status === 404) {
    return { fetchedAt: new Date().toISOString(), httpStatus: 404, outcome: "not_found" };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`); // transient (429/5xx); retry, don't cache
  }

  const body = await res.json();
  // Some endpoints embed an error status in the body even on HTTP 200.
  const outcome = body?.status === 200 ? "ok" : "error";
  return { fetchedAt: new Date().toISOString(), httpStatus: res.status, outcome, body };
};

// Retry transient failures (timeouts, 429, 5xx) with linear backoff. A 404 is
// not an error — it returns a cacheable record and never reaches here.
const fetchWithRetry = async (c) => {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fetchCode(c);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await sleep(500 * attempt); // 500ms, 1000ms, …
    }
  }
  throw lastErr;
};

// Canadian province codes — every other ULN prefix is a US state. WASH runs in
// the US + all Canadian provinces, and the API returns no country field, so we
// infer it from the ULN prefix.
const CA_PROVINCES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

// "<state>, <country>" from the ULN prefix, e.g. "CA, USA" / "ON, Canada".
const regionLabel = (record) => {
  const state = (record.body?.location?.uln ?? "").trim().slice(0, 2).toUpperCase();
  if (!state) return "";
  return `${state}, ${CA_PROVINCES.has(state) ? "Canada" : "USA"}`;
};

// One line per location: code, outcome, region, street address.
const printLocation = (c, record) => {
  const name = record.body?.location?.location_name ?? "";
  process.stdout.write(
    `${c.padEnd(8)} ${record.outcome.padEnd(9)} ${regionLabel(record).padEnd(11)}  ${name}\n`,
  );
};

// Resolve which namespaces+ranges to sweep, honoring ONLY / FROM / TO / STEP.
const plan = () => {
  let nss = NAMESPACES.filter((ns) => !ONLY || ns.name === ONLY);
  if (ONLY && nss.length === 0) {
    throw new Error(`unknown ONLY=${ONLY}; valid: ${NAMESPACES.map((n) => n.name).join(", ")}`);
  }
  if ((FROM !== null || TO !== null) && nss.length !== 1) {
    throw new Error("FROM/TO require ONLY=<namespace> so the range is unambiguous");
  }
  return nss.map((ns) => ({
    ...ns,
    from: FROM ?? ns.from,
    to: TO ?? ns.to,
  }));
};

const main = async () => {
  await mkdir(SCRIPT_DIR, { recursive: true });
  const cache = await loadCache();
  const namespaces = plan();

  // Build the ordered worklist: wsh band first, then W band.
  const codes = [];
  for (const ns of namespaces) {
    for (let n = ns.from; n <= ns.to; n += STEP) codes.push(codeFor(ns, n));
  }
  const toFetch = codes.filter((c) => !cache[c]).length;
  console.log(
    `Plan: ${namespaces.map((n) => `${n.name}[${n.from}..${n.to}]`).join(" then ")} ` +
      `step=${STEP} -> ${codes.length} codes, ${toFetch} not yet cached, ` +
      `limit=${LIMIT === Infinity ? "none" : LIMIT}, ${MAX_RPS} rps\n`,
  );

  let fetched = 0;
  let skipped = 0;
  let ok = 0;
  let notFound = 0;
  let failed = 0;
  let dirty = 0; // new records since last flush
  let lastRequestAt = 0;
  const startedAt = Date.now();

  // Flush on Ctrl-C so an interrupted run keeps everything fetched so far.
  let interrupted = false;
  process.on("SIGINT", () => {
    interrupted = true;
    process.stderr.write("\nInterrupt received; flushing and stopping…\n");
  });

  for (const c of codes) {
    if (interrupted || fetched >= LIMIT) break;
    if (cache[c]) {
      skipped++;
      continue;
    }

    // Throttle: ensure >= MIN_INTERVAL_MS since the last *real* request.
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    try {
      const record = await fetchWithRetry(c);
      cache[c] = record;
      fetched++;
      dirty++;
      if (record.outcome === "ok") ok++;
      else if (record.outcome === "not_found") notFound++;
      printLocation(c, record);
    } catch (err) {
      failed++;
      process.stdout.write(`${c.padEnd(8)} FAILED    ${err.message}\n`);
    }

    if (dirty >= FLUSH_EVERY) {
      await saveCache(cache);
      dirty = 0;
    }
    if (fetched > 0 && fetched % PROGRESS_EVERY === 0) {
      const remaining = Math.max(0, Math.min(toFetch, LIMIT) - fetched);
      const etaMin = ((remaining * MIN_INTERVAL_MS) / 60_000).toFixed(1);
      const rate = (fetched / ((Date.now() - startedAt) / 1000)).toFixed(1);
      process.stderr.write(
        `  …${fetched} fetched (ok=${ok} 404=${notFound} fail=${failed}), ` +
          `${rate} rps, ~${etaMin} min left\n`,
      );
    }
  }

  if (dirty > 0) await saveCache(cache); // final flush

  if (DUMP) {
    console.log(`\n=== All cached locations ===`);
    for (const c of Object.keys(cache).sort()) printLocation(c, cache[c]);
  }

  console.log(
    `\n${interrupted ? "Interrupted. " : fetched >= LIMIT ? "Hit LIMIT. " : "Done. "}` +
      `fetched=${fetched} (ok=${ok} not_found=${notFound}) ` +
      `skipped_cached=${skipped} failed=${failed}\n` +
      `Cache: ${CACHE_FILE} (${Object.keys(cache).length} codes total)`,
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
