# MovieBox Scraper API — Complete Documentation

**Developer:** kaif
**Last Updated:** April 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Environment Variables & Secrets](#2-environment-variables--secrets)
3. [Cloudflare Worker Proxy](#3-cloudflare-worker-proxy)
4. [Two API Layers: BFF vs H5](#4-two-api-layers-bff-vs-h5)
5. [Request Signing (HMAC-MD5)](#5-request-signing-hmac-md5)
6. [Authentication Flow](#6-authentication-flow)
7. [Region Block Detection & Bypass](#7-region-block-detection--bypass)
8. [Proxy Fallback Chain (Proxifly)](#8-proxy-fallback-chain-proxifly)
9. [API Endpoints Reference](#9-api-endpoints-reference)
10. [BFF Scraper Functions](#10-bff-scraper-functions)
11. [H5 Scraper Functions](#11-h5-scraper-functions)
12. [Stream Resolution Pipeline](#12-stream-resolution-pipeline)
13. [Title Matching & Disambiguation](#13-title-matching--disambiguation)
14. [Language / Dub Discovery](#14-language--dub-discovery)
15. [Season/Episode Remapping](#15-seasonepisode-remapping)
16. [Subtitle Extraction](#16-subtitle-extraction)
17. [IMDB Cross-Verification](#17-imdb-cross-verification)
18. [Stream Proxy & CORS Handling](#18-stream-proxy--cors-handling)
19. [Caching Strategy](#19-caching-strategy)
20. [Data Structures & Types](#20-data-structures--types)
21. [Complete Request Flow Diagrams](#21-complete-request-flow-diagrams)
22. [Error Handling & Health Checks](#22-error-handling--health-checks)
23. [Quick Start Examples](#23-quick-start-examples)
24. [Production Deployment & Cloudflare Proxy](#24-production-deployment--cloudflare-proxy)
25. [Firebase Auth Setup for Published Domain](#25-firebase-auth-setup-for-published-domain)
26. [USE_CF_PROXY — Hosting Guide](#26-use_cf_proxy--hosting-guide)

---

## 1. Architecture Overview

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────────────────┐
│  Frontend    │────▶│  API Server      │────▶│  Cloudflare Worker Proxy    │
│  (React)     │     │  (Express/Node)  │     │  moviebox-proxy.popcorntv-  │
│              │     │  Port 8080       │     │  proxy.workers.dev          │
└──────────────┘     └──────────────────┘     └─────────────┬───────────────┘
                                                            │
                                              ┌─────────────┼───────────────┐
                                              ▼             ▼               ▼
                                        ┌──────────┐ ┌──────────┐ ┌────────────┐
                                        │ BFF API  │ │ H5 API   │ │ Stream CDN │
                                        │ api3.    │ │ h5-api.  │ │ *.hakuna   │
                                        │ aoneroom │ │ aoneroom │ │ ymatata    │
                                        │ .com     │ │ .com     │ │ .com       │
                                        └──────────┘ └──────────┘ └────────────┘
```

The system has three layers:
- **Frontend** — React app at `artifacts/moviebox-test`
- **API Server** — Express backend at `artifacts/api-server` (port 8080)
- **CF Worker Proxy** — Cloudflare Worker that forwards requests to MovieBox APIs to bypass CORS and region restrictions

Source files:
| File | Purpose |
|------|---------|
| `src/routes/moviebox.ts` | H5 API route handlers (home, search, detail, play, stream proxy) |
| `src/routes/stream.ts` | Main stream resolution routes (mb-stream, mb-detail, mb-seasons, mb-search, etc.) |
| `src/scrapers/moviebox-bff.ts` | BFF API client (signing, auth, all BFF functions) |
| `src/scrapers/moviebox.ts` | Stream resolution engine (search, match, play, language probing) |
| `src/scrapers/imdb-lookup.ts` | IMDB/OMDB cross-verification |

---

## 2. Environment Variables & Secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `USE_CF_PROXY` | No | Set to `true` to route all BFF/H5 requests through CF Worker. When `false` or unset, the server probes direct API access at startup and uses direct calls if the server IP is accepted (best for India hosting). Default: not set (direct mode). |
| `CF_MOVIEBOX_PROXY_URL` | Only if `USE_CF_PROXY=true` | Cloudflare Worker URL. Default: `https://moviebox-proxy.popcorntv-proxy.workers.dev` |
| `CF_MOVIEBOX_API_KEY` | Only if `USE_CF_PROXY=true` | API key sent as `X-Api-Key` header to CF Worker for authentication |
| `MOVIEBOX_BFF_SECRET` | Yes | Base64-encoded HMAC secret key for BFF request signing |
| `MOVIEBOX_EMAIL` | Yes | MovieBox account email for BFF authenticated login |
| `MOVIEBOX_PASSWORD` | Yes | MovieBox account password (MD5-hashed before sending) |
| `BFF_PROXY_URL` | Optional | HTTP proxy URL for BFF direct requests (e.g. `http://proxy-ip:port`). Used when CF Worker gets region-blocked. Set to a proxy in India/Philippines/Nigeria for best results. |
| `VITE_TMDB_API` | Optional | TMDB API key for IMDB ID lookup (cross-verification) |
| `OMDB_API_KEY` | Optional | OMDB API key for IMDB metadata. Default: `"trilogy"` |

### How each secret is used:

**`CF_MOVIEBOX_PROXY_URL`** — Base URL for all proxied requests:
- BFF calls: `{CF_PROXY}/bff/wefeed-mobile-bff/...`
- H5 calls: `{CF_PROXY}/h5/wefeed-h5api-bff/...`
- Stream proxy: `{CF_PROXY}/stream?url=...`
- Search shortcut: `{CF_PROXY}/search?q=...`
- Detail shortcut: `{CF_PROXY}/detail?detailPath=...`

**`CF_MOVIEBOX_API_KEY`** — Sent as `X-Api-Key` header on `/bff/*` and `/h5/*` requests to the CF Worker. The Worker validates this key before forwarding to upstream MovieBox APIs (only enforced when `env.API_KEY` is configured on the Worker). Added by `bffFetchViaCfWorker()` in `moviebox-bff.ts` and included in `bff-sign` response headers in `stream.ts`.

**`MOVIEBOX_BFF_SECRET`** — Used to compute HMAC-MD5 signatures for BFF API requests. Stored as base64, decoded to raw bytes:
```typescript
const SECRET_BYTES = Buffer.from(SECRET_KEY, "base64");
```

**`MOVIEBOX_EMAIL` / `MOVIEBOX_PASSWORD`** — Used for BFF email login. Password is MD5-hashed before sending:
```typescript
password: md5hex(MB_PASSWORD)  // MD5 hex digest of raw password
```

### Keys & Secret Values

All keys, secrets, and hardcoded values used across the system:

| Key | Value | Where Set |
|-----|-------|-----------|
| `MOVIEBOX_BFF_SECRET` | `76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O` | Shared env var |
| `MOVIEBOX_EMAIL` | `botnestai@gmail.com` (hardcoded fallback) | Replit Secrets / hardcoded |
| `MOVIEBOX_PASSWORD` | `Kaifssdd` (hardcoded fallback) | Replit Secrets / hardcoded |
| `CF_MOVIEBOX_PROXY_URL` | `https://moviebox-proxy.popcorntv-proxy.workers.dev` | Hardcoded default |
| `CF_MOVIEBOX_API_KEY` | *(not currently set — empty string fallback)* | Not set |
| `CLOUDFLARE_API_TOKEN` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_TMDB_API` | *(stored as Replit secret)* | Replit Secrets |
| `OMDB_API_KEY` | `trilogy` | Hardcoded default |
| `BFF_PROXY_URL` | *(not set — optional)* | Not set |
| `VITE_FIREBASE_API_KEY` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_FIREBASE_APP_ID` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_FIREBASE_AUTH_DOMAIN` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_FIREBASE_PROJECT_ID` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_FIREBASE_STORAGE_BUCKET` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_FIREBASE_MEASUREMENT_ID` | *(stored as Replit secret)* | Replit Secrets |
| `SESSION_SECRET` | *(stored as Replit secret)* | Replit Secrets |
| `VITE_BASE_URL` | `https://api.themoviedb.org/3` | Shared env var |

### Hardcoded API Endpoints

| Endpoint | URL | Used For |
|----------|-----|----------|
| BFF API (direct) | `https://api3.aoneroom.com` | BFF mobile API (region-blocked in US/EU) |
| H5 API (direct) | `https://h5-api.aoneroom.com` | H5 web API (guest access) |
| CF Worker Proxy | `https://moviebox-proxy.popcorntv-proxy.workers.dev` | Proxies BFF/H5/stream requests |
| H5 Home | `https://h5-api.aoneroom.com/wefeed-h5api-bff/home?host=moviebox.ph` | Direct H5 home fallback |
| Proxifly CDN | `https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.json` | Free proxy pool for BFF fallback |
| TMDB API | `https://api.themoviedb.org/3` | IMDB ID cross-verification |
| OMDB API | `https://www.omdbapi.com` | IMDB metadata lookup |

### Hardcoded Crypto Constants

| Constant | Value | Used For |
|----------|-------|----------|
| HMAC Algorithm | `md5` | BFF request signing (`HMAC-MD5`) |
| Signature Version | `2` | Signature format: `{timestamp}\|2\|{base64}` |
| Secret Encoding | `base64` | `MOVIEBOX_BFF_SECRET` is base64-decoded to raw bytes |
| Password Hash | `MD5 hex` | `MOVIEBOX_PASSWORD` is MD5-hashed before login |
| Client Token | `{timestamp},{md5(reversed_timestamp)}` | `X-Client-Token` header value |
| User-Agent (BFF) | `okhttp/4.9.3` | Android app User-Agent for BFF requests |
| User-Agent (H5) | `Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0` | Browser User-Agent for H5 requests |

### Whitelisted Stream Domains

Domains allowed through the stream proxy:
```
hakunaymatata.com, aoneroom.com, moviebox.ph, moviebox.pk
```

---

## 3. Cloudflare Worker Proxy

The CF Worker at `moviebox-proxy.popcorntv-proxy.workers.dev` has these routes:

| Route | Upstream Target | Description |
|---|---|---|
| `/bff/*` | `https://api3.aoneroom.com/*` | BFF mobile API (requires signing). Injects India headers (`X-Client-Info: Asia/Kolkata`, `Accept-Language: en-IN`). |
| `/h5/*` | `https://h5-api.aoneroom.com/*` | H5 web API (guest access) |
| `/stream?url=` | Direct URL fetch | Stream file proxy (MP4/HLS). Uses `cf.cacheEverything` with 1h TTL. |
| `/search?q=&page=&perPage=` | H5 search (convenience) | Quick search endpoint |
| `/search-suggest?q=` | H5 suggest (convenience) | Search autocomplete |
| `/detail?detailPath=` | H5 detail (convenience) | Quick detail endpoint |
| `/home?page=` | H5 home (convenience) | Home feed with pagination support |
| `/play?subjectId=&resolution=&se=&ep=` | H5 play (convenience) | Get stream URLs |
| `/health` | — | Health check (returns `{ status: "ok", service: "moviebox-proxy" }`) |
| `/diag` | BFF test probe | Diagnostics — tests BFF reachability, returns latency + colo |

The CF Worker:
1. Validates `X-Api-Key` header **only on `/bff/*` and `/h5/*` routes** (convenience routes are public)
2. Forwards all other headers (including `x-tr-signature`, `Authorization`) to upstream
3. For BFF proxy: injects India region headers (`X-Client-Info: {"timezone":"Asia/Kolkata"}`, `Accept-Language: en-IN,en;q=0.9,hi;q=0.8`)
4. For `/stream`, fetches the URL directly and pipes the response back with CF edge caching
5. Adds CORS headers to all responses
6. Non-GET requests (except `/bff/*` and `/h5/*`) return 405

### Worker Code

The full CF Worker source is at `cf-moviebox-proxy/worker.js`. Key implementation details:

- **India headers on BFF**: The `proxyPassthrough()` function adds `X-Client-Info: {"timezone":"Asia/Kolkata"}` and `Accept-Language: en-IN` when the target host is `api3.aoneroom.com`. This makes BFF requests appear to come from India, bypassing US region blocks.
- **Stream caching**: Stream proxy uses `cf: { cacheEverything: true, cacheTtl: 3600 }` for CF edge caching + `Cache-Control: public, max-age=3600` response header.
- **`/home` pagination**: The `/home` convenience route forwards the `page` query parameter to the upstream H5 API.
- **`/diag` endpoint**: Makes a test BFF request (unauthenticated) to check if BFF is reachable from the CF Worker's colo. Returns `{ bffReachable, upstreamStatus, bffCode, latency, colo }`.

---

## 4. Two API Layers: BFF vs H5

MovieBox has two separate API backends:

### BFF (Backend-For-Frontend) — Mobile App API
- **Base URL:** `https://api3.aoneroom.com`
- **Path prefix:** `/wefeed-mobile-bff/`
- **User-Agent:** `okhttp/4.9.3` (Android app)
- **Auth:** Requires HMAC-MD5 request signing + Bearer JWT token
- **Features:** Full access — search, detail, season info, play-info, resource links, subtitles
- **Limitation:** Region-blocked in many deployment regions (returns 403)

### H5 — Web/HTML5 API
- **Base URL:** `https://h5-api.aoneroom.com`
- **Path prefix:** `/wefeed-h5api-bff/`
- **User-Agent:** Standard browser UA
- **Auth:** Guest token obtained from `x-user` response header
- **Features:** Search, detail, play (limited resolution), home page
- **Advantage:** Works in most regions, more lenient

### Key differences:

| Feature | BFF | H5 |
|---------|-----|-----|
| Request signing | Yes (HMAC-MD5) | No |
| Authentication | Email login JWT | Guest token from headers |
| Region restrictions | Strict (403 in many regions) | Lenient |
| Resource endpoint | Yes (community uploads) | No |
| Play-info endpoint | Yes (all resolutions) | Yes (limited) |
| Season info | Yes | Yes |
| Subtitle search | Yes | Yes (via fallback) |
| Dubs/language info | Yes (in detail response) | Partial |

---

## 5. Request Signing (HMAC-MD5)

Every BFF API request must include an `x-tr-signature` header computed as follows:

### Step-by-step signing process:

```
1. Get current timestamp (milliseconds): timestamp = Date.now()

2. Compute MD5 of request body (empty string if no body):
   bodyMd5 = MD5(body).hex()  // or "" if no body

3. Sort query parameters alphabetically by key:
   sortedQuery = sortParams(queryString)
   // "subjectId=123&se=1" → sorted by key names

4. Build path with sorted query:
   pathWithQuery = sorted ? path + "?" + sorted : path

5. Build string-to-sign (7 lines, joined by "\n"):
   stringToSign = [
     METHOD,           // "GET" or "POST"
     "application/json",  // Accept header
     contentType,      // "application/json" if body, else ""
     contentLength,    // byte length of body, or ""
     timestamp,        // milliseconds string
     bodyMd5,          // MD5 hex of body, or ""
     pathWithQuery     // e.g. "/wefeed-mobile-bff/subject-api/get?subjectId=123"
   ].join("\n")

6. Compute HMAC-MD5:
   hmac = HMAC-MD5(SECRET_BYTES, stringToSign)

7. Final signature format:
   signature = timestamp + "|2|" + hmac.base64()
   // e.g. "1712345678901|2|abc123def456..."
```

### X-Client-Token generation:

```typescript
function makeClientToken(): string {
  const ts = String(Date.now());              // "1712345678901"
  const reversed = ts.split("").reverse().join(""); // "1098765432171"
  return ts + "," + MD5(reversed).hex();      // "1712345678901,a1b2c3d4..."
}
```

### Required headers for BFF requests:

```
x-tr-signature: {timestamp}|2|{hmac_base64}
X-Client-Token: {timestamp},{md5_of_reversed_timestamp}
Accept: application/json
User-Agent: okhttp/4.9.3
Authorization: Bearer {jwt_token}    // if authenticated
Content-Type: application/json       // if POST with body
Content-Length: {byte_length}         // if POST with body
X-Api-Key: {cf_api_key}              // for CF Worker auth
```

---

## 6. Authentication Flow

### BFF Email Login

```
POST /wefeed-mobile-bff/user-api/login
Body: {
  "authType": 1,
  "mail": "{MOVIEBOX_EMAIL}",
  "password": "{MD5_HEX_OF_PASSWORD}"
}
```

**Process:**
1. MD5-hash the raw password: `md5hex(MOVIEBOX_PASSWORD)`
2. Sign the request with HMAC-MD5 (same as all BFF requests)
3. Send via CF Worker: `{CF_WORKER_URL}/bff/wefeed-mobile-bff/user-api/login`
4. Response contains JWT token at `result.data.token`
5. Parse JWT payload to get `exp` (expiry), `uid` (user ID), `utp` (user type)
6. Cache token until near expiry (refresh when < 5 minutes before expiry)

**Token caching:**
```typescript
cachedBffAuth = {
  token: jwt,                    // Bearer token for Authorization header
  expiresAt: payload.exp * 1000, // Unix ms
  userId: result.data.userId     // User ID string
};
```

**Login deduplication:** Only one login request runs at a time via `bffLoginInProgress` promise.

### Phone Login (Alternative)

Phone login uses `cc` (country code) + `phone` + `password` (MD5 hashed) without `authType`:

```json
{ "cc": "91", "phone": "9876543210", "password": "md5hash..." }
```

Endpoint: `POST /wefeed-mobile-bff/user-api/login` (same as email login).

### Registration

Registration requires `authType: 1` + `mail` + `password` + `code` (verification code). The verification code endpoint has not been discovered yet, so new account registration via the API is not currently possible. Use the MovieBox app to register.

### H5 Guest Token

```
GET https://h5-api.aoneroom.com/wefeed-h5api-bff/home?host=moviebox.ph
Headers:
  X-Client-Token: {clientToken}
  X-Client-Info: {"timezone":"Asia/Kolkata"}
  X-Request-Lang: en
```

**Process:**
1. Make a home page request to H5 API directly (not through CF Worker)
2. Extract `x-user` response header (JSON string)
3. Parse to get `token` field (JWT)
4. Decode JWT payload to get expiry
5. Cache until near expiry

**Token precedence in `getBffAuthToken()`:**
1. Try BFF email login first → if token returned, use it
2. If login fails (no credentials, region blocked, etc.) → fall back to H5 guest token

---

## 7. Region Block Detection & Bypass

When MovieBox BFF API returns 403 with message "Service not available in current region" or reason "FORBIDDEN":

### Detection points:
1. **`bffEmailLogin()`** — checks `result.code === 403` or message contains "not available in current region"
2. **`bffRequestWithRetry()`** — checks error string for 403 + region message
3. **`bffRequestWithAuth()`** — checks response status 403 + body content

### Bypass mechanism:
```typescript
let bffRegionBlocked = false;
let bffRegionBlockedAt = 0;
const REGION_BLOCK_TTL = 10 * 60 * 1000; // 10 minutes

function markBffRegionBlocked() {
  bffRegionBlocked = true;
  bffRegionBlockedAt = Date.now();
}

function isBffRegionBlocked(): boolean {
  if (!bffRegionBlocked) return false;
  if (Date.now() - bffRegionBlockedAt > REGION_BLOCK_TTL) {
    bffRegionBlocked = false; // Reset after 10 min, retry
    return false;
  }
  return true;
}
```

When `isBffRegionBlocked()` returns true:
- `bffRequestWithRetry()` throws immediately without making network call
- `bffRequestWithAuth()` throws immediately
- `bffEmailLogin()` returns null immediately
- All callers fall back to H5 API

---

## 8. Proxy Fallback Chain (Proxifly)

When BFF requests fail with 403 (but not a region-block message), the system tries a multi-level fallback:

### Retry chain in `bffRequestWithRetry()`:
```
1. Try BFF via CF Worker (attempt 1)
   └── 403? Wait 2s...
2. Try BFF via CF Worker (attempt 2)
   └── 403? Wait 2s...
3. Try BFF via CF Worker (attempt 3)
   └── 403? Try proxy fallbacks...
4. If BFF_PROXY_URL is set → try custom proxy first
5. If a known-good proxy exists (cached for 15 min) → try it
6. Fetch Proxifly free proxy list (preferred countries first):
   - Preferred: IN, PH, NG, KE, ZA, BR, ID, PK, BD, TH, VN, EG, etc.
   - Pick 5 random proxies (preferred countries sorted first)
7. Try each proxy → direct BFF API (api3.aoneroom.com)
   └── Success? Mark proxy as "known-good" (cached 15 min)
   └── All failed? markBffRegionBlocked() and throw
```

Same proxy fallback also applies to `bffRequestWithAuth()` and `bffEmailLogin()`.

### Proxy priority:
1. `BFF_PROXY_URL` custom proxy (most reliable, user-configured)
2. Known-good proxy (cached from previous success, 15-min TTL)
3. Proxifly free proxies (preferred countries first)

### Proxy pool caching:
- TTL: 5 minutes
- Filters: HTTP/HTTPS protocols, non-transparent anonymity
- Country preference: India, Philippines, Nigeria, Kenya, South Africa, Brazil, Indonesia, Pakistan, Bangladesh, Thailand, Vietnam, Egypt, Ghana, Tanzania, Uganda, Singapore, Malaysia, Mexico, Colombia, Argentina
- Selection: 5 random from pool (preferred countries sorted first)

---

## 9. API Endpoints Reference

All endpoints are served under `/api/` prefix.

### moviebox.ts routes (H5 API)

#### `GET /api/mb/home`
Home page content with featured movies/shows.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| — | — | — | No parameters |

**Upstream:** `GET /wefeed-h5api-bff/home?host=moviebox.ph`
**Caching:** 3-minute in-memory cache. Serves stale on error.

**Response:** Raw MovieBox home response with sections/rows.

---

#### `GET /api/mb/search`
Search movies/shows via H5 API.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `page` | string | No | Page number (default: "1") |

**Upstream:** `POST /wefeed-h5api-bff/subject/search`
**Body:** `{ keyword, page, perPage: 20 }`

---

#### `GET /api/mb/search-suggest`
Search autocomplete suggestions.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | Yes | Search query |

**Upstream:** `POST /wefeed-h5api-bff/subject/search-suggest`
**Body:** `{ keyword }`

---

#### `GET /api/mb/detail`
Get movie/show details via H5 API.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `detailPath` | string | Yes | Detail path (e.g. `/movie/detail/12345`) |

**Upstream:** `GET /wefeed-h5api-bff/detail?detailPath={encoded}`

---

#### `GET /api/mb/play`
Get play URL via H5 API.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `subjectId` | string | Yes | MovieBox subject ID |
| `resolution` | string | No | Resolution (default: "1080") |
| `se` | string | No | Season number |
| `ep` | string | No | Episode number |

**Upstream:** `GET /wefeed-h5api-bff/subject/play?subjectId=...&resolution=...`

---

#### `GET /api/mb/stream`
Proxy a stream URL through CF Worker.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL-encoded stream URL (must be HTTPS) |

**Allowed domains:** `hakunaymatata.com`, `aoneroom.com`, `moviebox.ph`, `moviebox.pk`, `moviebox.id`, `moviebox.ng`, `movieboxapp.in`, `fmoviesunblocked.net`, `sflix.film`, `netnaija.video`, `netnaija.com`, `videodownloader.site`

**Process:** Forwards to `{CF_PROXY}/stream?url={encoded_url}` and pipes response with Range support.

---

### stream.ts routes (BFF + H5 combined)

#### `GET /api/stream/source`
**Primary stream resolution endpoint.** Resolves a TMDB movie/show to a playable stream URL.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | `"movie"` or `"tv"` |
| `id` | string | Yes | TMDB ID |
| `title` | string | No | Movie/show title |
| `year` | string | No | Release year |
| `season` | string | Yes (TV) | Season number |
| `episode` | string | Yes (TV) | Episode number |
| `overview` | string | No | TMDB overview (for disambiguation) |
| `countries` | string | No | Comma-separated country codes |
| `genres` | string | No | Comma-separated genres |
| `cast` | string | No | Comma-separated cast names |

**Resolution cascade:**
1. MovieBox scraper (`resolveMovieBoxStream`) → returns MP4 URLs
2. VidLink scraper → returns HLS playlist
3. VidSrc scraper → returns HLS playlist
4. Embed fallback → returns embed iframe URLs

**Response for MovieBox source:**
```json
{
  "source": "moviebox",
  "type": "mp4",
  "streams": [
    { "url": "https://...", "quality": "720", "size": "800MB", "format": "MP4", "codec": "h264" },
    { "url": "https://...", "quality": "1080", "size": "1.5GB", "format": "MP4", "codec": "h264" }
  ],
  "languages": [
    { "name": "Hindi", "detailPath": "/movie/detail/...", "subjectId": "123" }
  ],
  "dubs": [
    { "subjectId": "456", "lanName": "Spanish", "lanCode": "es", "original": false }
  ],
  "currentSubjectId": "789",
  "subtitles": [
    { "id": "sub1", "lan": "en", "lanName": "English", "url": "https://..." }
  ],
  "proxyBase": "",
  "proxyFallback": "https://moviebox-proxy.popcorntv-proxy.workers.dev/stream",
  "imdbId": "tt1234567",
  "imdbTitle": "Movie Title",
  "imdbRating": "7.5"
}
```

---

#### `GET /api/stream/mb-home`
Home feed endpoint used by the frontend. Uses different strategies in production vs development.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `page` | string | No | Page number (default: "1") |
| `tabId` | string | No | Tab/category ID (default: "0") |

**Production flow (`IS_PRODUCTION = true`):**
1. H5 home via CF Worker (`h5HomeViaCfWorker(page)`) — calls `{CF_WORKER_URL}/home?page={page}`
2. BFF home fallback (`bffGetHomeFeed(page, tabId)`)
3. Stale cache (if available)

**Development flow:**
1. BFF home (`bffGetHomeFeed(page, tabId)`)
2. H5 home fallback (`h5HomeFallback(page)`) — direct to `h5-api.aoneroom.com`
3. Stale cache (if available)

**`IS_PRODUCTION` detection:** `!!(process.env.REPLIT_DEPLOYMENT || process.env.REPLIT_DEPLOY_ID)`

**Caching:** 3-minute in-memory cache keyed by `{page}:{tabId}`.

**Response format differs by source:**

**When served via H5 (production primary, dev fallback):** `h5HomeViaCfWorker()` normalizes to:
```json
{
  "data": {
    "operatingList": [
      {
        "operatingType": "BANNER",
        "banner": {
          "items": [
            { "title": "Movie Title", "cover": { "url": "..." }, "detailPath": "/movie/detail/123" }
          ]
        }
      },
      {
        "operatingType": "CARD_LIST",
        "title": "Trending Now",
        "subjects": [
          { "subjectId": "123", "title": "...", "cover": { "url": "..." } }
        ]
      }
    ]
  },
  "hasMore": true
}
```

**When served via BFF (dev primary, production fallback):** `bffGetHomeFeed()` returns:
```json
{
  "items": [
    { "title": "Section Title", "subjects": [...], "operatingType": "CARD_LIST" }
  ],
  "hasMore": true
}
```

**Important:** The frontend `HomePage.jsx` handles both formats via a fallback chain: `data?.data?.operatingList || data?.items || []`. H5 banners use `banner.items[]` (NOT `banner.banners[]` like BFF). The frontend `HeroBanner.jsx` handles both formats.

---

#### `GET /api/stream/mb-stream`
Resolve stream directly from a MovieBox subject ID (no TMDB lookup needed).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `subjectId` | string | Yes | MovieBox subject ID |
| `type` | string | No | `"movie"` or `"tv"` |
| `se` | string | No | Season number |
| `ep` | string | No | Episode number |

**Resolution cascade (within BFF):**
1. `bffGetPlayInfo()` → authenticated play-info endpoint
2. `bffGetResource()` → community resource links
3. H5 play endpoint as final fallback

**Response sources:** `"bff-play-info"`, `"bff-resource"`, or `"h5-play"`

---

#### `GET /api/stream/mb-play`
Resolve stream for a language variant.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `detailPath` | string | No* | H5 detail path |
| `subjectId` | string | No* | Direct subject ID |
| `season` | string | No | Season number |
| `episode` | string | No | Episode number |

*At least one of `detailPath` or `subjectId` required.

---

#### `GET /api/stream/mb-search`
Search with BFF-first, H5-fallback strategy.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `page` | string | No | Page number (default: "1") |

**Caching:** 60-second in-memory cache per query+page.

**Response:**
```json
{
  "items": [
    {
      "subjectId": "123",
      "subjectType": 1,
      "title": "Movie Title",
      "description": "...",
      "releaseDate": "2024",
      "genre": "Action",
      "cover": { "url": "https://...", "width": 300, "height": 450 },
      "countryName": "United States",
      "imdbRatingValue": "7.5",
      "hasResource": true,
      "language": "English"
    }
  ],
  "totalCount": 42,
  "hasMore": true
}
```

---

#### `GET /api/stream/mb-detail`
Get full movie/show details.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `subjectId` | string | Yes | MovieBox subject ID |
| `title` | string | No | Title hint (for H5 fallback search) |

**Response (BffSubjectDetail):**
```json
{
  "subjectId": "123",
  "subjectType": 1,
  "title": "Movie Title",
  "description": "Full plot description...",
  "releaseDate": "2024",
  "duration": "2h 15m",
  "durationSeconds": 8100,
  "genre": "Action, Drama",
  "cover": { "url": "https://...", "width": 300, "height": 450 },
  "countryName": "United States",
  "language": "English",
  "imdbRatingValue": "7.5",
  "staffList": [
    { "staffId": "s1", "staffType": 1, "name": "Director Name", "character": "", "avatarUrl": "https://..." },
    { "staffId": "s2", "staffType": 2, "name": "Actor Name", "character": "Character Name", "avatarUrl": "https://..." }
  ],
  "dubs": [
    { "subjectId": "456", "lanName": "Hindi", "lanCode": "hin", "original": false }
  ]
}
```

**staffType values:** `1` = Director, `2` = Cast/Actor

---

#### `GET /api/stream/mb-seasons`
Get season/episode structure for a TV show.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `subjectId` | string | Yes | MovieBox subject ID |

**Response (BffSeasonInfo):**
```json
{
  "subjectId": "123",
  "subjectType": 2,
  "seasons": [
    {
      "se": 1,
      "maxEp": 13,
      "allEp": "1,2,3,4,5,6,7,8,9,10,11,12,13",
      "resolutions": [
        { "resolution": 720, "epNum": 13 },
        { "resolution": 1080, "epNum": 10 }
      ]
    },
    {
      "se": 2,
      "maxEp": 10,
      "allEp": "1,2,3,4,5,6,7,8,9,10",
      "resolutions": [
        { "resolution": 720, "epNum": 10 }
      ]
    }
  ]
}
```

---

#### `GET /api/stream/mb-play-info`
Get raw play info (authenticated BFF).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `subjectId` | string | Yes | MovieBox subject ID |
| `se` | string | No | Season number (default: 0) |
| `ep` | string | No | Episode number (default: 0) |
| `resolution` | string | No | Max resolution (default: 1080) |

---

#### `GET /api/stream/mb-subtitles`
Search subtitles for a subject.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `subjectId` | string | Yes | MovieBox subject ID |

**Response:**
```json
{
  "subtitles": [
    { "subtitleId": "sub1", "language": "English", "url": "https://..." },
    { "subtitleId": "sub2", "language": "Spanish", "url": "https://..." }
  ]
}
```

---

#### `GET /api/stream/mb-resource`
Get community-uploaded resource links.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `subjectId` | string | Yes | MovieBox subject ID |
| `se` | string | No | Season number (default: 0) |
| `ep` | string | No | Episode number (default: 0) |

**Response:**
```json
{
  "items": [
    {
      "episode": 1,
      "title": "Episode Title",
      "resourceLink": "https://...",
      "linkType": 1,
      "size": 1500000000,
      "resolution": 1080,
      "codecName": "h264",
      "duration": 2700,
      "requireMemberType": 0,
      "uploadBy": "user123",
      "resourceId": "res1",
      "se": 1,
      "ep": 1,
      "sourceUrl": "https://...",
      "extCaptions": [
        { "id": "cap1", "lan": "en", "lanName": "English", "url": "https://..." }
      ]
    }
  ]
}
```

---

#### `GET /api/stream/mb-auth-status`
Check BFF authentication status.

**Response:**
```json
{
  "authenticated": true,
  "userId": "12345",
  "userType": 1,
  "expiresAt": "2026-05-01T00:00:00.000Z",
  "expiresIn": "25 days"
}
```

---

#### `GET /api/stream/mb-languages`
Discover all available language dubs for a movie/show.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No* | Movie/show title |
| `year` | string | No | Release year |
| `type` | string | No* | `"movie"` or `"tv"` |
| `season` | string | No | Season number |
| `episode` | string | No | Episode number |
| `subjectId` | string | No | MovieBox subject ID (will derive title/type from detail) |

*Required if `subjectId` not provided.

**Process:**
1. If `subjectId` provided: fetch detail to get dubs array + derive title/type
2. Probe for additional languages by searching `"{title} {language}"` for each in: English, Hindi, Telugu, Tamil, Spanish, French, Korean, Chinese, Arabic, Portuguese
3. Validate each discovered dub by checking if it has playable streams
4. Merge BFF dubs + search-discovered dubs, deduplicating by language code

---

#### `GET /api/stream/imdb`
Look up IMDB metadata for a TMDB ID.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | TMDB ID |
| `type` | string | No | `"movie"` or `"tv"` (default: "movie") |

---

#### `GET /api/stream/proxy`
Proxy any stream URL with M3U8 rewriting.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | URL-encoded stream URL (HTTPS only) |

**Features:**
- Domain whitelist enforcement
- M3U8 playlist rewriting (rewrites segment URLs to go through proxy)
- Range request support (Accept-Ranges, Content-Range)
- MovieBox-specific headers (Referer, Origin) for `hakunaymatata.com`/`aoneroom.com` domains

---

## 10. BFF Scraper Functions

### `bffGetSubjectDetail(subjectId, titleHint?)`
**File:** `moviebox-bff.ts`

| Step | Action |
|------|--------|
| 1 | Try BFF: `GET /wefeed-mobile-bff/subject-api/get?subjectId={id}` (with retry) |
| 2 | On failure → H5 search by title hint: `{CF_WORKER}/search?q={title}` |
| 3 | On failure → H5 detail by slug: `{CF_WORKER}/detail?detailPath=/movie/detail/{numericId}` |
| 4 | All failed → return null |

Returns: `BffSubjectDetail` with title, description, genre, cover, staffList, dubs, etc.

### `bffGetSeasonInfo(subjectId)`
| Step | Action |
|------|--------|
| 1 | Try BFF: `GET /wefeed-mobile-bff/subject-api/season-info?subjectId={id}` (with retry) |
| 2 | On failure → H5: `GET /wefeed-h5api-bff/subject/season-info?subjectId={id}` |

Returns: `BffSeasonInfo` with seasons array (se, maxEp, resolutions per episode).

### `bffGetPlayInfo(subjectId, se, ep, resolution)`
| Step | Action |
|------|--------|
| 1 | BFF: `GET /wefeed-mobile-bff/subject-api/play-info?subjectId={id}&se={se}&ep={ep}&resolution={res}` (auth required) |

Returns: `{ streams: [...], title }` — direct MP4 download URLs with quality/resolution info.

### `bffGetResource(subjectId, se, ep)`
| Step | Action |
|------|--------|
| 1 | BFF: `GET /wefeed-mobile-bff/subject-api/resource?subjectId={id}&se={se}&ep={ep}` (auth required) |

Returns: `BffResourceItem[]` — community-uploaded resources with download links, resolution, codec, captions.

### `bffSearchSubtitles(subjectId)`
| Step | Action |
|------|--------|
| 1 | Try BFF: `GET /wefeed-mobile-bff/subject-api/subtitle-search?subjectId={id}` (with retry) |
| 2 | On failure → H5: `GET /wefeed-h5api-bff/subject/subtitle-search?subjectId={id}` |

Returns: `BffSubtitle[]` with language and SRT/VTT URL.

### `bffSearch(keyword, page, perPage)`
| Step | Action |
|------|--------|
| 1 | BFF: `POST /wefeed-mobile-bff/subject-api/search` body `{ keyword, page, perPage }` (auth required) |

Returns: `{ items: BffSearchItem[], totalCount, hasMore }`

### `bffEmailLogin()`
| Step | Action |
|------|--------|
| 1 | Check region block → skip if blocked |
| 2 | Check cached token → return if still valid |
| 3 | `POST /wefeed-mobile-bff/user-api/login` body `{ authType: 1, mail, password: md5hex(pw) }` |
| 4 | Parse JWT, cache with expiry |

---

## 11. H5 Scraper Functions

### `mbGet(path)` / `mbPost(path, body)`
**File:** `moviebox.ts` (scraper) and `moviebox.ts` (routes)

Standard HTTP helpers that:
1. Prepend `{CF_PROXY}/h5` to the path
2. Add default headers: `X-Client-Info`, `Accept-Language`, `User-Agent`, `Referer`
3. Add `X-Api-Key` if configured
4. 15-second timeout via AbortController
5. Parse JSON response

### H5 Endpoints Used:
| Path | Method | Body | Purpose |
|------|--------|------|---------|
| `/wefeed-h5api-bff/home?host=moviebox.ph` | GET | — | Home page content |
| `/wefeed-h5api-bff/subject/search` | POST | `{ keyword, page, perPage }` | Search |
| `/wefeed-h5api-bff/subject/search-suggest` | POST | `{ keyword }` | Autocomplete |
| `/wefeed-h5api-bff/detail?detailPath=...` | GET | — | Movie/show details |
| `/wefeed-h5api-bff/subject/play?subjectId=...` | GET | — | Play URL |
| `/wefeed-h5api-bff/subject/season-info?subjectId=...` | GET | — | Season structure |
| `/wefeed-h5api-bff/subject/subtitle-search?subjectId=...` | GET | — | Subtitles |

### Default Headers for H5:
```json
{
  "X-Client-Info": "{\"timezone\":\"Africa/Nairobi\"}",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
  "Referer": "https://videodownloader.site/"
}
```

---

## 12. Stream Resolution Pipeline

The complete flow when resolving a movie/show to a playable stream:

### Full Pipeline (`resolveMovieBoxStream`):

```
INPUT: title, year, type, season, episode, tmdbId, overview, countries, genres, cast

Step 1: IMDB Lookup (optional)
├── TMDB → get IMDB ID via external_ids API
├── OMDB → get IMDB metadata (title, rating, runtime, plot)
└── If IMDB title differs from TMDB title → use IMDB title for search

Step 2: Search MovieBox
├── Try BFF search first: POST /subject-api/search { keyword: title }
├── If BFF fails → try H5 search: POST /subject/search { keyword: title }
├── If IMDB title search fails → retry with TMDB title
└── If short keyword differs from full title → retry with first significant word

Step 3: Title Matching
├── Score each result using titleSimilarity() (Jaccard + prefix matching)
├── Filter: sim >= 0.5, bidirectional word coverage >= 0.65
├── Filter: year within ±2, correct type (movie/tv)
├── Extract language tags from titles (e.g. "[Hindi]", "(Spanish)")
├── Best match = highest score among non-language-tagged results
└── Collect language variants from tagged results

Step 4: Disambiguation (if multiple close matches)
├── For top 4 candidates with sim >= 0.7:
│   ├── Fetch BFF detail for each
│   ├── Score against TMDB metadata:
│   │   ├── Description Jaccard (×0.5 weight)
│   │   ├── IMDB rating match (0-0.3 bonus)
│   │   ├── Country match (0.15 bonus)
│   │   ├── Genre overlap (0-0.1 bonus)
│   │   ├── Cast overlap (0-0.1 bonus)
│   │   ├── Vote count bonus (0.03-0.05)
│   │   └── Runtime match (0-0.15 bonus)
│   └── Pick highest-scoring candidate if > current + 0.03
└── Switch best match if disambiguation finds better candidate

Step 5: IMDB Cross-Verification
├── Compare IMDB rating vs MovieBox rating (tolerance: ±0.5)
├── Compare IMDB runtime vs MovieBox duration (tolerance: ±20%)
├── If BOTH fail → try next candidate from search results
└── If one fails → proceed with caution

Step 6: Dub/Language Collection
├── Load dubs from best match detail
├── Check close-match candidates for additional dubs
├── IMDB-verify each candidate before merging dubs
├── Probe for additional languages (search "{title} {lang}" for 10 languages)
└── Validate each dub has playable streams

Step 7: Stream Resolution
├── Try 1: bffGetPlayInfo() — authenticated play-info endpoint
├── Try 2: H5 play endpoint — /subject/play?subjectId=...
├── Try 3: bffGetResource() — community resource links
├── Try 4: Season remap — if TV and no streams, try remapped se/ep
│   ├── Remap: compute absolute episode number across all seasons
│   └── Re-try all 3 sources with remapped se/ep
├── Try 5: Dub variant fallback — try streaming from a dub's subjectId
└── Try 6: Language variant fallback — try streaming from search variants

Step 8: Build Response
├── Streams sorted by quality (ascending)
├── Subtitles from resource endpoint (extCaptions)
├── Dubs list with language names normalized
├── IMDB metadata (id, title, rating)
└── Remapped season/episode if applicable
```

---

## 13. Title Matching & Disambiguation

### `titleSimilarity(a, b)` — Returns 0.0 to 1.0

```
1. Normalize both titles:
   - Lowercase
   - Remove [bracketed] and (parenthesized) text
   - Remove possessives ('s → s)
   - Remove season markers (S1-S3, S01)
   - Remove non-alphanumeric chars
   - Collapse whitespace

2. Exact match after normalization → 1.0

3. Prefix match:
   - If one starts with the other
   - Check for sequel number conflicts (e.g. "Movie 2" vs "Movie 3" → 0.4)
   - Otherwise: ratio × 0.9

4. Jaccard similarity:
   - Compute word intersection / union
   - Boost with significant-word Jaccard (exclude stop words)
   - Sequel conflict penalty → cap at 0.45
   - All shorter words in longer set → boost to 0.85
   - One has number, other doesn't → cap boost at 0.7
```

### `passesBidirectionalCoverage(searchTitle, itemTitle, threshold=0.65)`

Ensures both titles cover each other's significant words by at least 65%.
Prevents matching "The Batman" to "Batman: The Killing Joke" (search coverage OK, but item coverage low).

### Language Tag Extraction (`extractLangTag`)

Checks in order:
1. `[Language]` in square brackets (excluding CAM, HC, TS, etc.)
2. `(Language)` in parentheses (must be a known language)
3. `— Language` after dash at end of title
4. Last word of title if it's a known language (4+ chars)

Known languages: English, Hindi, Telugu, Tamil, Spanish, French, Korean, Chinese, Arabic, Portuguese, Japanese, German, Italian, Russian, Turkish, Thai, Bengali, Kannada, Malayalam, Marathi, Gujarati, Punjabi, Urdu, Indonesian, Vietnamese, Polish, Dutch, Swedish, Norwegian, Danish, Finnish, Czech, Hungarian, Romanian, Greek, Hebrew

---

## 14. Language / Dub Discovery

### Three sources of language/dub information:

**Source 1: BFF Detail `dubs` array**
```json
{
  "dubs": [
    { "subjectId": "456", "lanName": "hin", "lanCode": "hin", "original": false },
    { "subjectId": "789", "lanName": "English", "lanCode": "eng", "original": true }
  ]
}
```

**Source 2: Search-based language tags**
Titles like `"Movie Title [Hindi]"` or `"Movie Title (Spanish)"` are detected and the tagged language + subjectId become language variants.

**Source 3: Language probing (`probeLanguageVariants`)**
For each of 10 languages (English, Hindi, Telugu, Tamil, Spanish, French, Korean, Chinese, Arabic, Portuguese):
1. Search `"{title} {language}"`
2. Find results with matching language tag in title
3. Verify title similarity ≥ 0.5 and year ±1
4. Verify IMDB rating matches (if available)
5. Test if variant has playable streams
6. If valid → add to dubs list

### Language name normalization:
Short codes (hin, tel, tam, esla, ptbr, etc.) → mapped to display names via `LANG_CODE_TO_DISPLAY` table.

### Deduplication:
- By `subjectId` (no duplicate IDs)
- By normalized language key (e.g. "hin" and "Hindi" are the same)

---

## 15. Season/Episode Remapping

When MovieBox has different season/episode numbering than TMDB:

### `remapSeasonEpisode(subjectId, tmdbSeason, tmdbEpisode)`

```
1. Fetch season info: bffGetSeasonInfo(subjectId)
2. Sort seasons by season number
3. Compute absolute episode:
   absoluteEp = (sum of episodes in seasons before tmdbSeason) + tmdbEpisode
4. Map back to MovieBox seasons:
   Walk through seasons, accumulating episode counts
   When accumulated >= absoluteEp, that's the target season
   Episode within season = absoluteEp - accumulated_before
5. If mapped se/ep equals input → return null (no remap needed)
```

Example: TMDB says S2E5. MovieBox has S1 (26 eps), S2 (13 eps).
- Absolute = 26 + 5 = 31
- MovieBox S1 has 26, so remaining = 31 - 26 = 5 → S2E5 (same, no remap)

But if MovieBox counted differently (S1 = 13 eps, S2 = 13 eps, S3 = 13 eps):
- Absolute = 13 + 5 = 18
- S1 = 13, remaining = 18 - 13 = 5 → S2E5 (same)

---

## 16. Subtitle Extraction

### BFF Subtitle Search
```
GET /wefeed-mobile-bff/subject-api/subtitle-search?subjectId={id}
Response: { data: { items: [{ subtitleId, language, url }] } }
```

### Resource-Embedded Captions
Each `BffResourceItem` can contain `extCaptions`:
```json
{
  "extCaptions": [
    { "id": "cap1", "lan": "en", "lanName": "English", "url": "https://cdn.../subtitles/en.srt" },
    { "id": "cap2", "lan": "es", "lanName": "Spanish", "url": "https://cdn.../subtitles/es.srt" }
  ]
}
```

### Subtitle priority:
1. BFF subtitle-search endpoint (dedicated subtitle service)
2. Resource `extCaptions` (embedded in resource items)

---

## 17. IMDB Cross-Verification

### Purpose:
Prevent playing wrong content when MovieBox has multiple entries with similar titles.

### Process (in `resolveMovieBoxStream`):
```
1. Get IMDB ID: TMDB external_ids API → imdb_id
2. Get IMDB metadata: OMDB API → rating, runtime, plot, actors, etc.
3. Compare IMDB rating vs MovieBox imdbRatingValue:
   - Tolerance: ±0.5 points
4. Compare IMDB runtime vs MovieBox duration:
   - Tolerance: ±20% of larger value
5. Results:
   - Both match → proceed confidently
   - One fails → proceed with caution (log warning)
   - Both fail → try next search candidate (up to 4 alternatives)
```

### IMDB data also used for:
- Search: Use IMDB title instead of TMDB title if they differ
- Disambiguation: IMDB plot compared against MovieBox description
- Language probing: Skip dub candidates whose IMDB rating doesn't match

---

## 18. Stream Proxy & CORS Handling

### Two proxy paths:

**1. CF Worker Stream Proxy (`/api/mb/stream`)**
- Frontend sends: `GET /api/mb/stream?url={encoded_stream_url}`
- API Server forwards to: `{CF_PROXY}/stream?url={encoded_stream_url}`
- CF Worker fetches the actual stream URL and pipes response
- Supports Range requests for seeking

**2. API Server Direct Proxy (`/api/stream/proxy`)**
- Used for HLS (M3U8) streams from VidLink/VidSrc
- Rewrites M3U8 playlists to route segment URLs through the proxy
- MovieBox MP4 streams add `Referer: https://videodownloader.site/` header

### Domain whitelist:
Both proxies enforce a domain whitelist. Only these domains are allowed:
- `hakunaymatata.com` (and subdomains) — MovieBox CDN
- `aoneroom.com` (and subdomains) — MovieBox API
- `moviebox.ph`, `moviebox.pk`, `moviebox.id`, `moviebox.ng` — MovieBox regional
- `movieboxapp.in` — MovieBox India
- `fmoviesunblocked.net`, `sflix.film` — Alternative domains
- `netnaija.video`, `netnaija.com` — Netnaija
- `videodownloader.site` — Referer domain

### CORS headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
```

### Range request support:
Both proxies pass through `Range`, `If-Range` request headers and `Content-Range`, `Accept-Ranges`, `Content-Length` response headers.

---

## 19. Caching Strategy

| Cache | Location | TTL | Key | Purpose |
|-------|----------|-----|-----|---------|
| Home page (H5) | `moviebox.ts` routes | 3 min | Single entry | Avoid repeated home fetches (H5 route) |
| Home page (BFF/H5) | `stream.ts` mb-home | 3 min | `{page}:{tabId}` | Primary home feed cache (prod+dev) |
| Search results | `stream.ts` | 60s | `query:page` | Avoid repeated searches |
| H5 guest token | `moviebox-bff.ts` | Until JWT expiry | Single entry | Reuse guest auth |
| BFF auth token | `moviebox-bff.ts` | Until JWT expiry - 5min | Single entry | Reuse login auth |
| Proxifly pool | `moviebox-bff.ts` | 5 min | Single entry | Reuse proxy list |
| IMDB metadata | `imdb-lookup.ts` | 24 hours (10min for errors) | TMDB ID | Avoid repeated IMDB lookups |
| Region block | `moviebox-bff.ts` | 10 min | Boolean flag | Skip BFF when region blocked |
| BFF play health | `stream.ts` | 30s cooldown after 5 failures | Counter | Skip unhealthy BFF play |

---

## 20. Data Structures & Types

### BffSubjectDetail
```typescript
{
  subjectId: string;          // Unique ID (e.g. "8388977201831627168")
  subjectType: number;        // 1 = movie, 2 = TV show
  title: string;
  description: string;        // Full plot description
  releaseDate: string;        // Year string (e.g. "2024")
  duration: string;           // Human-readable (e.g. "2h 15m")
  durationSeconds?: number;   // Duration in seconds
  genre: string;              // Comma-separated (e.g. "Action, Drama")
  cover: {
    url: string;              // Poster image URL
    width: number;
    height: number;
  } | null;
  countryName: string;        // Country of origin
  language: string;           // Original language
  imdbRatingValue: string;    // IMDB rating (e.g. "7.5")
  staffList: Array<{
    staffId: string;
    staffType: number;        // 1 = director, 2 = cast
    name: string;
    character: string;        // Character name (for cast)
    avatarUrl: string;        // Profile image URL
  }>;
  dubs?: BffDubEntry[];       // Available dub languages
}
```

### BffDubEntry
```typescript
{
  subjectId: string;    // Subject ID of the dubbed version
  lanName: string;      // Language name or code (e.g. "Hindi", "hin")
  lanCode: string;      // Language code (e.g. "hin", "esla")
  original: boolean;    // true if this is the original language
}
```

### BffSeasonInfo
```typescript
{
  subjectId: string;
  subjectType: number;
  seasons: Array<{
    se: number;                         // Season number
    maxEp: number;                      // Total episodes in season
    allEp: string;                      // Comma-separated episode numbers
    resolutions: Array<{
      resolution: number;              // e.g. 720, 1080
      epNum: number;                   // Episodes available at this resolution
    }>;
  }>;
}
```

### BffResourceItem
```typescript
{
  episode: number;
  title: string;
  resourceLink: string;          // Direct download URL
  linkType: number;
  size: number;                  // File size in bytes
  resolution: number;            // e.g. 720, 1080
  codecName: string;             // e.g. "h264", "h265"
  duration: number;              // Duration in seconds
  requireMemberType: number;     // 0 = free, higher = premium
  uploadBy: string;              // Uploader username
  resourceId: string;
  se: number;                    // Season number
  ep: number;                    // Episode number
  sourceUrl: string;
  extCaptions: BffResourceCaption[];  // Embedded subtitles
}
```

### MbStream
```typescript
{
  format: string;     // "MP4"
  id: string;         // Stream ID
  url: string;        // Direct MP4 URL (HTTPS)
  quality: string;    // Resolution (e.g. "720", "1080")
  size: string;       // File size (e.g. "1.5GB" or bytes)
  duration: number;   // Duration in seconds
  codec: string;      // Video codec (e.g. "h264")
}
```

### BffSearchItem
```typescript
{
  subjectId: string;
  subjectType: number;        // 1 = movie, 2 = TV
  title: string;
  description: string;
  releaseDate: string;
  genre: string;
  cover: { url, width, height } | null;
  countryName: string;
  imdbRatingValue: string;
  hasResource: boolean;
  language: string;
}
```

---

## 21. Complete Request Flow Diagrams

### Flow 1: Home Page Load
```
Frontend GET /api/stream/mb-home?page=1

  Production (IS_PRODUCTION):
  → Check 3-min cache
  → If miss: h5HomeViaCfWorker(page)
    → CF Worker /home?page=1
      → h5-api.aoneroom.com/wefeed-h5api-bff/home?host=moviebox.ph&page=1
  → If H5 fails: bffGetHomeFeed(page, tabId) via CF Worker /bff/...
  → If BFF fails: serve stale cache (if available)
  → Cache result for 3 min

  Development:
  → Check 3-min cache
  → If miss: bffGetHomeFeed(page, tabId) via CF Worker /bff/...
  → If BFF fails: h5HomeFallback(page) direct to h5-api.aoneroom.com
  → If H5 fails: serve stale cache (if available)
  → Cache result for 3 min

  → Return { data: { operatingList: [...sections] }, hasMore }
```

### Flow 2: Search
```
Frontend GET /api/stream/mb-search?q=batman
  → Check 60s cache
  → If miss: bffSearch("batman", 1, 20)
    → bffRequestWithAuth() → sign request → CF Worker → api3.aoneroom.com
    → If BFF fails or region blocked → H5 fallback
      → CF Worker /search?q=batman&page=1
  → Cache result
  → Return { items, totalCount, hasMore }
```

### Flow 3: Watch a Movie (TMDB → Stream)
```
Frontend GET /api/stream/source?type=movie&id=550&title=Fight Club&year=1999

  Step 1: IMDB Lookup
  → TMDB external_ids → imdb_id=tt0137523
  → OMDB → { title, rating: "8.8", runtime: "139 min", plot: "..." }

  Step 2: Search MovieBox
  → bffSearch("Fight Club") → found match
  → Or H5 search fallback

  Step 3: Title Match
  → Score candidates, find best match for "Fight Club" (1999, movie)

  Step 4: IMDB Verify
  → Compare rating 8.8 vs MovieBox rating → match?
  → Compare runtime 139min vs MovieBox duration → match?

  Step 5: Get Streams
  → bffGetPlayInfo(subjectId, 0, 0, 1080)
  → Returns [{ url: "https://cdn.../fight-club-1080p.mp4", quality: "1080" }]

  Step 6: Response
  → { source: "moviebox", type: "mp4", streams: [...], dubs: [...] }
```

### Flow 4: Watch a TV Episode
```
Frontend GET /api/stream/source?type=tv&id=1396&title=Breaking Bad&season=3&episode=5

  Steps 1-4: Same as movie

  Step 5: Get Streams for S3E5
  → bffGetPlayInfo(subjectId, 3, 5, 1080)
  → If empty → try H5 play endpoint
  → If empty → try bffGetResource(subjectId, 3, 5)
  → If empty → try season remap:
    → bffGetSeasonInfo → compute absolute ep → try remapped se/ep
  → If still empty → try dub variants
  → If still empty → try language variants from search
```

### Flow 5: Switch Language/Dub
```
Frontend GET /api/stream/mb-stream?subjectId=456&type=tv&se=3&ep=5

  → bffGetSubjectDetail(456) → get dubs for new subject
  → bffGetPlayInfo(456, 3, 5, 1080) → direct streams
  → If empty → bffGetResource(456, 3, 5)
  → If empty → H5 play fallback
  → Return streams + subtitles
```

---

## 22. Error Handling & Health Checks

### BFF Play Health Circuit Breaker
```typescript
const bffPlayHealth = {
  failures: 0,
  lastFailure: 0,
  threshold: 5,        // After 5 failures...
  cooldownMs: 30000,   // ...skip BFF play for 30 seconds
};
```

- Used in `mb-stream` endpoint
- If BFF play-info fails 5 times → skip directly to H5 fallback for 30 seconds
- Reset on any success

### Region Block (10-minute flag)
- On 403 "Service not available in current region" → set `bffRegionBlocked = true`
- All BFF calls immediately throw/return null for 10 minutes
- After 10 min → reset flag, retry BFF on next request

### Error cascade pattern:
Every function follows: **BFF → H5 fallback → null/empty**
- BFF fails? Try H5 equivalent
- H5 fails? Return null/empty array
- Never throw unhandled errors to the API routes

### Timeout policy:
- All fetch calls: 15-second timeout via AbortController
- Proxy fetch: 10-second timeout
- IMDB lookup: 6-8 second timeout
- Language probe validation: 5-second timeout per dub

---

## 23. Quick Start Examples

### Browse Home Feed
```javascript
const home = await fetch('/api/stream/mb-home').then(r => r.json());
const sections = home.data.operatingList.filter(s => s.subjects?.length > 0);

for (const section of sections) {
  console.log(section.title, section.subjects.length, 'items');
}
```

### Search and Get Detail
```javascript
const results = await fetch('/api/mb/search?q=avatar&page=1').then(r => r.json());
const items = results.data.items || results.data.results || [];
const item = items[0];

const detail = await fetch(`/api/mb/detail?detailPath=${encodeURIComponent(item.detailPath)}`).then(r => r.json());
const subject = detail.data.subject;
const seasons = detail.data.resource?.seasonList || [];
console.log(subject.title, 'isTV:', seasons.length > 0);
```

### Play a Movie
```javascript
const stream = await fetch(
  `/api/stream/source?type=movie&id=${subjectId}&title=${encodeURIComponent('Avatar')}&year=2009`
).then(r => r.json());

if (stream.type === 'mp4') {
  const videoUrl = `/api/mb/stream?url=${encodeURIComponent(stream.streams[0].url)}`;
  document.querySelector('video').src = videoUrl;
} else if (stream.type === 'hls') {
  const hls = new Hls();
  hls.loadSource(stream.streamUrl);
  hls.attachMedia(document.querySelector('video'));
} else if (stream.type === 'embed') {
  document.querySelector('iframe').src = stream.embedUrl;
}
```

### Play a TV Episode
```javascript
const stream = await fetch(
  `/api/stream/source?type=tv&id=${subjectId}&title=${encodeURIComponent('Breaking Bad')}&year=2008&season=2&episode=5`
).then(r => r.json());
// Same handling as movie (mp4/hls/embed)
```

### Switch Language/Dub
```javascript
const langs = await fetch(
  `/api/stream/mb-languages?subjectId=12345&title=${encodeURIComponent('Avatar')}&type=movie`
).then(r => r.json());

console.log('Available dubs:', langs.dubs.map(d => d.lanName));

const hindiDub = langs.dubs.find(d => d.lanName === 'Hindi');
if (hindiDub) {
  const altStream = await fetch(
    `/api/stream/mb-play?subjectId=${hindiDub.subjectId}`
  ).then(r => r.json());
  const videoUrl = `/api/mb/stream?url=${encodeURIComponent(altStream.streams[0].url)}`;
  document.querySelector('video').src = videoUrl;
}
```

### Get Subtitles
```javascript
const subs = await fetch('/api/stream/mb-subtitles?subjectId=12345').then(r => r.json());
for (const sub of subs.subtitles) {
  console.log(sub.language, sub.url);
}
```

### Get Season/Episode Info
```javascript
const info = await fetch('/api/stream/mb-seasons?subjectId=12345').then(r => r.json());
for (const season of info.seasons) {
  console.log(`Season ${season.se}: ${season.maxEp} episodes`);
  console.log(`  Available at: ${season.resolutions.map(r => r.resolution + 'p').join(', ')}`);
}
```

### Direct Play via BFF
```javascript
const playInfo = await fetch(
  '/api/stream/mb-play-info?subjectId=12345&se=1&ep=3&resolution=1080'
).then(r => r.json());

if (playInfo.streams.length > 0) {
  const videoUrl = `/api/mb/stream?url=${encodeURIComponent(playInfo.streams[0].url)}`;
  document.querySelector('video').src = videoUrl;
}
```

---

## 24. Production Deployment & Cloudflare Proxy

### How Production Mode Is Detected

The API server detects production via Replit environment variables:

```typescript
export const IS_PRODUCTION = !!(process.env.REPLIT_DEPLOYMENT || process.env.REPLIT_DEPLOY_ID);
```

When `IS_PRODUCTION` is `true`:
- `directAccessBlocked` is initialized to `true` (never attempts direct BFF calls)
- `probeDirectAccess()` short-circuits immediately — no direct BFF probe is made
- **All** BFF requests route through the CF Worker at `https://moviebox-proxy.popcorntv-proxy.workers.dev`
- The Proxifly proxy fallback chain is never used

In development (`IS_PRODUCTION = false`):
- On startup, `probeDirectAccess()` makes a test BFF request to check if the datacenter IP is allowed
- If direct access works, BFF requests go straight to `api3.aoneroom.com`
- If direct access is blocked (403), requests route through CF Worker, then Proxifly proxies as fallback
- Direct access is re-probed every 30 minutes (`REPROBE_INTERVAL`)

### How the CF Worker Bypasses Region Blocks

MovieBox blocks BFF API requests from US/EU IP addresses (returns 403 with "Service not available in current region"). The CF Worker bypasses this by **spoofing request headers** to make requests appear to originate from allowed regions.

#### BFF Routes (`/bff/*` → `api3.aoneroom.com`)

The `proxyPassthrough()` function injects these headers when `targetHost === MB_BFF_HOST`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Client-Info` | `{"timezone":"Asia/Kolkata"}` | Makes MovieBox think the request is from India |
| `Accept-Language` | `en-IN,en;q=0.9,hi;q=0.8` | Indian English language preference |
| `User-Agent` | `okhttp/3.12.0` | Mimics the MovieBox Android app |

#### H5 Convenience Routes (`/home`, `/search`, `/detail`, `/play`)

These routes use different headers defined in `DEFAULT_H5_HEADERS`:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Client-Info` | `{"timezone":"Africa/Nairobi"}` | Makes MovieBox think the request is from East Africa |
| `Accept-Language` | `en-US,en;q=0.5` | Standard English |
| `User-Agent` | `Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0` | Desktop Firefox |
| `Referer` | `https://videodownloader.site/` | Spoofed referrer |

#### Stripped Headers

The CF Worker **removes** these Cloudflare-injected headers before forwarding to upstream, so MovieBox cannot detect the real origin:

```
cf-connecting-ip    — Real client IP added by Cloudflare
cf-ipcountry        — Client's country code (e.g., "US")
cf-ray              — Cloudflare Ray ID
cf-visitor          — Visitor scheme info
x-forwarded-for     — Proxy chain IPs
x-forwarded-proto   — Original protocol
x-real-ip           — Real client IP
x-api-key           — Our auth key (not for upstream)
connection          — Hop-by-hop header
accept-encoding     — Let CF handle compression
user-agent          — Replaced with spoofed UA
```

### CF Worker Authentication

The CF Worker validates an `X-Api-Key` header on `/bff/*` and `/h5/*` routes, **but only when `env.API_KEY` is configured** in the Worker's environment. If `API_KEY` is not set, these routes are also open:

```javascript
const needsAuth = path.startsWith("/bff/") || path.startsWith("/h5/");
if (needsAuth && apiKey) {           // apiKey = env.API_KEY — skipped if unset
  const provided = request.headers.get("x-api-key");
  if (provided !== apiKey) {
    return errorResponse("Unauthorized", 401);
  }
}
```

Convenience routes (`/home`, `/search`, `/detail`, `/play`, `/stream`, `/health`, `/diag`) are **always public** — no API key required regardless of configuration.

### Stream Proxy Route

`GET /stream?url={encoded_url}` proxies video CDN URLs:

1. **URL validation**: Only `https:` protocol allowed
2. **Domain allowlist**: Only these domains (and subdomains) are permitted:
   ```
   hakunaymatata.com, aoneroom.com, moviebox.ph, moviebox.pk,
   moviebox.id, moviebox.ng, movieboxapp.in, fmoviesunblocked.net,
   sflix.film, netnaija.video, netnaija.com, videodownloader.site
   ```
3. **Range support**: Forwards `Range` and `If-Range` headers from the client, returns `Content-Range` and `Accept-Ranges` from upstream
4. **CF Edge caching**: Uses `cf: { cacheEverything: true, cacheTtl: 3600 }` for 1-hour edge caching
5. **Client caching**: Sets `Cache-Control: public, max-age=3600` on the response

### Diagnostics Endpoint

`GET /diag` makes an unauthenticated test request to the BFF API to check reachability:

```json
{
  "bffReachable": true,
  "upstreamStatus": 200,
  "bffCode": 0,
  "latency": "142ms",
  "colo": "SIN"
}
```

- `bffReachable`: `false` if upstream returned 403 or BFF code is 403
- `colo`: Cloudflare datacenter code where the Worker executed (e.g., `SIN` = Singapore, `IAD` = Virginia)
- Useful for verifying the Worker can reach MovieBox from its edge location

### Request Flow in Production

```
Frontend (React)
  │
  ▼
API Server (Express, port 8080)
  │
  │  IS_PRODUCTION = true
  │  directAccessBlocked = true (always)
  │
  ├─── BFF requests ──▶ bffFetchViaCfWorker()
  │                        │
  │                        ▼
  │                  CF Worker /bff/*
  │                  + India headers injected
  │                  + CF/origin headers stripped
  │                        │
  │                        ▼
  │                  api3.aoneroom.com
  │
  ├─── H5 requests ──▶ CF Worker /h5/*
  │                        │
  │                        ▼
  │                  h5-api.aoneroom.com
  │
  └─── Stream URLs ──▶ CF Worker /stream?url=...
                           │
                           ▼
                     Video CDN (hakunaymatata.com, etc.)
                     + 1h edge cache
```

### Request Flow in Development

```
Frontend (React)
  │
  ▼
API Server (Express, port 8080)
  │
  │  IS_PRODUCTION = false
  │  probeDirectAccess() runs on startup
  │
  ├─── If direct OK ──▶ api3.aoneroom.com (direct)
  │
  ├─── If direct 403 ──▶ bffFetchViaCfWorker() (same as prod)
  │         │
  │         └── If CF also fails ──▶ bffFetchViaProxy()
  │                                    │
  │                                    ├── BFF_PROXY_URL (if set)
  │                                    ├── knownGoodProxy (cached 15 min)
  │                                    └── Proxifly free proxies (5 random)
  │
  └─── Re-probe every 30 min to check if direct access recovered
```

---

## 25. Firebase Auth Setup for Published Domain

The WeFlix C2 frontend uses Firebase Authentication for user accounts. Firebase restricts which domains can initiate authentication requests — if a domain is not authorized, sign-up and login will fail with an `auth/unauthorized-domain` error.

### Setup Steps

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Select the project (matching `VITE_FIREBASE_PROJECT_ID`)
3. Navigate to **Authentication** → **Settings** → **Authorized Domains**
4. Add the following domains:

| Domain | When to Add |
|--------|-------------|
| `localhost` | Already added by default |
| Your exact Replit dev domain (e.g., `abc123-00-xyz.replit.dev`) | For development preview — use the full hostname, not a wildcard |
| `your-app.replit.app` | After publishing — use the exact `.replit.app` subdomain |
| Custom domain (if configured) | If you set up a custom domain for deployment |

### How to Find Your Domains

- **Dev domain**: Visible in the Replit preview pane URL bar (e.g., `abc123.replit.dev`)
- **Published domain**: After deploying, Replit assigns a `*.replit.app` domain (visible in deployment settings)
- **Custom domain**: If configured in Replit deployment settings

### What Happens Without Authorization

If the domain is not in the authorized list:
- `createUserWithEmailAndPassword()` throws `FirebaseError: auth/unauthorized-domain`
- `signInWithEmailAndPassword()` throws `FirebaseError: auth/unauthorized-domain`
- Google/social sign-in redirects fail silently or show a Firebase error page
- The app appears to work but authentication is completely non-functional

### Firebase Environment Variables

These are set as Replit secrets and injected at build time via Vite:

| Variable | Purpose |
|----------|---------|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain (e.g., `project.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project identifier |
| `VITE_FIREBASE_STORAGE_BUCKET` | Cloud Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app identifier |
| `VITE_FIREBASE_MEASUREMENT_ID` | Google Analytics measurement ID |

These do **not** need to change between development and production — they are the same Firebase project. Only the **authorized domains** list needs updating.

---

## 26. USE_CF_PROXY — Hosting Guide

The `USE_CF_PROXY` environment variable controls how the API server reaches MovieBox APIs.

### How it works

| `USE_CF_PROXY` value | Behavior |
|---------------------|----------|
| `true` or `1` | All BFF/H5 requests route through the Cloudflare Worker proxy. Direct API access is never attempted. |
| `false`, `0`, or **not set** | Server probes direct API access at startup. If the server's IP is accepted by MovieBox (e.g. India), requests go directly. If blocked, falls back to proxy/Proxifly chain. |

### When to use each mode

**India server (Oracle Mumbai, any Indian VPS/cloud):**
```
USE_CF_PROXY=        # leave empty or don't set
MOVIEBOX_BFF_SECRET=76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O
MOVIEBOX_EMAIL=your-email
MOVIEBOX_PASSWORD=your-password
```
Direct API calls are faster — no extra hop through Cloudflare. The server probes `api3.aoneroom.com` at startup and confirms direct access works.

**US/EU/other blocked region (Render, Koyeb, Fly.io, etc.):**
```
USE_CF_PROXY=true
CF_MOVIEBOX_PROXY_URL=https://moviebox-proxy.popcorntv-proxy.workers.dev
CF_MOVIEBOX_API_KEY=your-key
MOVIEBOX_BFF_SECRET=76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O
MOVIEBOX_EMAIL=your-email
MOVIEBOX_PASSWORD=your-password
```

### Startup log messages

When the server starts, look for these log messages to confirm the mode:

- **CF proxy mode:** `USE_CF_PROXY=true — skipping direct probe, using CF Worker for all BFF requests`
- **Direct mode:** `Direct API mode (USE_CF_PROXY is not true) — probing direct BFF access...` followed by either:
  - `Direct BFF access probe OK — datacenter IP accepted` (direct calls will be used)
  - `Direct BFF probe failed — will use proxy` (falls back to proxy chain)

---

*End of MovieBox Scraper API Documentation*
