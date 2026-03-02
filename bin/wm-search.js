#!/usr/bin/env node

/**
 * @fileoverview CLI entry point for wm-search.
 * Parses command-line options, executes searches, and renders output formats.
 * @module wm-search
 */

import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { search, searchRaw, getMakes, getStates } from "../lib/index.js";
import { initLogger, log, closeLogger } from "../lib/logger.js";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FLAG = process.argv.includes("--log");
if (LOG_FLAG) {
  initLogger(path.join(__dirname, ".."));
}

const CSV_ESCAPE_RE = /[,"\n\r]/;

const HELP = `
  \x1b[1mwm-search\x1b[0m — Search Web Motors from the terminal.

  \x1b[1mUsage:\x1b[0m
    wm-search <query> [options]

  \x1b[1mArguments:\x1b[0m
    query                  Search query — e.g. "Honda Civic", "Toyota Corolla" (required)
                           The query is auto-parsed into make/model when possible.

  \x1b[1mOptions:\x1b[0m
    -l, --limit <n>        Max results to return (default: 20)
    -s, --sort <order>     Sort: "relevance", "price_asc", "price_desc", "year_desc"
    -a, --state <uf>       Filter by Brazilian state(s). Single UF or comma-separated (e.g. "sp", "rj,mg")
    -m, --make <make>      Filter by vehicle make (e.g. "HONDA")
    -o, --model <model>    Filter by vehicle model (e.g. "Civic")
    -P, --min-price <n>    Minimum price filter
    -M, --max-price <n>    Maximum price filter
    -y, --min-year <n>     Minimum year filter
    -Y, --max-year <n>     Maximum year filter
    -k, --min-km <n>       Minimum mileage filter
    -K, --max-km <n>       Maximum mileage filter
    -T, --transmission <t> Transmission: "Manual" or "Automática"
    -G, --list-makes       List all known vehicle makes and exit
    -A, --list-states      List all valid states and exit
    -t, --timeout <ms>     HTTP timeout in ms (default: 15000)
    -n, --concurrency <n>  Max parallel requests (default: 5)
    -S, --strict           Only show results where ALL search terms appear
    -R, --no-rate-limit    Disable built-in rate limiting (use at your own risk — may get your IP blocked)
    -1, --save-on-first    Save the first HTTP response (JSON) to the project root
    -e, --save-on-error    Save any HTTP response that returns an error (JSON) to the project root
    -L, --log              Write a detailed debug log file to the project root

  \x1b[1mOutput:\x1b[0m
    -f, --format <type>    Output format: "json", "table", "jsonl", "csv" (default: json)
    -p, --pretty           Pretty-print JSON output
    -r, --raw              Output the full raw API response
    -F, --fields <list>    Comma-separated fields to include (e.g. "title,price,permalink")
    -w, --web              Open results as a web page in the browser

  \x1b[1mExamples:\x1b[0m
    wm-search "Honda Civic"
    wm-search "Toyota Corolla" -l 5 -f table
    wm-search "Volkswagen Golf" --sort price_asc --pretty
    wm-search "Fiat" --min-price 30000 --max-price 80000
    wm-search "BMW" --state sp --sort year_desc -f table
    wm-search "Chevrolet Onix" --fields title,price,permalink --format csv
    wm-search "Hyundai HB20" --raw > raw.json
    wm-search "Jeep Renegade" --web
    wm-search --list-makes
    wm-search --list-states
    wm-search "Honda Civic" --transmission Manual --strict
`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: "string", short: "l" },
      sort: { type: "string", short: "s" },
      state: { type: "string", short: "a" },
      make: { type: "string", short: "m" },
      model: { type: "string", short: "o" },
      "min-price": { type: "string", short: "P" },
      "max-price": { type: "string", short: "M" },
      "min-year": { type: "string", short: "y" },
      "max-year": { type: "string", short: "Y" },
      "min-km": { type: "string", short: "k" },
      "max-km": { type: "string", short: "K" },
      transmission: { type: "string", short: "T" },
      "list-makes": { type: "boolean", short: "G", default: false },
      "list-states": { type: "boolean", short: "A", default: false },
      timeout: { type: "string", short: "t" },
      concurrency: { type: "string", short: "n" },
      strict: { type: "boolean", short: "S", default: false },
      "no-rate-limit": { type: "boolean", short: "R", default: false },
      "save-on-first": { type: "boolean", short: "1", default: false },
      "save-on-error": { type: "boolean", short: "e", default: false },
      log: { type: "boolean", short: "L", default: false },
      format: { type: "string", short: "f" },
      pretty: { type: "boolean", short: "p", default: false },
      raw: { type: "boolean", short: "r", default: false },
      fields: { type: "string", short: "F" },
      web: { type: "boolean", short: "w", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
} catch (e) {
  error(`${e.message}\n  Run "wm-search --help" for usage info.`);
}

const { values: opts, positionals } = parsed;

if (opts.help) {
  process.stdout.write(HELP + "\n");
  process.exit(0);
}

if (opts["list-makes"]) {
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  const makes = getMakes();
  console.log(bold("\nMarcas disponíveis na Web Motors:\n"));
  console.log(`  ${bold("Marca")}`);
  console.log(dim(`  ${"─".repeat(30)}`));
  for (const m of makes) {
    console.log(`  ${m.name}`);
  }
  console.log(dim(`\n  Total: ${makes.length} marcas`));
  console.log(dim(`  Uso: wm-search "Honda Civic" ou wm-search --make HONDA --model Civic`));
  console.log();
  process.exit(0);
}

if (opts["list-states"]) {
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  const states = getStates();
  console.log(bold("\nEstados disponíveis:\n"));
  console.log(`  ${bold("UF".padEnd(6))} ${bold("Estado")}`);
  console.log(dim(`  ${"─".repeat(5)} ${"─".repeat(30)}`));
  for (const s of states) {
    console.log(`  ${s.slug.toUpperCase().padEnd(6)} ${s.name}`);
  }
  console.log(dim(`\n  Total: ${states.length} estados`));
  console.log(dim(`  Uso: wm-search "Honda Civic" --state sp`));
  console.log();
  process.exit(0);
}

if (opts.version) {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}

const query = positionals.join(" ").trim();
if (!query && !opts.make) {
  error("No search query provided. Use --help for usage info.");
}

const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
const timeout = opts.timeout ? parseInt(opts.timeout, 10) : 15000;
const concurrency = opts.concurrency ? parseInt(opts.concurrency, 10) : 5;
const format = (opts.format || "json").toLowerCase();
const fields = opts.fields
  ? opts.fields
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
  : null;

const minPrice = opts["min-price"] ? parseInt(opts["min-price"], 10) : undefined;
const maxPrice = opts["max-price"] ? parseInt(opts["max-price"], 10) : undefined;
const minYear = opts["min-year"] ? parseInt(opts["min-year"], 10) : undefined;
const maxYear = opts["max-year"] ? parseInt(opts["max-year"], 10) : undefined;
const minKm = opts["min-km"] ? parseInt(opts["min-km"], 10) : undefined;
const maxKm = opts["max-km"] ? parseInt(opts["max-km"], 10) : undefined;

if (!["json", "table", "jsonl", "csv"].includes(format)) {
  error(`Unknown format "${format}". Supported: json, table, jsonl, csv`);
}

if (opts.sort && !["relevance", "price_asc", "price_desc", "year_desc"].includes(opts.sort)) {
  error(`Unknown --sort "${opts.sort}". Supported: relevance, price_asc, price_desc, year_desc`);
}

if (opts.transmission && !["Manual", "Automática"].includes(opts.transmission)) {
  error(`Unknown --transmission "${opts.transmission}". Supported: Manual, Automática`);
}

if (!Number.isInteger(concurrency) || concurrency < 1) {
  error(`Invalid --concurrency "${opts.concurrency}". It must be a positive integer.`);
}

if (!Number.isInteger(limit) || limit < 1) {
  error(`Invalid --limit "${opts.limit}". It must be a positive integer.`);
}

if (!Number.isInteger(timeout) || timeout < 1) {
  error(`Invalid --timeout "${opts.timeout}". It must be a positive integer.`);
}

try {
  if (opts.raw) {
    const raw = await searchRaw(query, {
      timeout,
      sort: opts.sort,
      state: opts.state,
      make: opts.make,
      model: opts.model,
      minPrice,
      maxPrice,
      minYear,
      maxYear,
      minKm,
      maxKm,
      transmission: opts.transmission,
    });
    console.log(JSON.stringify(raw, null, 2));
    process.exit(0);
  }

  const result = await search(query, {
    limit,
    timeout,
    sort: opts.sort,
    concurrency,
    state: opts.state,
    make: opts.make,
    model: opts.model,
    minPrice,
    maxPrice,
    minYear,
    maxYear,
    minKm,
    maxKm,
    transmission: opts.transmission,
    strict: opts.strict,
    noRateLimit: opts["no-rate-limit"],
    onFirstResponse: opts["save-on-first"] ? makeSaveCallback("wm-first") : null,
    onErrorResponse: opts["save-on-error"] ? makeSaveCallback("wm-error") : null,
  });

  let items = result.items;

  if (fields) {
    items = items.map((item) => {
      const filtered = {};
      for (const f of fields) {
        if (f in item) filtered[f] = item[f];
      }
      return filtered;
    });
  }

  if (opts.web) {
    await openInBrowser(result, items);
  } else {
    output(items, result, format, opts.pretty);
  }

  const got = result.items.length;
  if (got < limit) {
    if (result.pagination.capped) {
      process.stderr.write(`\x1b[33mNote:\x1b[0m Returned ${got} of ${limit} requested.\n`);
    }
  }

  if (result.stats) {
    const s = result.stats;
    log("CLI", `Requests: ${s.requests} total (${s.pageRequests} page${s.pageRequests !== 1 ? "s" : ""} + ${s.detailRequests} detail${s.detailRequests !== 1 ? "s" : ""})`);
  }
} catch (e) {
  log("CLI", "Fatal error", e);
  closeLogger();
  error(e.message);
}

closeLogger();

/**
 * Dispatches item rendering to the requested output format.
 *
 * @param {object[]} items - Result items (possibly field-filtered).
 * @param {object} result - Full search response object.
 * @param {'json'|'jsonl'|'csv'|'table'} fmt - Output format.
 * @param {boolean} pretty - Pretty-print JSON flag.
 * @returns {void}
 */
function output(items, result, fmt, pretty) {
  switch (fmt) {
    case "json":
      if (pretty) {
        console.log(JSON.stringify({ ...result, items }, null, 2));
      } else {
        console.log(JSON.stringify({ ...result, items }));
      }
      break;

    case "jsonl":
      for (const item of items) {
        console.log(JSON.stringify(item));
      }
      break;

    case "csv":
      outputCsv(items);
      break;

    case "table":
      outputTable(items);
      break;
  }
}

/**
 * Renders results as an ANSI-formatted terminal table.
 *
 * @param {object[]} items - Normalized vehicle items.
 * @returns {void}
 */
function outputTable(items) {
  if (items.length === 0) {
    console.log("Nenhum resultado encontrado.");
    return;
  }

  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s) => `\x1b[1m${s}\x1b[0m`;
  const green = (s) => `\x1b[32m${s}\x1b[0m`;
  const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
  const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
  const magenta = (s) => `\x1b[35m${s}\x1b[0m`;

  console.log(dim(`─── Found ${items.length} result${items.length === 1 ? "" : "s"} ───`));
  console.log();

  for (const [i, item] of items.entries()) {
    const num = dim(`${String(i + 1).padStart(2)}.`);
    const rawTitle = item.title || "";
    const title = bold(rawTitle.length > 72 ? rawTitle.slice(0, 71) + "..." : rawTitle);
    const price = item.price != null ? green(`BRL ${item.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`) : yellow("Preço não informado");

    let badges = "";
    if (item.listingType === "Novo") badges += cyan(" [NOVO]");
    if (item.armored) badges += magenta(" [BLINDADO]");
    if (item.fipePercent && item.fipePercent < 100) badges += yellow(` [${item.fipePercent}% FIPE]`);
    if (item.sellerType) badges += dim(` [${item.sellerType}]`);

    const yearStr = item.yearFabrication && item.yearModel ? `${item.yearFabrication}/${item.yearModel}` : item.yearModel ? String(item.yearModel) : "";
    const kmStr = item.odometer ? `${item.odometer.toLocaleString("pt-BR")} km` : "";
    const transStr = item.transmission || "";
    const colorStr = item.color || "";
    const specs = [yearStr, kmStr, transStr, colorStr, item.doors ? `${item.doors}p` : ""].filter(Boolean).join(" • ");

    const loc = item.location ? dim(` • ${item.location}`) : "";
    const seller = item.sellerName ? dim(` • ${item.sellerName}`) : "";
    const link = item.permalink ? dim(`  ${item.permalink}`) : "";

    console.log(`${num} ${title}`);
    console.log(`    ${price}${badges}`);
    if (specs) console.log(`    ${cyan(specs)}`);
    if (loc || seller) console.log(`   ${loc}${seller}`);
    if (link) console.log(`    ${link}`);

    if (item.images && item.images.length > 1) {
      console.log(dim(`    PHOTOS: ${item.images.length} foto${item.images.length === 1 ? "" : "s"}`));
    }

    if (item.attributes) {
      for (const attr of item.attributes) {
        console.log(dim(`      ${attr}`));
      }
    }

    if (item.description) {
      const desc = item.description.replace(/\n+/g, " ").trim();
      console.log(dim(`    DESCRIPTION: ${desc.length > 120 ? desc.slice(0, 120) + "..." : desc}`));
    }

    console.log();
  }
}

/**
 * Serializes results as CSV to stdout.
 *
 * @param {object[]} items - Result items.
 * @returns {void}
 */
function outputCsv(items) {
  if (items.length === 0) return;

  const keys = Object.keys(items[0]);
  console.log(keys.join(","));

  for (const item of items) {
    const row = keys.map((k) => {
      const v = item[k];
      if (v == null) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (CSV_ESCAPE_RE.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    console.log(row.join(","));
  }
}

/**
 * Generates a complete self-contained HTML document for browser preview.
 *
 * @param {object} result - Full search response object.
 * @param {object[]} items - Items to render.
 * @returns {string} HTML page content.
 */
function generateHtml(result, items) {
  const { query, pagination } = result;

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const fmtPrice = (price) => {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(price);
    } catch {
      return `BRL ${price}`;
    }
  };

  const card = (item, index) => {
    const link = esc(item.permalink || "#");

    const allPics = item.images?.length > 0 ? item.images.map((p) => p.url) : item.thumbnail ? [item.thumbnail] : [];
    const mainSrc = allPics[0] || "";
    const thumbImg = mainSrc ? `<img class="thumb main-img" src="${esc(mainSrc)}" alt="${esc(item.title)}" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='flex'">` : "";

    const thumbPh = `<div class="thumb-ph"${mainSrc ? ' style="display:none"' : ""}><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M2 15l5-5 4 4 3-3 5 5"/><circle cx="8" cy="8" r="2"/></svg></div>`;
    const galleryStrip =
      allPics.length > 1
        ? `<div class="gallery-strip">${allPics
            .slice(0, 10)
            .map((url, gi) => `<button class="gal-btn${gi === 0 ? " active" : ""}" data-src="${esc(url)}" type="button" aria-label="Foto ${gi + 1}"><img src="${esc(url)}" loading="lazy" alt=""></button>`)
            .join("")}</div>`
        : "";

    const badges = [item.listingType === "Novo" && `<span class="b new">Novo</span>`, item.armored && `<span class="b arm">Blindado</span>`, item.fipePercent && item.fipePercent < 100 && `<span class="b fipe">${item.fipePercent}% FIPE</span>`, item.sellerType && `<span class="b seller">${esc(item.sellerType)}</span>`].filter(Boolean).join("");

    const priceHtml = item.price != null ? `<div class="price-row"><span class="price">${esc(fmtPrice(item.price))}</span></div>` : '<div class="price-row"><span class="price no-price">Preço não informado</span></div>';

    const yearStr = item.yearFabrication && item.yearModel ? `${item.yearFabrication}/${item.yearModel}` : item.yearModel ? String(item.yearModel) : "";
    const kmStr = item.odometer ? `${item.odometer.toLocaleString("pt-BR")} km` : "";
    const transStr = item.transmission || "";
    const colorStr = item.color || "";
    const specParts = [yearStr, kmStr, transStr, colorStr, item.doors ? `${item.doors}p` : ""].filter(Boolean);
    const specsHtml = specParts.length > 0 ? `<div class="specs">${specParts.map((s) => `<span class="spec">${esc(s)}</span>`).join("")}</div>` : "";

    const locHtml = item.location ? `<p class="location">${esc(item.location)}</p>` : "";
    const descHtml = item.description ? `<p class="desc">${esc(item.description.replace(/\n+/g, " ").trim().slice(0, 200))}${item.description.replace(/\n+/g, " ").trim().length > 200 ? "\u2026" : ""}</p>` : "";

    const attrsHtml = item.attributes?.length ? `<div class="attrs">${item.attributes.map((a) => `<span class="attr">${esc(a)}</span>`).join("")}</div>` : "";

    return `<article class="card" data-index="${index}" data-title="${esc((item.title || "").toLowerCase())}" data-desc="${esc((item.description || "").toLowerCase().slice(0, 500))}" data-price="${item.price ?? 0}" data-year="${item.yearModel ?? 0}" data-km="${item.odometer ?? 0}">
      <div class="img-zone" data-images="${esc(JSON.stringify(allPics))}">
        <div class="img-a">${thumbImg}${thumbPh}</div>
        ${galleryStrip}
      </div>
      <div class="card-body">
        ${badges ? `<div class="badges">${badges}</div>` : ""}
        <a class="title-a" href="${link}" target="_blank" rel="noopener noreferrer"><h2 class="card-title">${esc(item.title)}</h2></a>
        ${priceHtml}${specsHtml}${locHtml}${descHtml}${attrsHtml}
        <a class="btn-cta" href="${link}" target="_blank" rel="noopener noreferrer">Ver an\xFAncio &#8594;</a>
      </div>
    </article>`;
  };

  const sortMap = { relevance: "relevance", price_asc: "price-asc", price_desc: "price-desc", year_desc: "year-desc" };
  const initialSort = sortMap[query.sort] || "relevance";
  const now = new Date().toLocaleString("pt-BR");
  const cardsHtml = items.length > 0 ? items.map((item, i) => card(item, i)).join("\n") : '<p class="empty">Nenhum resultado encontrado.</p>';

  const css = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f4f5f7;--surface:#fff;--surface-2:#eef0f3;--border:#e2e5ea;
  --text:#111827;--muted:#6b7280;
  --accent:#e63946;--accent-fg:#fff;
  --price-c:#e63946;
  --new-bg:#10b981;--new-fg:#fff;
  --arm-bg:#6366f1;--arm-fg:#fff;
  --fipe-bg:#f97316;--fipe-fg:#fff;
  --seller-bg:#6b7280;--seller-fg:#fff;
  --spec-c:#2563eb;
  --sh1:0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.05);
  --sh2:0 6px 20px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.07);
  --r:14px;--rs:6px;
  --page-max:1680px;
  --header-py:.9rem;--header-px:1.5rem;
  --main-px:1.25rem;--main-pt:1.5rem;--main-pb:3rem;
  --card-gap:.4rem;--card-px:1rem;--card-pt:.875rem;--card-pb:1rem;
  --grid-gap:1.125rem;
  --ctl-py:.7rem;--ctl-px:1.25rem;--ctl-gap:.6rem;
  --chip-py:.28rem;--chip-px:.6rem;
  --thumb-pad:.5rem;
  --btn-py:.58rem;
  --icon-btn:36px;
  --footer-py:1.1rem;--footer-px:1.5rem;
}
@media(prefers-color-scheme:dark){
  :root:not([data-theme=light]){
    --bg:#0c0c14;--surface:#181825;--surface-2:#21212f;--border:#2b2b3d;
    --text:#f0eff9;--muted:#8b8aa8;--price-c:#f87171;
    --sh1:0 1px 4px rgba(0,0,0,.3);--sh2:0 6px 24px rgba(0,0,0,.45);
  }
}
[data-theme=dark]{
  --bg:#0c0c14;--surface:#181825;--surface-2:#21212f;--border:#2b2b3d;
  --text:#f0eff9;--muted:#8b8aa8;--price-c:#f87171;
  --sh1:0 1px 4px rgba(0,0,0,.3);--sh2:0 6px 24px rgba(0,0,0,.45);
}
[data-theme=light]{
  --bg:#f4f5f7;--surface:#fff;--surface-2:#eef0f3;--border:#e2e5ea;
  --text:#111827;--muted:#6b7280;--price-c:#e63946;
  --sh1:0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.05);
  --sh2:0 6px 20px rgba(0,0,0,.12),0 2px 6px rgba(0,0,0,.07);
}
body{font-family:'Poppins',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5;transition:background .2s,color .2s}
header{position:sticky;top:0;z-index:100;background:var(--accent);color:var(--accent-fg);padding:var(--header-py) var(--header-px);display:flex;align-items:center;gap:1rem;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.2)}
.h-left{display:flex;align-items:center;gap:.75rem;min-width:0;flex:1}
.logo{font-size:1.1rem;font-weight:800;letter-spacing:-.5px;white-space:nowrap;flex-shrink:0}
.logo em{font-style:normal;font-weight:400;opacity:.6}
.h-info{display:flex;flex-direction:column;min-width:0}
.h-query{font-weight:700;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h-meta{font-size:.7rem;opacity:.65;white-space:nowrap}
.theme-btn{flex-shrink:0;margin-left:auto;width:var(--icon-btn);height:var(--icon-btn);border-radius:50%;border:none;background:rgba(255,255,255,.2);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--accent-fg);transition:background .15s}
.theme-btn:hover{background:rgba(255,255,255,.35)}
.theme-btn svg{width:17px;height:17px;display:block}
main{max-width:var(--page-max);margin:0 auto;padding:var(--main-pt) var(--main-px) var(--main-pb)}
.empty{text-align:center;margin-top:5rem;color:var(--muted);font-size:1.05rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:var(--grid-gap)}
.card{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--sh1);transition:box-shadow .2s,transform .2s,border-color .2s}
.card:hover{box-shadow:var(--sh2);transform:translateY(-3px);border-color:var(--accent)}
.img-a{display:block;background:var(--surface-2);aspect-ratio:4/3;overflow:hidden;position:relative;cursor:zoom-in}
.thumb{width:100%;height:100%;object-fit:contain;padding:var(--thumb-pad);transition:transform .3s ease}
.img-a:hover .thumb{transform:scale(1.06)}
.thumb-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);opacity:.3}
.card-body{padding:var(--card-pt) var(--card-px) var(--card-pb);display:flex;flex-direction:column;gap:var(--card-gap);flex:1}
.badges{display:flex;flex-wrap:wrap;gap:.3rem}
.b{display:inline-block;padding:.18rem .42rem;border-radius:var(--rs);font-size:.6rem;font-weight:700;letter-spacing:.4px;text-transform:uppercase;line-height:1.3}
.b.new{background:var(--new-bg);color:var(--new-fg)}
.b.arm{background:var(--arm-bg);color:var(--arm-fg)}
.b.fipe{background:var(--fipe-bg);color:var(--fipe-fg)}
.b.seller{background:var(--seller-bg);color:var(--seller-fg)}
.title-a{text-decoration:none;color:inherit}
.card-title{font-size:.875rem;font-weight:500;line-height:1.45;color:var(--text);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;transition:color .15s}
.title-a:hover .card-title{color:var(--accent)}
.price-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:.35rem;margin-top:.1rem}
.price{font-size:1.2rem;font-weight:700;color:var(--price-c)}
.price.no-price{font-size:.9rem;color:var(--muted);font-weight:500}
.specs{display:flex;flex-wrap:wrap;gap:.3rem}
.spec{font-size:.67rem;color:var(--spec-c);border:1px solid color-mix(in srgb,var(--spec-c) 30%,transparent);border-radius:var(--rs);padding:.1rem .32rem;background:color-mix(in srgb,var(--spec-c) 8%,transparent)}
.location{font-size:.72rem;color:var(--muted)}
.seller{font-size:.71rem;color:var(--muted)}
.attrs{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.15rem}
.attr{font-size:.62rem;color:var(--muted);border:1px solid var(--border);border-radius:var(--rs);padding:.08rem .28rem}
.img-zone{display:flex;flex-direction:column}
.gallery-strip{display:flex;gap:4px;padding:5px 6px;background:var(--surface-2);border-top:1px solid var(--border);overflow-x:auto;scrollbar-width:none}
.gallery-strip::-webkit-scrollbar{display:none}
.gal-btn{flex-shrink:0;width:38px;height:38px;border-radius:5px;border:2px solid transparent;background:var(--surface);padding:1px;cursor:pointer;transition:border-color .15s,transform .1s;overflow:hidden}
.gal-btn img{width:100%;height:100%;object-fit:cover;border-radius:3px;display:block}
.gal-btn.active{border-color:var(--accent)}
.gal-btn:hover:not(.active){border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
.gal-btn:active{transform:scale(.92)}
.btn-cta{display:block;text-align:center;margin-top:auto;padding:var(--btn-py);background:var(--accent);color:var(--accent-fg);font-weight:700;font-size:.8rem;border-radius:var(--rs);text-decoration:none;transition:filter .15s,transform .1s}
.btn-cta:hover{filter:brightness(.93);transform:scale(1.01)}
.controls{background:var(--surface);border-bottom:1px solid var(--border);padding:var(--ctl-py) var(--ctl-px);display:flex;flex-wrap:wrap;align-items:center;gap:var(--ctl-gap);position:sticky;top:var(--controls-top,56px);z-index:90;backdrop-filter:blur(8px)}
.ctrl-search{display:flex;align-items:center;gap:.45rem;background:var(--surface-2);border:1px solid var(--border);border-radius:99px;padding:.32rem .75rem;flex:1;min-width:160px;max-width:340px;transition:border-color .15s}
.ctrl-search:focus-within{border-color:var(--accent)}
.ctrl-search svg{flex-shrink:0;color:var(--muted);width:15px;height:15px}
.ctrl-search input{border:none;background:transparent;color:var(--text);font-size:.83rem;width:100%;outline:none}
.ctrl-search input::placeholder{color:var(--muted)}
.ctrl-sort{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem}
.sort-label{font-size:.74rem;font-weight:600;color:var(--muted);flex-shrink:0;white-space:nowrap}
.sort-btn{border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-size:.72rem;font-weight:500;padding:var(--chip-py) var(--chip-px);border-radius:99px;cursor:pointer;transition:background .15s,border-color .15s,color .15s,transform .1s}
.sort-btn:hover{border-color:color-mix(in srgb,var(--accent) 60%,transparent);background:color-mix(in srgb,var(--accent) 10%,var(--surface-2))}
.sort-btn.active{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:700}
.sort-btn:active{transform:scale(.96)}
.ctrl-count{font-size:.73rem;color:var(--muted);margin-left:auto;white-space:nowrap;flex-shrink:0}
.card.hidden{display:none!important}
.no-match{grid-column:1/-1;text-align:center;padding:4rem 1rem;color:var(--muted);font-size:1rem}
footer{border-top:1px solid var(--border);padding:var(--footer-py) var(--footer-px);text-align:center;font-size:.75rem;color:var(--muted)}
footer strong{color:var(--text)}
footer a{color:inherit}
.ctrl-anti{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem}
.anti-label{font-size:.74rem;font-weight:600;color:var(--muted);flex-shrink:0;white-space:nowrap}
.anti-input-wrap{display:flex;align-items:center;gap:.45rem;background:var(--surface-2);border:1px solid var(--border);border-radius:99px;padding:.32rem .75rem;min-width:140px;max-width:260px;transition:border-color .15s}
.anti-input-wrap:focus-within{border-color:#ef4444}
.anti-input-wrap svg{flex-shrink:0;color:var(--muted);width:15px;height:15px}
.anti-input-wrap input{border:none;background:transparent;color:var(--text);font-size:.83rem;width:100%;outline:none}
.anti-input-wrap input::placeholder{color:var(--muted)}
.anti-chips{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
.anti-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.2rem .5rem .2rem .6rem;background:color-mix(in srgb,#ef4444 12%,var(--surface-2));border:1px solid color-mix(in srgb,#ef4444 35%,transparent);border-radius:99px;font-size:.7rem;font-weight:600;color:#ef4444}
.anti-chip button{background:none;border:none;cursor:pointer;color:inherit;padding:0 0 0 .15rem;line-height:1;font-size:.9rem;opacity:.7;display:flex;align-items:center}
.anti-chip button:hover{opacity:1}
@media(max-width:600px){.controls{padding:.6rem .875rem;gap:.5rem}.ctrl-search{max-width:100%;width:100%}.ctrl-count{display:none}}
@media(max-width:480px){header{padding:.75rem 1rem}.h-meta{display:none}main{padding:1rem .875rem 2.5rem}.grid{gap:.875rem}}
.desc{font-size:.72rem;color:var(--muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.lightbox{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;flex-direction:column;gap:.5rem}
.lightbox.open{display:flex}
.lb-img{max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px}
.lb-close{position:absolute;top:1rem;right:1rem;background:rgba(255,255,255,.15);border:none;color:#fff;width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:1.5rem;display:flex;align-items:center;justify-content:center;transition:background .15s}
.lb-close:hover{background:rgba(255,255,255,.3)}
.lb-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.15);border:none;color:#fff;width:48px;height:48px;border-radius:50%;cursor:pointer;font-size:1.5rem;display:flex;align-items:center;justify-content:center;transition:background .15s}
.lb-nav:hover{background:rgba(255,255,255,.3)}
.lb-prev{left:1rem}
.lb-next{right:1rem}
.lb-counter{color:rgba(255,255,255,.7);font-size:.8rem}
.skip{position:absolute;top:-100%;left:0;background:var(--accent);color:var(--accent-fg);padding:.5rem 1rem;z-index:200;font-weight:600;border-radius:0 0 var(--rs) 0;transition:top .15s;text-decoration:none;font-size:.85rem}.skip:focus{top:0}`;

  const js = `(function(){
  var root=document.documentElement,btn=document.getElementById('theme-btn');
  var SUN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  var MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  function isDark(){var t=root.getAttribute('data-theme');return t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches)}
  function apply(dark){root.setAttribute('data-theme',dark?'dark':'light');btn.innerHTML=dark?SUN:MOON;try{localStorage.setItem('wm-theme',dark?'dark':'light')}catch(e){}}
  var saved;try{saved=localStorage.getItem('wm-theme')}catch(e){}
  apply(saved?saved==='dark':false);
  btn.addEventListener('click',function(){apply(!isDark())});

  var hdr=document.querySelector('header'),ctl=document.querySelector('.controls');
  function pinControls(){if(hdr&&ctl){document.documentElement.style.setProperty('--controls-top',hdr.offsetHeight+'px');}}
  pinControls();
  window.addEventListener('resize',pinControls);

  var searchInput=document.getElementById('search-input');
  var sortBtns=document.querySelectorAll('.sort-btn');
  var cards=Array.from(document.querySelectorAll('.card'));
  var grid=document.querySelector('.grid');
  var countEl=document.getElementById('ctrl-count');
  var controls=document.querySelector('.controls');
  var currentSort=(controls&&controls.dataset.initialSort)||'relevance';
  var currentSearch='';
  sortBtns.forEach(function(b){b.classList.toggle('active',b.dataset.sort===currentSort);});

  var excludeTerms=[];
  function update(){
    var q=currentSearch.toLowerCase();
    var visible=cards.filter(function(c){
      var title=c.dataset.title;
      var desc=c.dataset.desc||'';
      var matchPos=!q||title.indexOf(q)!==-1;
      var matchAnti=!excludeTerms.some(function(t){return title.indexOf(t)!==-1||desc.indexOf(t)!==-1;});
      var match=matchPos&&matchAnti;
      c.classList.toggle('hidden',!match);
      return match;
    });
    visible.sort(function(a,b){
      switch(currentSort){
        case 'price-asc': return parseFloat(a.dataset.price)-parseFloat(b.dataset.price);
        case 'price-desc': return parseFloat(b.dataset.price)-parseFloat(a.dataset.price);
        case 'year-desc': return parseFloat(b.dataset.year)-parseFloat(a.dataset.year);
        case 'km-asc': return parseFloat(a.dataset.km)-parseFloat(b.dataset.km);
        default: return parseInt(a.dataset.index)-parseInt(b.dataset.index);
      }
    });
    visible.forEach(function(c){grid.appendChild(c);});
    var noMatch=document.getElementById('no-match');
    if(visible.length===0){
      if(!noMatch){var p=document.createElement('p');p.id='no-match';p.className='no-match';p.textContent='Nenhum ve\\xEDculo encontrado para "'+currentSearch+'"';grid.appendChild(p);}
    }else if(noMatch){noMatch.remove();}
    if(countEl){countEl.textContent=visible.length+' ve\\xEDculo'+(visible.length===1?'':'s');}
  }

  var searchTimer;
  if(searchInput){
    searchInput.addEventListener('input',function(){
      clearTimeout(searchTimer);
      searchTimer=setTimeout(function(){currentSearch=searchInput.value;update();},180);
    });
  }
  var antiInput=document.getElementById('anti-input');
  var antiChipsEl=document.getElementById('anti-chips');
  function renderChips(){
    antiChipsEl.innerHTML='';
    excludeTerms.forEach(function(term,i){
      var chip=document.createElement('span');chip.className='anti-chip';
      var lbl=document.createTextNode(term);
      var btn=document.createElement('button');btn.setAttribute('aria-label','Remover '+term);btn.innerHTML='&#215;';
      btn.addEventListener('click',function(){excludeTerms.splice(i,1);renderChips();update();});
      chip.appendChild(lbl);chip.appendChild(btn);antiChipsEl.appendChild(chip);
    });
  }
  if(antiInput){
    antiInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){
        var term=antiInput.value.trim().toLowerCase();
        if(term&&excludeTerms.indexOf(term)===-1){excludeTerms.push(term);renderChips();update();}
        antiInput.value='';
      }
    });
  }
  sortBtns.forEach(function(btn){
    btn.addEventListener('click',function(){
      currentSort=btn.dataset.sort;
      sortBtns.forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      update();
    });
  });
  if(countEl){countEl.textContent=cards.length+' ve\\xEDculo'+(cards.length===1?'':'s');}
  document.querySelectorAll('.gallery-strip').forEach(function(strip){
    strip.querySelectorAll('.gal-btn').forEach(function(gbtn){
      gbtn.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        var zone=strip.closest('.img-zone');
        var mainImg=zone&&zone.querySelector('.main-img');
        var ph=zone&&zone.querySelector('.thumb-ph');
        if(mainImg){mainImg.src=gbtn.dataset.src;mainImg.style.display='';}
        if(ph){ph.style.display='none';}
        strip.querySelectorAll('.gal-btn').forEach(function(b){b.classList.remove('active');});
        gbtn.classList.add('active');
      });
    });
  });

  var lb=document.getElementById('lightbox'),lbImg=document.getElementById('lb-img'),lbCounter=document.getElementById('lb-counter');
  var lbImages=[],lbIdx=0;
  function openLb(imgs,idx){lbImages=imgs;lbIdx=idx||0;showLb();lb.classList.add('open');}
  function closeLb(){lb.classList.remove('open');}
  function showLb(){if(lbImages.length){lbImg.src=lbImages[lbIdx];lbCounter.textContent=(lbIdx+1)+' / '+lbImages.length;}}
  function lbPrev(){lbIdx=(lbIdx-1+lbImages.length)%lbImages.length;showLb();}
  function lbNext(){lbIdx=(lbIdx+1)%lbImages.length;showLb();}
  document.getElementById('lb-close').addEventListener('click',closeLb);
  document.getElementById('lb-prev').addEventListener('click',lbPrev);
  document.getElementById('lb-next').addEventListener('click',lbNext);
  lb.addEventListener('click',function(e){if(e.target===lb)closeLb();});
  document.addEventListener('keydown',function(e){if(!lb.classList.contains('open'))return;if(e.key==='Escape')closeLb();if(e.key==='ArrowLeft')lbPrev();if(e.key==='ArrowRight')lbNext();});
  document.querySelectorAll('.img-zone[data-images]').forEach(function(zone){
    var imgA=zone.querySelector('.img-a');
    if(imgA){imgA.addEventListener('click',function(){try{var imgs=JSON.parse(zone.dataset.images);if(!imgs.length)return;var activeBtn=zone.querySelector('.gal-btn.active');var idx=0;if(activeBtn){var all=Array.from(zone.querySelectorAll('.gal-btn'));idx=all.indexOf(activeBtn);if(idx<0)idx=0;}openLb(imgs,idx);}catch(e){}});}
  });

  document.addEventListener('click', function(e) {
    var a = e.target.closest('a');
    if (a && (a.classList.contains('title-a') || a.classList.contains('btn-cta'))) {
      if (!e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        var ev = new MouseEvent('click', {
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true
        });
        a.dispatchEvent(ev);
      }
    }
  });
})();`;

  const queryText = query.text || [query.make, query.model].filter(Boolean).join(" ") || "Todos";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>wm-search · ${esc(queryText)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<a class="skip" href="#main-content">Pular para o conte\xFAdo</a>
<header>
  <div class="h-left">
    <span class="logo">wm-search<em>.cli</em></span>
    <div class="h-info">
      <span class="h-query">${esc(queryText)}</span>
      <span class="h-meta">${query.state ? `${query.state.toUpperCase()} · ` : ""}${items.length} resultado${items.length === 1 ? "" : "s"} · ${now}</span>
    </div>
  </div>
  <button id="theme-btn" class="theme-btn" aria-label="Alternar tema claro/escuro"></button>
</header>
<div class="controls" data-initial-sort="${initialSort}">
  <div class="ctrl-search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="search-input" type="search" placeholder="Filtrar veículos&hellip;" autocomplete="off" aria-label="Filtrar veículos">
  </div>
  <div class="ctrl-sort">
    <span class="sort-label">Ordenar:</span>
    <button class="sort-btn" data-sort="relevance">Relevância</button>
    <button class="sort-btn" data-sort="price-asc">Menor Preço</button>
    <button class="sort-btn" data-sort="price-desc">Maior Preço</button>
    <button class="sort-btn" data-sort="year-desc">Mais Novo</button>
    <button class="sort-btn" data-sort="km-asc">Menor Km</button>
  </div>
  <div class="ctrl-anti">
    <span class="anti-label">Excluir:</span>
    <div class="anti-input-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      <input id="anti-input" type="text" placeholder="Excluir palavra&hellip;" autocomplete="off" aria-label="Excluir por palavra-chave">
    </div>
    <div class="anti-chips" id="anti-chips"></div>
  </div>
  <span class="ctrl-count" id="ctrl-count" aria-live="polite"></span>
</div>
<main id="main-content">
  <div class="grid">
${cardsHtml}
  </div>
</main>
<footer>Gerado por <strong>wm-search-cli</strong> &middot; Dados da <a href="https://www.webmotors.com.br" target="_blank" rel="noopener noreferrer">Web Motors</a></footer>
<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Galeria de imagens">
  <button class="lb-close" id="lb-close" aria-label="Fechar">&times;</button>
  <button class="lb-nav lb-prev" id="lb-prev" aria-label="Foto anterior">&#8249;</button>
  <button class="lb-nav lb-next" id="lb-next" aria-label="Pr\xF3xima foto">&#8250;</button>
  <img class="lb-img" id="lb-img" src="" alt="Imagem ampliada">
  <span class="lb-counter" id="lb-counter"></span>
</div>
<script>${js}</script>
</body>
</html>`;
}

/**
 * Writes a temporary HTML report and opens it in the default browser.
 *
 * @param {object} result - Full search response object.
 * @param {object[]} items - Items to render.
 * @returns {Promise<void>}
 */
async function openInBrowser(result, items) {
  const { writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { spawn } = await import("node:child_process");
  const { join } = await import("node:path");

  const html = generateHtml(result, items);
  const file = join(tmpdir(), `wm-search-${Date.now()}.html`);
  writeFileSync(file, html, "utf8");

  const opts = { detached: true, stdio: "ignore", windowsHide: true };
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", file], opts).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [file], opts).unref();
  } else {
    spawn("xdg-open", [file], opts).unref();
  }
  process.stderr.write(`Opened in browser: ${file}\n`);
}

/**
 * Creates a callback that saves HTTP response data to files in the project root.
 * Each invocation writes a `.json` metadata file and, when a body is present, an `.html` file.
 *
 * @param {string} prefix - Filename prefix (e.g. `"wm-first"` or `"wm-error"`).
 * @returns {(data: {url: string, body: string|null, error: string|null, timestamp: string}) => Promise<void>}
 */
function makeSaveCallback(prefix) {
  let callCount = 0;
  return async ({ url, body, error: errorMsg, timestamp }) => {
    callCount++;
    const ts = timestamp.replace(/[:.]/g, "-").replace("T", "_").substring(0, 19);
    const suffix = callCount > 1 ? `_${callCount}` : "";
    const baseName = `${prefix}_${ts}${suffix}`;
    const rootDir = path.join(__dirname, "..");
    const meta = { url, timestamp, error: errorMsg || null, bodyLength: body ? body.length : 0 };
    fs.writeFileSync(path.join(rootDir, `${baseName}.json`), JSON.stringify(meta, null, 2), "utf-8");
    if (body) fs.writeFileSync(path.join(rootDir, `${baseName}.html`), body, "utf-8");
    log("CLI", `Saved: ${baseName}.json${body ? ` + ${baseName}.html` : ""}`);
  };
}

/**
 * Prints a formatted error message and exits with status code 1.
 *
 * @param {string} msg - Error message.
 * @returns {never}
 */
function error(msg) {
  console.error(`\x1b[31mError:\x1b[0m ${msg}`);
  process.exit(1);
}
