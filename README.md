# wm-search-cli

Command line and library tool to extract structured vehicle search results from Web Motors Brazil.

## Highlights

- Node.js CLI command: `wm-search`
- Programmatic API: `search`, `searchRaw`, `getMakes`, `getStates`
- Auto query parsing into make/model when possible
- Vehicle-centric filters: price, year, mileage, transmission, state, make/model
- Output formats: `json`, `table`, `jsonl`, `csv`

## Requirements

- Node.js `>=18`
- Network access to Web Motors API endpoints

## Installation

This package is intended for local use and is not published to npm.

### Link CLI globally from local source

```bash
npm install
npm link
```

Run:

```bash
wm-search --help
```

### Link package into another local project

```bash
npm link wm-search-cli
```

### Unlink when needed

```bash
npm unlink -g wm-search-cli
```

## Quick Start

```bash
wm-search "honda civic"
wm-search "toyota corolla" -l 5 -f table
wm-search "bmw" --state sp --sort year_desc
wm-search "fiat" --min-price 30000 --max-price 80000
wm-search --list-makes
wm-search --list-states
```

## CLI Usage

```text
wm-search <query> [options]
```

`query` is required unless `--make` is provided.

### Arguments

| Argument | Required | Description |
|---|---|---|
| `query` | Usually yes | Free-text search, ex: `Honda Civic`. Auto-parsed into make/model when possible. |

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `-l, --limit <n>` | integer | `20` | Maximum number of results. |
| `--sort <order>` | string | `relevance` | Sort: `relevance`, `price_asc`, `price_desc`, `year_desc`. |
| `--state <uf[,uf...]>` | string | none | One or more UFs, ex: `sp` or `rj,mg`. |
| `--make <make>` | string | inferred | Vehicle make, ex: `HONDA`. |
| `--model <model>` | string | inferred | Vehicle model, ex: `Civic`. |
| `--min-price <n>` | integer | none | Minimum price. |
| `--max-price <n>` | integer | none | Maximum price. |
| `--min-year <n>` | integer | none | Minimum model/fabrication year filter. |
| `--max-year <n>` | integer | none | Maximum model/fabrication year filter. |
| `--min-km <n>` | integer | none | Minimum mileage. |
| `--max-km <n>` | integer | none | Maximum mileage. |
| `--transmission <type>` | string | none | Transmission label, ex: `Manual`, `Automatica`. |
| `--list-makes` | flag | `false` | Print all known makes and exit. |
| `--list-states` | flag | `false` | Print all supported UFs and exit. |
| `--timeout <ms>` | integer | `15000` | HTTP timeout per request. |
| `--concurrency <n>` | integer | `5` | Parallel request count. |
| `--strict` | flag | `false` | Keep only items matching all query tokens. |
| `--no-rate-limit` | flag | `false` | Disable built-in rate limiting (may get your IP blocked). |
| `-f, --format <type>` | string | `json` | `json`, `table`, `jsonl`, `csv`. |
| `--pretty` | flag | `false` | Pretty print JSON. |
| `--raw` | flag | `false` | Return raw API payload and exit. |
| `--fields <list>` | csv string | none | Keep only selected fields. |
| `-w, --web` | flag | `false` | Render browser HTML and open it. |
| `--log` | flag | `false` | Write a timestamped `.log` file to the project root with HTTP, search, and query-resolution traces. |
| `-h, --help` | flag | `false` | Show help. |
| `-v, --version` | flag | `false` | Show package version. |

## Rate Limiting

Built-in rate limiting is **enabled by default** to prevent your IP from being blocked by Web Motors.

- **Page delay:** 200 ms between pagination requests
- **Max concurrency:** 3 parallel requests (overrides `--concurrency` when lower)

To disable rate limiting (at your own risk):

```bash
wm-search "honda civic" --no-rate-limit
```

## Logging

Pass `--log` to write a timestamped log file (`wm-search_YYYY-MM-DD_HH-MM-SS.log`) to the project root.
The file records every HTTP request/response (URL, status code, content-type, body size), the resolved make/model/extraTerms from query parsing, the constructed search URL, any model-truncation retries, per-page result counts, and the final summary.
No file is created when `--log` is omitted.

```bash
wm-search "honda civic" --log
```

## Output Formats

- `json`: full response object (`items`, `query`, `pagination`)
- `table`: terminal vehicle cards with key specs
- `jsonl`: one JSON item per line
- `csv`: comma-separated tabular output

## Common Examples

```bash
# Basic search
wm-search "honda civic"

# Explicit make/model filters
wm-search "" --make HONDA --model Civic --state sp -f table

# Price and mileage window
wm-search "toyota corolla" --min-price 60000 --max-price 130000 --max-km 80000

# Newest model years first
wm-search "jeep renegade" --sort year_desc --state sp,rj

# Strict filtering for all query tokens
wm-search "bmw 320i m sport" --strict -l 20 -f table

# Export selected fields
wm-search "hyundai hb20" --fields title,price,yearModel,odometer,permalink --format csv > wm-results.csv

# Raw API response
wm-search "audi a3" --raw > raw-webmotors.json
```

## Library Usage

```js
import { search, searchRaw, getMakes, getStates } from "wm-search-cli";

const result = await search("Honda Civic", {
  limit: 20,
  sort: "price_asc",
  state: "sp,rj",
  minPrice: 50000,
  maxPrice: 150000,
  minYear: 2018,
  maxKm: 100000,
  transmission: "Manual",
  timeout: 15000,
  strict: false,
});

console.log(result.items[0]);

const raw = await searchRaw("Honda Civic", {
  state: "sp",
  sort: "year_desc",
});

console.log(raw.SearchResults?.length);
console.log(getMakes().slice(0, 5));
console.log(getStates().slice(0, 5));
```

### API Reference

#### `search(query, options?)`

Returns:

- `items: object[]`
- `query: { text, sort, state, states, make, model, strict, url }`
- `pagination: { page, pageSize, limit, capped }`

Main options:

- `limit?: number`
- `timeout?: number`
- `sort?: "relevance" | "price_asc" | "price_desc" | "year_desc"`
- `concurrency?: number`
- `state?: string` (single or comma-separated UFs)
- `make?: string`
- `model?: string`
- `minPrice?: number`
- `maxPrice?: number`
- `minYear?: number`
- `maxYear?: number`
- `minKm?: number`
- `maxKm?: number`
- `transmission?: string`
- `strict?: boolean`
- `noRateLimit?: boolean`

#### `searchRaw(query, options?)`

Returns raw JSON response from Web Motors API endpoint.

#### `getMakes()`

Returns array of `{ slug, name }` from known makes list.

#### `getStates()`

Returns array of `{ slug, name }` for supported Brazilian states.

## Item Schema (normalized)

Each item can include:

- `id`
- `title`
- `price`
- `currency`
- `make`
- `model`
- `version`
- `yearFabrication`
- `yearModel`
- `odometer`
- `transmission`
- `doors`
- `bodyType`
- `armored`
- `color`
- `fipePercent`
- `listingType`
- `location`
- `neighborhood`
- `sellerType`
- `sellerName`
- `thumbnail`
- `images`
- `imageCount`
- `permalink`
- `description`
- `attributes`

## Query Parsing Behavior

If `--make` is not supplied, the library tries to parse known make names from the beginning of `query`.

Examples:

- `"Honda Civic"` -> make `HONDA`, model `CIVIC`
- `"LAND ROVER DEFENDER"` -> make `LAND ROVER`, model `DEFENDER`
- unknown brand text -> make/model remain `null` and generic search is used

## Validation and Errors

The CLI validates:

- positive integer `--limit`, `--timeout`, `--concurrency`
- valid output format values
- valid Brazilian UF values in `--state`

Potential runtime failures:

- upstream API/response structure changes
- network/timeout errors
- reduced result count due pagination cap or strict filtering

## Performance Notes

- Default page size is fixed by source API (`24` items per page).
- Multi-state mode runs one search per UF, then interleaves and deduplicates items.
- Sorting and strict filtering are applied to merged data before final slicing.

## Development

```bash
npm install
npm run format
```

## License

MIT
