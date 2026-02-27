/**
 * @fileoverview Core search library for Web Motors Brazil.
 * Provides functions to query Web Motors search endpoints, normalize vehicle
 * records, and return structured results for CLI/library usage.
 * @module index
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./logger.js";

const execFileAsync = promisify(execFile);

const API_BASE = "https://www.webmotors.com.br/api/search/car.xml";
const PHOTO_BASE = "https://image.webmotors.com.br/_fotos/anunciousados/gigante/";
const WM_DOMAIN = "www.webmotors.com.br";
const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT = 15000;
const DEFAULT_CONCURRENCY = 5;
const PAGE_SIZE = 24;

const RATE_LIMIT_PAGE_DELAY = 200;
const RATE_LIMIT_CONCURRENCY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VALID_STATES = new Map([
  ["ac", "Acre"],
  ["al", "Alagoas"],
  ["ap", "Amapá"],
  ["am", "Amazonas"],
  ["ba", "Bahia"],
  ["ce", "Ceará"],
  ["df", "Distrito Federal"],
  ["es", "Espírito Santo"],
  ["go", "Goiás"],
  ["ma", "Maranhão"],
  ["mt", "Mato Grosso"],
  ["ms", "Mato Grosso do Sul"],
  ["mg", "Minas Gerais"],
  ["pa", "Pará"],
  ["pb", "Paraíba"],
  ["pr", "Paraná"],
  ["pe", "Pernambuco"],
  ["pi", "Piauí"],
  ["rj", "Rio de Janeiro"],
  ["rn", "Rio Grande do Norte"],
  ["rs", "Rio Grande do Sul"],
  ["ro", "Rondônia"],
  ["rr", "Roraima"],
  ["sc", "Santa Catarina"],
  ["sp", "São Paulo"],
  ["se", "Sergipe"],
  ["to", "Tocantins"],
]);

const KNOWN_MAKES = new Set(["ALFA ROMEO", "ASTON MARTIN", "AUDI", "BENTLEY", "BMW", "BYD", "CAOA CHERY", "CHEVROLET", "CHRYSLER", "CITROËN", "DODGE", "EFFA", "FERRARI", "FIAT", "FORD", "GEELY", "GWM", "HONDA", "HYUNDAI", "IVECO", "JAC", "JAGUAR", "JEEP", "KIA", "LAMBORGHINI", "LAND ROVER", "LEXUS", "LIFAN", "MASERATI", "MERCEDES-BENZ", "MINI", "MITSUBISHI", "NISSAN", "PEUGEOT", "PORSCHE", "RAM", "RENAULT", "ROLLS-ROYCE", "SMART", "SSANGYONG", "SUBARU", "SUZUKI", "TOYOTA", "TROLLER", "VOLKSWAGEN", "VOLVO"]);

const SORT_MAP = {
  relevance: "1",
  price_asc: "2",
  price_desc: "3",
  year_desc: "4",
};

/**
 * Searches Web Motors and returns a structured result set.
 *
 * @param {string} query - Free-text query (parsed into make/model when possible).
 * @param {object} [options={}] - Search options.
 * @param {number} [options.limit=20] - Maximum number of items to return.
 * @param {number} [options.timeout=15000] - HTTP request timeout in ms.
 * @param {'relevance'|'price_asc'|'price_desc'|'year_desc'} [options.sort] - Sort order.
 * @param {number} [options.concurrency=5] - Max parallel requests.
 * @param {string} [options.state] - Filter by Brazilian state UF (e.g. "sp").
 * @param {string} [options.make] - Filter by vehicle make (e.g. "HONDA").
 * @param {string} [options.model] - Filter by vehicle model (e.g. "Civic").
 * @param {number} [options.minPrice] - Minimum price filter.
 * @param {number} [options.maxPrice] - Maximum price filter.
 * @param {number} [options.minYear] - Minimum year filter.
 * @param {number} [options.maxYear] - Maximum year filter.
 * @param {number} [options.minKm] - Minimum mileage filter.
 * @param {number} [options.maxKm] - Maximum mileage filter.
 * @param {string} [options.transmission] - Transmission filter ("Manual" or "Automática").
 * @param {boolean} [options.strict=false] - Only show results matching all query terms.
 * @returns {Promise<{items: object[], query: object, pagination: object}>}
 */
export async function search(query, options = {}) {
  const { limit = DEFAULT_LIMIT, timeout = DEFAULT_TIMEOUT, sort, concurrency: rawConcurrency = DEFAULT_CONCURRENCY, state, make, model, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission, strict = false, noRateLimit = false } = options;
  const concurrency = noRateLimit ? rawConcurrency : Math.min(rawConcurrency, RATE_LIMIT_CONCURRENCY);
  log("SEARCH", `search("${query}") called`, { limit, sort, state, make, model, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission, strict, noRateLimit, concurrency });

  const stateList = state
    ? state
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  for (const s of stateList) {
    if (!VALID_STATES.has(s)) throw new Error(`Unknown state "${s}". Use a valid Brazilian UF (e.g. sp, rj, mg).`);
  }

  if (stateList.length > 1) {
    const settled = await Promise.allSettled(stateList.map((s) => search(query, { ...options, state: s, limit: strict ? limit * 3 : limit })));
    const seenIds = new Set();
    let merged = [];
    let firstResultUrl = null;
    let resolvedMake = null;
    let resolvedModel = null;
    const stateResults = [];
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") continue;
      const r = outcome.value;
      if (!firstResultUrl) {
        firstResultUrl = r.query.url;
        resolvedMake = r.query.make;
        resolvedModel = r.query.model;
      }
      stateResults.push(r.items);
    }
    const maxLen = Math.max(0, ...stateResults.map((arr) => arr.length));
    for (let i = 0; i < maxLen; i++) {
      for (const arr of stateResults) {
        if (i >= arr.length) continue;
        const item = arr[i];
        if (item.id && seenIds.has(item.id)) continue;
        if (item.id) seenIds.add(item.id);
        merged.push(item);
      }
    }
    if (strict) merged = merged.filter((item) => matchesQuery(item, query));
    if (sort === "price_asc") merged.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    else if (sort === "price_desc") merged.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    else if (sort === "year_desc") merged.sort((a, b) => (b.yearModel ?? 0) - (a.yearModel ?? 0));
    merged = merged.slice(0, limit);
    return {
      items: merged,
      query: { text: query, sort: sort || null, state: stateList.join(","), states: stateList, make: resolvedMake, model: resolvedModel, strict, url: firstResultUrl },
      pagination: { page: 1, pageSize: PAGE_SIZE, limit, capped: merged.length >= limit },
    };
  }

  const singleState = stateList[0] ?? null;
  const resolved = resolveQuery(query, make, model);
  log("SEARCH", `resolveQuery: make="${resolved.make || ""}", model="${resolved.model || ""}", extraTerms=[${resolved.extraTerms.join(", ")}]`);

  const MAX_PAGES = 20;
  let firstUrl = buildUrl({ ...resolved, sort, state: singleState, page: 1, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission });
  log("SEARCH", `first URL: ${firstUrl}`);
  let firstJson = await fetchApi(firstUrl, timeout);

  if (!firstJson || !Array.isArray(firstJson.SearchResults)) {
    throw new Error("Could not extract search results. The API structure may have changed.");
  }

  if (firstJson.SearchResults.length === 0 && resolved.model && resolved.model.includes(" ")) {
    const modelWords = resolved.model.split(/\s+/);
    for (let len = modelWords.length - 1; len >= 1; len--) {
      const shorterModel = modelWords.slice(0, len).join(" ");
      log("SEARCH", `empty results, retrying with shorter model: "${shorterModel}"`);
      const retryUrl = buildUrl({ make: resolved.make, model: shorterModel, sort, state: singleState, page: 1, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission });
      const retryJson = await fetchApi(retryUrl, timeout);
      if (retryJson?.SearchResults?.length > 0) {
        resolved.model = shorterModel;
        resolved.extraTerms = modelWords.slice(len);
        firstUrl = retryUrl;
        firstJson = retryJson;
        log("SEARCH", `retry succeeded with model="${resolved.model}", ${retryJson.SearchResults.length} results`);
        break;
      }
    }
  }

  const seenIds = new Set();
  let items = firstJson.SearchResults.map((r) => parseResult(r)).filter(Boolean);
  for (const item of items) if (item.id) seenIds.add(item.id);
  log("SEARCH", `page 1 parsed: ${firstJson.SearchResults.length} results -> ${items.length} valid items`);

  let currentPage = 1;
  while (items.length < limit && currentPage < MAX_PAGES) {
    if (firstJson.SearchResults.length < PAGE_SIZE && currentPage === 1) break;
    currentPage++;
    if (!noRateLimit) await sleep(RATE_LIMIT_PAGE_DELAY);
    const pageUrl = buildUrl({ ...resolved, sort, state: singleState, page: currentPage, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission });
    const pageJson = await fetchApi(pageUrl, timeout);
    if (!pageJson || !Array.isArray(pageJson.SearchResults) || pageJson.SearchResults.length === 0) break;
    for (const raw of pageJson.SearchResults) {
      const item = parseResult(raw);
      if (!item) continue;
      if (item.id && seenIds.has(item.id)) continue;
      if (item.id) seenIds.add(item.id);
      items.push(item);
    }
    log("SEARCH", `page ${currentPage} fetched: ${pageJson.SearchResults.length} results, items total=${items.length}`);
    if (pageJson.SearchResults.length < PAGE_SIZE) break;
  }

  const capped = items.length >= limit || currentPage >= MAX_PAGES;

  if (resolved.extraTerms.length > 0) {
    const extraTokens = resolved.extraTerms.map((t) => normalize(t));
    items = items.filter((item) => matchesTokens(item, extraTokens));
  }

  if (strict) {
    const tokens = getQueryTokens(query);
    if (tokens.length > 0) items = items.filter((item) => matchesTokens(item, tokens));
  }

  if (sort === "price_asc") items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else if (sort === "price_desc") items.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  else if (sort === "year_desc") items.sort((a, b) => (b.yearModel ?? 0) - (a.yearModel ?? 0));

  items = items.slice(0, limit);

  log("SEARCH", `search() done: ${items.length} items returned, pages=${currentPage}, capped=${capped}`);
  return {
    items,
    query: {
      text: query,
      sort: sort || null,
      state: singleState,
      states: stateList,
      make: resolved.make,
      model: resolved.model,
      strict,
      url: firstUrl,
    },
    pagination: {
      page: 1,
      pageSize: PAGE_SIZE,
      limit,
      capped,
    },
  };
}

/**
 * Fetches and returns the raw API response without normalisation.
 *
 * @param {string} query - The search query string.
 * @param {object} [options={}] - Request options.
 * @param {number} [options.timeout=15000] - HTTP request timeout in ms.
 * @param {'relevance'|'price_asc'|'price_desc'|'year_desc'} [options.sort] - Sort order.
 * @param {string} [options.state] - Brazilian state UF.
 * @param {string} [options.make] - Vehicle make.
 * @param {string} [options.model] - Vehicle model.
 * @returns {Promise<object>} Raw API response.
 */
export async function searchRaw(query, options = {}) {
  const { timeout = DEFAULT_TIMEOUT, sort, state, make, model, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission } = options;
  log("SEARCH", `searchRaw("${query}") called`, { timeout, sort, state, make, model });
  const resolved = resolveQuery(query, make, model);
  const singleState = state ? state.split(",")[0]?.trim().toLowerCase() : null;
  let url = buildUrl({ ...resolved, sort, state: singleState, page: 1, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission });
  let json = await fetchApi(url, timeout);
  if (!json) throw new Error("Could not fetch data from Web Motors.");

  if (json.SearchResults?.length === 0 && resolved.model && resolved.model.includes(" ")) {
    const modelWords = resolved.model.split(/\s+/);
    for (let len = modelWords.length - 1; len >= 1; len--) {
      const shorterModel = modelWords.slice(0, len).join(" ");
      const retryUrl = buildUrl({ make: resolved.make, model: shorterModel, sort, state: singleState, page: 1, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission });
      const retryJson = await fetchApi(retryUrl, timeout);
      if (retryJson?.SearchResults?.length > 0) {
        json = retryJson;
        break;
      }
    }
  }

  return json;
}

/**
 * Returns the known vehicle makes.
 *
 * @returns {{slug: string, name: string}[]}
 */
export function getMakes() {
  return [...KNOWN_MAKES].sort().map((name) => ({ slug: name, name }));
}

/**
 * Returns the known Brazilian states with their UFs.
 *
 * @returns {{slug: string, name: string}[]}
 */
export function getStates() {
  return [...VALID_STATES.entries()].map(([slug, name]) => ({ slug, name }));
}

/**
 * Attempts to parse the free-text query into make and model parameters.
 * If --make/--model are explicitly provided, those take priority.
 *
 * @param {string} query - Raw query text.
 * @param {string|undefined} explicitMake - Make from CLI option.
 * @param {string|undefined} explicitModel - Model from CLI option.
 * @returns {{make: string|null, model: string|null}} Resolved make/model tuple.
 */
function resolveQuery(query, explicitMake, explicitModel) {
  if (explicitMake) {
    return { make: explicitMake.toUpperCase(), model: explicitModel || null, extraTerms: [] };
  }

  const normalised = query.trim().toUpperCase();
  const queryWords = normalised.split(/\s+/);

  let bestMake = null;
  let bestMakeLen = 0;

  for (const known of KNOWN_MAKES) {
    const makeWords = known.split(/\s+/);
    if (makeWords.length > queryWords.length) continue;

    const prefix = queryWords.slice(0, makeWords.length).join(" ");
    if (prefix === known && known.length > bestMakeLen) {
      bestMake = known;
      bestMakeLen = known.length;
    }
  }

  if (bestMake) {
    const makeWordCount = bestMake.split(/\s+/).length;
    const remainder = queryWords.slice(makeWordCount).join(" ").trim();
    return { make: bestMake, model: remainder || null, extraTerms: [] };
  }

  for (const known of KNOWN_MAKES) {
    if (normalised === known) return { make: known, model: null, extraTerms: [] };
  }

  return { make: null, model: normalised || null, extraTerms: [] };
}

/**
 * Builds the API URL with all applicable filters.
 *
 * @param {object} params - URL parameters.
 * @param {string|null} params.make - Vehicle make.
 * @param {string|null} params.model - Vehicle model.
 * @param {'relevance'|'price_asc'|'price_desc'|'year_desc'|undefined} params.sort - Sort key.
 * @param {string|null} params.state - State UF (lowercase).
 * @param {number} [params.page=1] - API page number.
 * @param {number} [params.minPrice] - Minimum price.
 * @param {number} [params.maxPrice] - Maximum price.
 * @param {number} [params.minYear] - Minimum year.
 * @param {number} [params.maxYear] - Maximum year.
 * @param {number} [params.minKm] - Minimum mileage.
 * @param {number} [params.maxKm] - Maximum mileage.
 * @param {string} [params.transmission] - Transmission label.
 * @returns {string} Fully qualified API URL.
 */
function buildUrl({ make, model, sort, state, page = 1, minPrice, maxPrice, minYear, maxYear, minKm, maxKm, transmission }) {
  const params = new URLSearchParams();
  params.set("actualPage", String(page));
  params.set("displayPerPage", String(PAGE_SIZE));

  if (make) params.set("marca1", make);
  if (model) params.set("modelo1", model);
  if (sort && SORT_MAP[sort]) params.set("Order", SORT_MAP[sort]);

  if (state) {
    params.set("state", state.toUpperCase());
  }

  if (minPrice != null) params.set("PrecoDe", String(minPrice));
  if (maxPrice != null) params.set("PrecoAte", String(maxPrice));
  if (minYear != null) params.set("anoDe", String(minYear));
  if (maxYear != null) params.set("anoAte", String(maxYear));
  if (minKm != null) params.set("kmDe", String(minKm));
  if (maxKm != null) params.set("kmAte", String(maxKm));
  if (transmission) params.set("Cambio", transmission);

  return `${API_BASE}?${params.toString()}`;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const BROWSER_HEADERS_ENTRIES = Object.entries(BROWSER_HEADERS);

/**
 * Fetches a URL using Node's native fetch with browser-like headers.
 *
 * @param {string} url - Target URL.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<string>} Response body.
 */
async function fetchWithFetch(url, timeout) {
  log("HTTP", `fetch -> ${url} (timeout: ${timeout}ms)`);
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  log("HTTP", `fetch <- ${res.status} ${res.statusText} (content-type: ${res.headers.get("content-type")})`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = await res.text();
  log("HTTP", `fetch body: ${body.length} bytes`);
  return body;
}

/**
 * Fetches a URL using curl as a fallback transport.
 *
 * @param {string} url - Target URL.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<string>} Response body.
 */
async function fetchWithCurl(url, timeout) {
  log("CURL", `curl -> ${url}`);
  const timeoutSec = Math.max(1, Math.ceil(timeout / 1000));
  const args = ["-sS", "-L", "--max-time", String(timeoutSec), "--compressed", "-w", "\n%{http_code}"];
  for (const [key, value] of BROWSER_HEADERS_ENTRIES) {
    args.push("-H", `${key}: ${value}`);
  }
  args.push(url);

  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
  const lastNewline = stdout.lastIndexOf("\n");
  const statusCode = parseInt(stdout.slice(lastNewline + 1).trim(), 10);
  const body = stdout.slice(0, lastNewline);
  if (statusCode >= 400) throw new Error(`HTTP ${statusCode}`);
  return body;
}

/**
 * Fetches a page body, preferring native fetch and falling back to curl.
 *
 * @param {string} url - Target URL.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<string>} Response body.
 */
async function fetchPage(url, timeout) {
  try {
    return await fetchWithFetch(url, timeout);
  } catch {
    return fetchWithCurl(url, timeout);
  }
}

/**
 * Fetches the API URL and parses the JSON response.
 */
async function fetchApi(url, timeout) {
  const body = await fetchPage(url, timeout);
  try {
    const json = JSON.parse(body);
    log("HTTP", `fetchApi parsed OK (${body.length} bytes)`);
    return json;
  } catch {
    throw new Error("Failed to parse API response as JSON.");
  }
}

/**
 * Normalizes text for fuzzy token matching.
 *
 * @param {string} str - Input text.
 * @returns {string} Normalized text.
 */
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "ou", "em", "com", "para", "por", "um", "uma", "o", "a", "os", "as", "no", "na", "nos", "nas", "the", "and", "or", "for", "in", "of", "to", "with"]);

/**
 * Extracts significant query tokens for strict matching.
 *
 * @param {string} query - Raw query text.
 * @returns {string[]} Significant tokens.
 */
function getQueryTokens(query) {
  return normalize(query)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Checks whether an item matches every query token.
 *
 * @param {object} item - Normalized item.
 * @param {string[]} tokens - Significant query tokens.
 * @returns {boolean} True when all tokens are found in the item corpus.
 */
function matchesTokens(item, tokens) {
  if (tokens.length === 0) return true;

  let corpus = normalize(item.title || "");
  if (item.description) corpus += " " + normalize(item.description);
  if (item.make) corpus += " " + normalize(item.make);
  if (item.model) corpus += " " + normalize(item.model);
  if (item.version) corpus += " " + normalize(item.version);
  if (item.attributes) {
    for (const attr of item.attributes) {
      corpus += " " + normalize(attr);
    }
  }

  return tokens.every((token) => corpus.includes(token));
}

/**
 * Convenience wrapper for strict query matching against an item.
 *
 * @param {object} item - Normalized item.
 * @param {string} query - Raw query text.
 * @returns {boolean} Match result.
 */
function matchesQuery(item, query) {
  return matchesTokens(item, getQueryTokens(query));
}

/**
 * Builds a permalink URL for a Web Motors listing.
 *
 * @param {object} item - Raw vehicle record from API.
 * @returns {string} Vehicle permalink URL.
 */
function buildPermalink(item) {
  const makeSlug = (item.Specification?.Make?.Value || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const modelSlug = (item.Specification?.Model?.Value || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const versionSlug = (item.Specification?.Version?.Value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const doors = item.Specification?.NumberPorts || 0;
  const year = item.Specification?.YearModel || 0;
  const id = item.UniqueId || 0;

  return `https://${WM_DOMAIN}/comprar/${makeSlug}/${modelSlug}/${versionSlug}/${doors}-portas/${year}/${id}/`;
}

/**
 * Normalises a single raw API result into a structured item.
 *
 * @param {object} raw - Raw vehicle result from API.
 * @returns {object|null} Normalized item or null when invalid.
 */
function parseResult(raw) {
  if (!raw) return null;

  const spec = raw.Specification || {};
  const seller = raw.Seller || {};
  const prices = raw.Prices || {};
  const media = raw.Media || {};

  const title = spec.Title || "";
  if (!title) return null;

  const make = spec.Make?.Value || null;
  const model = spec.Model?.Value || null;
  const version = spec.Version?.Value || null;
  const yearFabrication = spec.YearFabrication || null;
  const yearModel = spec.YearModel || null;
  const odometer = spec.Odometer || null;
  const transmission = spec.Transmission || null;
  const doors = spec.NumberPorts || null;
  const bodyType = spec.BodyType || null;
  const armored = spec.Armored === "S" || spec.Armored === true;
  const color = spec.Color?.Primary || null;

  const attributes = spec.VehicleAttributes?.map((a) => a.Name).filter(Boolean) || [];

  const price = prices.Price || null;

  const photos =
    media.Photos?.sort((a, b) => (a.Order || 0) - (b.Order || 0)).map((p) => ({
      url: `${PHOTO_BASE}${p.PhotoPath.replace(/\\/g, "/")}`,
    })) || [];
  const thumbnail = photos[0]?.url || (raw.PhotoPath ? `${PHOTO_BASE}${raw.PhotoPath.replace(/\\/g, "/")}` : null);

  const sellerCity = seller.City || null;
  const sellerState = seller.State || null;
  const sellerType = seller.AdType?.Value || seller.SellerType || null;
  const sellerName = seller.FantasyName || null;
  const neighborhood = seller.Localization?.[0]?.Neighborhood || null;

  const location = [sellerCity, sellerState].filter(Boolean).join(", ");

  const description = raw.LongComment?.trim() || null;
  const fipePercent = raw.FipePercent || null;
  const listingType = raw.ListingType === "N" ? "Novo" : raw.ListingType === "U" ? "Usado" : raw.ListingType || null;

  const permalink = buildPermalink(raw);

  return {
    id: raw.UniqueId || null,
    title: `${make || ""} ${model || ""} ${version || ""}`.trim() || title,
    price,
    currency: "BRL",
    make,
    model,
    version,
    yearFabrication,
    yearModel,
    odometer,
    transmission,
    doors,
    bodyType,
    armored,
    color,
    fipePercent,
    listingType,
    location,
    neighborhood,
    sellerType,
    sellerName,
    thumbnail,
    images: photos.length > 0 ? photos : null,
    imageCount: photos.length,
    permalink,
    description,
    attributes: attributes.length > 0 ? attributes : null,
  };
}
