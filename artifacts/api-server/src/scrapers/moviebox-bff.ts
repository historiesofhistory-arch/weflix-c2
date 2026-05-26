import crypto from "node:crypto";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { logger } from "../lib/logger";

const SECRET_KEY = process.env.MOVIEBOX_BFF_SECRET || "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const SECRET_BYTES = SECRET_KEY ? Buffer.from(SECRET_KEY, "base64") : Buffer.alloc(0);
const BFF_DIRECT_URL = "https://api3.aoneroom.com";
const MB_EMAIL = process.env.MOVIEBOX_EMAIL || "botnestai@gmail.com";
const MB_PASSWORD = process.env.MOVIEBOX_PASSWORD || "Kaifssdd";
const BFF_PROXY_URL = process.env.BFF_PROXY_URL || "";
const BFF_AUTH_TOKEN_ENV = process.env.BFF_AUTH_TOKEN || "";
export const CF_MOVIEBOX_PROXY_URL = process.env.CF_MOVIEBOX_PROXY_URL || "https://moviebox-proxy.popcorntv-proxy.workers.dev";
export const CF_MOVIEBOX_API_KEY = process.env.CF_MOVIEBOX_API_KEY || "";
const USE_CF_PROXY_ENV = (process.env.USE_CF_PROXY || "").toLowerCase();
export const useCfProxy = USE_CF_PROXY_ENV === "true" || USE_CF_PROXY_ENV === "1";

let directAccessBlocked = useCfProxy;
let lastProbeTime = 0;
const REPROBE_INTERVAL = 30 * 60 * 1000;

const PROXIFLY_URL = "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.json";
const PREFERRED_COUNTRIES = ["IN", "PH", "NG", "KE", "ZA", "BR", "ID", "PK", "BD", "TH", "VN", "EG"];

let cachedProxies: { list: string[]; fetchedAt: number } | null = null;
const PROXY_LIST_TTL = 5 * 60 * 1000;
let knownGoodProxy: { url: string; foundAt: number } | null = null;
const GOOD_PROXY_TTL = 15 * 60 * 1000;

async function fetchProxifly(): Promise<string[]> {
  if (cachedProxies && Date.now() - cachedProxies.fetchedAt < PROXY_LIST_TTL) {
    return cachedProxies.list;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(PROXIFLY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return cachedProxies?.list || [];
    const raw = await resp.json() as Array<{ ip: string; port: number; country: string; protocol: string; alive?: boolean }>;
    const preferred: string[] = [];
    const others: string[] = [];
    for (const p of raw) {
      if (!p.ip || !p.port) continue;
      if (p.alive === false) continue;
      const url = `${p.protocol || "http"}://${p.ip}:${p.port}`;
      if (PREFERRED_COUNTRIES.includes(p.country?.toUpperCase())) {
        preferred.push(url);
      } else {
        others.push(url);
      }
    }
    const list = [...preferred, ...others];
    cachedProxies = { list, fetchedAt: Date.now() };
    logger.info({ total: list.length, preferred: preferred.length }, "Fetched Proxifly proxy list");
    return list;
  } catch (err) {
    logger.warn({ err: String(err).slice(0, 80) }, "Failed to fetch Proxifly list");
    return cachedProxies?.list || [];
  }
}

async function getProxyUrl(): Promise<string | null> {
  if (knownGoodProxy && Date.now() - knownGoodProxy.foundAt < GOOD_PROXY_TTL) {
    return knownGoodProxy.url;
  }
  return null;
}

const BFF_PROXY_AUTH_KEY = process.env.BFF_PROXY_AUTH_KEY || "wfx-bff-k82nQ4xR7v";

async function bffFetchViaBffProxy(
  targetUrl: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ ok: boolean; status: number; text: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(BFF_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Key": BFF_PROXY_AUTH_KEY },
      body: JSON.stringify({ url: targetUrl, method, headers, body: body || undefined }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "CF BFF proxy worker returned non-200");
      return null;
    }
    const result = await resp.json() as { ok: boolean; status: number; text: string };
    logger.info({ status: result.status, ok: result.ok }, "BFF request via CF BFF proxy succeeded");
    return result;
  } catch (err) {
    logger.warn({ err: String(err).slice(0, 120) }, "CF BFF proxy worker fetch failed");
    return null;
  }
}

async function bffFetchViaProxy(
  targetUrl: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  requireTrustedProxy: boolean = false,
): Promise<{ ok: boolean; status: number; text: string } | null> {
  if (BFF_PROXY_URL) {
    const cfResult = await bffFetchViaBffProxy(targetUrl, method, headers, body);
    if (cfResult) return cfResult;
    logger.warn("CF BFF proxy worker failed, falling back to Proxifly");
  }

  const proxyUrl = await getProxyUrl();
  const proxiesToTry: string[] = proxyUrl ? [proxyUrl] : [];

  if (!proxyUrl) {
    if (requireTrustedProxy) {
      logger.warn("No BFF_PROXY_URL configured — falling back to Proxifly for auth request (set BFF_PROXY_URL for security)");
    }
    const list = await fetchProxifly();
    const sample = list.slice(0, 8);
    for (const p of sample) {
      if (!proxiesToTry.includes(p)) proxiesToTry.push(p);
    }
  }

  if (proxiesToTry.length === 0) {
    return null;
  }

  for (const px of proxiesToTry) {
    try {
      const agent = new ProxyAgent(px);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const resp = await undiciFetch(targetUrl, {
        method,
        headers,
        body: body || undefined,
        signal: controller.signal,
        dispatcher: agent,
      });
      clearTimeout(timeout);
      const text = await resp.text();
      if (resp.status === 407 || resp.status === 429 || resp.status === 502 || resp.status === 503) {
        continue;
      }
      if (resp.ok || (resp.status !== 403 && resp.status >= 200 && resp.status < 500)) {
        if (resp.ok) {
          knownGoodProxy = { url: px, foundAt: Date.now() };
        }
        logger.info({ proxy: px.replace(/\/\/.*@/, "//**@"), status: resp.status }, "BFF proxy request succeeded");
        return { ok: resp.ok, status: resp.status, text };
      }
    } catch (err) {
      logger.debug({ proxy: px.replace(/\/\/.*@/, "//**@"), err: String(err).slice(0, 80) }, "Proxy attempt failed");
    }
  }
  return null;
}

export async function probeDirectAccess(): Promise<void> {
  if (useCfProxy) {
    directAccessBlocked = true;
    lastProbeTime = Date.now();
    logger.info({ cfWorker: CF_MOVIEBOX_PROXY_URL }, "USE_CF_PROXY=true — skipping direct probe, using CF Worker for all BFF requests");
    return;
  }
  logger.info("Direct API mode (USE_CF_PROXY is not true) — probing direct BFF access...");
  try {
    const testPath = "/wefeed-mobile-bff/subject-api/get";
    const testQs = "subjectId=74738785354956752";
    const sig = signRequest("GET", testPath, testQs, "");
    const headers: Record<string, string> = {
      "x-tr-signature": sig,
      "X-Client-Token": makeClientToken(),
      Accept: "application/json",
      "User-Agent": "okhttp/4.9.3",
    };
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${BFF_DIRECT_URL}${testPath}?${testQs}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const ms = Date.now() - start;
    lastProbeTime = Date.now();
    if (resp.ok) {
      directAccessBlocked = false;
      logger.info({ latency: ms + "ms" }, "Direct BFF access probe OK — datacenter IP accepted");
    } else {
      directAccessBlocked = true;
      logger.warn({ status: resp.status, latency: ms + "ms" }, "Direct BFF access probe failed — will use proxy");
    }
  } catch (err) {
    lastProbeTime = Date.now();
    directAccessBlocked = true;
    logger.warn({ err: String(err).slice(0, 100) }, "Direct BFF probe failed — will use proxy");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bffRequestWithRetry(
  method: string,
  path: string,
  queryString: string,
  body?: string,
  useAuth: boolean = false,
): Promise<Record<string, unknown>> {
  const requestFn = useAuth ? bffRequestWithAuth : bffRequest;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await requestFn(method, path, queryString, body);
    } catch (err) {
      if (attempt === 3) throw err;
      logger.info({ path, attempt: attempt + 1, err: String(err).slice(0, 80) }, "BFF request failed — retrying");
      await sleep(1000);
    }
  }

  throw new Error(`BFF request failed for ${path} after 3 retries`);
}

function md5hex(str: string): string {
  return crypto.createHash("md5").update(str, "utf-8").digest("hex");
}

export function makeClientToken(): string {
  const ts = String(Date.now());
  const reversed = ts.split("").reverse().join("");
  return ts + "," + md5hex(reversed);
}

function sortParams(queryStr: string): string {
  if (!queryStr) return "";
  const params = queryStr.split("&").map((p) => {
    const idx = p.indexOf("=");
    if (idx === -1) return [p, ""];
    return [
      decodeURIComponent(p.substring(0, idx)),
      decodeURIComponent(p.substring(idx + 1)),
    ];
  });
  params.sort((a, b) => a[0].localeCompare(b[0]));
  return params
    .filter(([k]) => k !== "")
    .map(([k, v]) => k + "=" + v)
    .join("&");
}

export function signRequest(
  method: string,
  path: string,
  queryString: string,
  body: string,
): string {
  const timestamp = Date.now();
  const bodyMd5 = body
    ? crypto.createHash("md5").update(body).digest("hex")
    : "";
  const accept = "application/json";
  const contentType = body ? "application/json" : "";
  const contentLength = body ? String(Buffer.byteLength(body)) : "";
  const sorted = queryString ? sortParams(queryString) : "";
  const pathWithQuery = sorted ? path + "?" + sorted : path;

  const stringToSign = [
    method.toUpperCase(),
    accept,
    contentType,
    contentLength,
    String(timestamp),
    bodyMd5,
    pathWithQuery,
  ].join("\n");

  const hmac = crypto.createHmac("md5", SECRET_BYTES);
  hmac.update(stringToSign, "utf-8");
  return timestamp + "|2|" + hmac.digest("base64");
}

async function bffFetchViaCfWorker(
  method: string,
  fullPath: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ ok: boolean; status: number; text: string }> {
  const cfUrl = `${CF_MOVIEBOX_PROXY_URL}/bff${fullPath}`;
  const cfHeaders = { ...headers };
  if (CF_MOVIEBOX_API_KEY) cfHeaders["X-Api-Key"] = CF_MOVIEBOX_API_KEY;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(cfUrl, {
      method,
      headers: cfHeaders,
      body: body || undefined,
      signal: controller.signal,
    });
    const text = await resp.text();
    logger.info({ path: fullPath.split("?")[0], status: resp.status, cfPlacement: resp.headers?.get?.("cf-placement") || "unknown" }, "CF Worker BFF request");
    return { ok: resp.ok, status: resp.status, text };
  } catch (err) {
    logger.error({ path: fullPath.split("?")[0], err: String(err).slice(0, 100) }, "CF Worker BFF request failed");
    return { ok: false, status: 502, text: '{"code":502,"message":"CF Worker request failed"}' };
  } finally {
    clearTimeout(timeout);
  }
}

async function bffFetchDirect(
  method: string,
  fullPath: string,
  headers: Record<string, string>,
  body?: string,
  requireTrustedProxy: boolean = false,
): Promise<{ ok: boolean; status: number; text: string }> {
  if (useCfProxy) {
    return bffFetchViaCfWorker(method, fullPath, headers, body);
  }

  const targetUrl = `${BFF_DIRECT_URL}${fullPath}`;

  if (directAccessBlocked && lastProbeTime > 0 && Date.now() - lastProbeTime > REPROBE_INTERVAL) {
    logger.debug("Reprobing direct BFF access after interval");
    await probeDirectAccess();
  }

  if (!directAccessBlocked) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(targetUrl, {
        method,
        headers,
        body: body || undefined,
        signal: controller.signal,
      });
      const text = await resp.text();
      if (resp.status !== 403) {
        return { ok: resp.ok, status: resp.status, text };
      }
      logger.info({ path: fullPath.split("?")[0] }, "Direct BFF returned 403 — trying proxy");
    } catch (err) {
      logger.info({ path: fullPath.split("?")[0], err: String(err).slice(0, 60) }, "Direct BFF failed — trying proxy");
    } finally {
      clearTimeout(timeout);
    }
  }

  const proxyResult = await bffFetchViaProxy(targetUrl, method, headers, body, requireTrustedProxy);
  if (proxyResult) return proxyResult;

  return { ok: false, status: 403, text: '{"code":403,"message":"Region blocked and no proxy available"}' };
}

async function bffRequest(
  method: string,
  path: string,
  queryString: string,
  body?: string,
): Promise<Record<string, unknown>> {
  const sig = signRequest(method, path, queryString, body || "");
  const fullPath = queryString ? path + "?" + queryString : path;

  const headers: Record<string, string> = {
    "x-tr-signature": sig,
    "X-Client-Token": makeClientToken(),
    Accept: "application/json",
    "User-Agent": "okhttp/4.9.3",
    "X-Client-Info": '{"timezone":"Asia/Kolkata"}',
    "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }

  const res = await bffFetchDirect(method, fullPath, { ...headers }, body);
  if (!res.ok) {
    throw new Error(`BFF returned ${res.status} for ${path}: ${res.text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse BFF response from ${path}: ${res.text.slice(0, 200)}`);
  }
}

export interface BffDubEntry {
  subjectId: string;
  lanName: string;
  lanCode: string;
  original: boolean;
}

export interface BffSubjectDetail {
  subjectId: string;
  subjectType: number;
  title: string;
  description: string;
  releaseDate: string;
  duration: string;
  durationSeconds?: number;
  genre: string;
  cover: {
    url: string;
    width: number;
    height: number;
  } | null;
  countryName: string;
  language: string;
  imdbRatingValue: string;
  staffList: Array<{
    staffId: string;
    staffType: number;
    name: string;
    character: string;
    avatarUrl: string;
  }>;
  dubs?: BffDubEntry[];
}

export interface BffSeasonInfo {
  subjectId: string;
  subjectType: number;
  seasons: Array<{
    se: number;
    maxEp: number;
    allEp: string;
    resolutions: Array<{
      resolution: number;
      epNum: number;
    }>;
  }>;
}

export interface BffSubtitle {
  subtitleId: string;
  language: string;
  url: string;
}

function parseH5DetailMatch(match: Record<string, unknown>): BffSubjectDetail {
  return {
    subjectId: String(match.subjectId),
    subjectType: Number(match.subjectType) || 1,
    title: String(match.title || ""),
    description: String(match.description || match.summary || ""),
    releaseDate: String(match.releaseDate || match.year || ""),
    duration: String(match.duration || ""),
    durationSeconds: match.durationSeconds ? Number(match.durationSeconds) : undefined,
    genre: String(match.genre || match.genres || ""),
    cover: match.cover && typeof match.cover === "object" ? (match.cover as BffSubjectDetail["cover"]) : null,
    countryName: String(match.countryName || match.country || ""),
    language: String(match.language || ""),
    imdbRatingValue: String(match.imdbRatingValue || match.imdbRating || ""),
    staffList: Array.isArray(match.staffList) ? match.staffList : [],
    dubs: Array.isArray(match.dubs) ? match.dubs : undefined,
  } as BffSubjectDetail;
}

export async function bffGetSubjectDetail(
  subjectId: string,
  titleHint?: string,
): Promise<BffSubjectDetail | null> {
  try {
    const result = await bffRequestWithRetry(
      "GET",
      "/wefeed-mobile-bff/subject-api/get",
      "subjectId=" + subjectId,
      undefined,
      true,
    );
    const data = (result as { data?: BffSubjectDetail })?.data;
    if (!data || !data.subjectId) return null;
    return data;
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "BFF get subject failed after retries");
  }

  if (titleHint) {
    try {
      const searchResult = await bffSearch(titleHint, 1, 20);
      const match = searchResult.items.find(
        (item) => String(item.subjectId) === String(subjectId),
      );
      if (match) {
        logger.info({ subjectId, title: titleHint }, "BFF search fallback found match for detail");
        return parseH5DetailMatch(match as unknown as Record<string, unknown>);
      }
    } catch (searchErr) {
      logger.warn({ err: String(searchErr), subjectId }, "BFF search fallback for detail failed");
    }
  }

  logger.error({ subjectId }, "All fallbacks exhausted for subject detail");
  return null;
}

export async function bffGetSeasonInfo(
  subjectId: string,
): Promise<BffSeasonInfo | null> {
  try {
    const result = await bffRequestWithRetry(
      "GET",
      "/wefeed-mobile-bff/subject-api/season-info",
      "subjectId=" + subjectId,
    );
    const data = (result as { data?: BffSeasonInfo })?.data;
    if (!data || !data.subjectId) return null;
    return data;
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "BFF season-info failed");
    return null;
  }
}

export async function bffGetPlayInfo(
  subjectId: string,
  se: number = 0,
  ep: number = 0,
  resolution: number = 1080,
): Promise<{
  streams: Array<Record<string, unknown>>;
  title: string;
} | null> {
  try {
    const query =
      "subjectId=" +
      subjectId +
      "&se=" +
      se +
      "&ep=" +
      ep +
      "&resolution=" +
      resolution;
    const result = await bffRequestWithAuth(
      "GET",
      "/wefeed-mobile-bff/subject-api/play-info",
      query,
    );
    const data = result?.data as {
      streams?: Array<Record<string, unknown>>;
      title?: string;
    };
    return {
      streams: data?.streams || [],
      title: data?.title || "",
    };
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "BFF play-info error");
    throw err;
  }
}

export async function bffSearchSubtitles(
  subjectId: string,
): Promise<BffSubtitle[]> {
  try {
    const result = await bffRequestWithRetry(
      "GET",
      "/wefeed-mobile-bff/subject-api/subtitle-search",
      "subjectId=" + subjectId,
    );
    const data = result?.data as { items?: BffSubtitle[] };
    return data?.items || [];
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "BFF subtitle-search failed");
    return [];
  }
}

export interface BffStreamCaption {
  id: string;
  lan: string;
  lanName: string;
  url: string;
  size?: string;
  delay?: number;
}

/**
 * Fetch external captions associated with a specific stream.
 *
 * Endpoint discovered via APK decompilation. The mobile app calls this AFTER
 * play-info returns a stream, passing the stream's `id` field as `streamId`.
 * Unlike `subtitle-search` (which is empty for our bot account), this endpoint
 * returns the full set of CDN-signed .srt URLs in many languages — the same
 * data the official MovieBox player uses for its CC menu.
 *
 * Auth note: this endpoint succeeds for our bot account because the streamId
 * itself is the only authorisation it requires (and we can mint streamIds via
 * the public H5 play endpoint).
 */
export async function bffGetStreamCaptions(
  streamId: string,
  subjectId: string,
  se: number = 0,
  ep: number = 0,
): Promise<BffStreamCaption[]> {
  try {
    const query =
      `streamId=${encodeURIComponent(streamId)}` +
      `&subjectId=${encodeURIComponent(subjectId)}` +
      `&se=${se}&ep=${ep}`;
    const result = await bffRequestWithAuth(
      "GET",
      "/wefeed-mobile-bff/subject-api/get-stream-captions",
      query,
    );
    const data = result?.data as { extCaptions?: BffStreamCaption[] };
    return data?.extCaptions || [];
  } catch (err) {
    logger.error(
      { err: String(err), streamId, subjectId },
      "BFF get-stream-captions failed",
    );
    return [];
  }
}

/**
 * Fetch captions via the second hidden endpoint discovered in the APK:
 * `/wefeed-mobile-bff/subject-api/get-ext-captions`.
 *
 * It takes a `resourceId` (any of the per-quality stream ids returned by
 * H5 play works) plus se/ep. Empirically this endpoint is broader than
 * `get-stream-captions`: for many episodes (e.g. Classroom of the Elite
 * S2/S3/S4) get-stream-captions returns `[]` while get-ext-captions
 * returns 10–16 language tracks. The official MovieBox player calls both
 * and unions the results, which is why captions show up in their app
 * even when our primary source is empty.
 */
export async function bffGetExtCaptions(
  resourceId: string,
  se: number = 0,
  ep: number = 0,
): Promise<BffStreamCaption[]> {
  try {
    const query =
      `resourceId=${encodeURIComponent(resourceId)}` + `&se=${se}&ep=${ep}`;
    const result = await bffRequestWithAuth(
      "GET",
      "/wefeed-mobile-bff/subject-api/get-ext-captions",
      query,
    );
    const data = result?.data as { extCaptions?: BffStreamCaption[] };
    return data?.extCaptions || [];
  } catch (err) {
    logger.error(
      { err: String(err), resourceId },
      "BFF get-ext-captions failed",
    );
    return [];
  }
}

export interface BffResourceDetectorResolution {
  title: string;
  size: string;
  resourceLink: string;
}

export interface BffResourceDetectorCaption {
  lan: string;
  lanName: string;
  url: string;
}

export interface BffResourceDetector {
  downloadUrl: string;
  resolutionList: BffResourceDetectorResolution[];
  extCaptions: BffResourceDetectorCaption[];
}

export interface BffSearchItem {
  subjectId: string;
  subjectType: number;
  title: string;
  description: string;
  releaseDate: string;
  genre: string;
  cover: {
    url: string;
    width: number;
    height: number;
  } | null;
  countryName: string;
  imdbRatingValue: string;
  hasResource: boolean;
  language: string;
  resourceDetectors?: BffResourceDetector[];
}

export async function bffSearch(
  keyword: string,
  page: number = 1,
  perPage: number = 20,
): Promise<{
  items: BffSearchItem[];
  totalCount: number;
  hasMore: boolean;
}> {
  try {
    const body = JSON.stringify({ keyword, page, perPage });
    const result = await bffRequestWithAuth(
      "POST",
      "/wefeed-mobile-bff/subject-api/search",
      "",
      body,
    );
    const data = result?.data as {
      items?: BffSearchItem[];
      pager?: { totalCount?: number; hasMore?: boolean };
    };
    return {
      items: data?.items || [],
      totalCount: data?.pager?.totalCount || 0,
      hasMore: data?.pager?.hasMore || false,
    };
  } catch (err) {
    logger.error({ err: String(err), keyword }, "BFF search error (auth)");
    throw err;
  }
}

export interface BffResourceFromSearchStream {
  url: string;
  quality: string;
  size: number;
}

export interface BffResourceFromSearchResult {
  streams: BffResourceFromSearchStream[];
  subtitles: Array<{ lan: string; lanName: string; url: string }>;
}

function isCdnUrl(url: string): boolean {
  return /hakunaymatata\.com/i.test(url);
}

function parseResolutionFromTitle(title: string): string {
  const m = title.match(/(\d{3,4})[Pp]/);
  return m ? m[1] : "720";
}

export async function bffGetResourceFromSearch(
  subjectId: string,
  titleHint?: string,
): Promise<BffResourceFromSearchResult> {
  const empty: BffResourceFromSearchResult = { streams: [], subtitles: [] };

  try {
    let searchItems: BffSearchItem[] = [];

    if (titleHint) {
      const result = await bffSearch(titleHint, 1, 20);
      searchItems = result.items;
    }

    const match = searchItems.find(
      (item) => String(item.subjectId) === String(subjectId),
    );

    if (!match) {
      const detailResult = await bffRequestWithAuth(
        "GET",
        "/wefeed-mobile-bff/subject-api/get",
        "subjectId=" + subjectId,
      );
      const detailData = detailResult?.data as { title?: string } | undefined;
      if (detailData?.title && detailData.title !== titleHint) {
        const result2 = await bffSearch(detailData.title, 1, 20);
        const match2 = result2.items.find(
          (item) => String(item.subjectId) === String(subjectId),
        );
        if (match2) {
          return extractResourceFromItem(match2);
        }
      }
      logger.warn({ subjectId, titleHint }, "bffGetResourceFromSearch: no matching item found in search");
      return empty;
    }

    return extractResourceFromItem(match);
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "bffGetResourceFromSearch error");
    return empty;
  }
}

function extractResourceFromItem(item: BffSearchItem): BffResourceFromSearchResult {
  const streams: BffResourceFromSearchStream[] = [];
  const subtitles: Array<{ lan: string; lanName: string; url: string }> = [];
  const seenUrls = new Set<string>();

  const detectors = item.resourceDetectors || [];
  for (const det of detectors) {
    if (det.resolutionList && det.resolutionList.length > 0) {
      for (const res of det.resolutionList) {
        if (res.resourceLink && isCdnUrl(res.resourceLink) && !seenUrls.has(res.resourceLink)) {
          seenUrls.add(res.resourceLink);
          streams.push({
            url: res.resourceLink,
            quality: parseResolutionFromTitle(res.title || ""),
            size: parseInt(res.size || "0", 10),
          });
        }
      }
    }

    if (det.downloadUrl && isCdnUrl(det.downloadUrl) && !seenUrls.has(det.downloadUrl)) {
      seenUrls.add(det.downloadUrl);
      streams.push({
        url: det.downloadUrl,
        quality: "720",
        size: 0,
      });
    }

    if (det.extCaptions && det.extCaptions.length > 0) {
      for (const cap of det.extCaptions) {
        subtitles.push({
          lan: cap.lan,
          lanName: cap.lanName,
          url: cap.url,
        });
      }
    }
  }

  streams.sort((a, b) => parseInt(a.quality, 10) - parseInt(b.quality, 10));

  return { streams, subtitles };
}

export interface BffHomeFeedItem {
  subjectId: string;
  title: string;
  cover: { url: string; width: number; height: number } | null;
  subjectType: number;
  imdbRatingValue: string;
  releaseDate: string;
  genre: string;
  language: string;
}

export async function bffGetHomeFeed(
  page: number = 1,
  tabId: number = 0,
): Promise<{ items: BffHomeFeedItem[]; hasMore: boolean }> {
  try {
    const query = `page=${page}&tabId=${tabId}&version=`;
    const result = await bffRequestWithAuth(
      "GET",
      "/wefeed-mobile-bff/tab-operating",
      query,
    );
    const data = result?.data as {
      items?: BffHomeFeedItem[];
      pager?: { hasMore?: boolean };
    };
    return {
      items: data?.items || [],
      hasMore: data?.pager?.hasMore || false,
    };
  } catch (err) {
    logger.error({ err: String(err), page, tabId }, "BFF home feed error");
    throw err;
  }
}

let cachedH5Token: { token: string; expiresAt: number } | null = null;

async function tryH5GuestTokenDirect(h5Headers: Record<string, string>): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(
      "https://h5-api.aoneroom.com/wefeed-h5api-bff/home?host=moviebox.ph",
      { headers: h5Headers, signal: controller.signal },
    );
    clearTimeout(timeout);
    const xUser = r.headers.get("x-user");
    if (!xUser) return null;
    const parsed = JSON.parse(xUser);
    return parsed.token || null;
  } catch (err) {
    clearTimeout(timeout);
    logger.debug({ err: String(err).slice(0, 80) }, "H5 direct guest token failed");
    return null;
  }
}

async function tryH5GuestTokenViaProxy(h5Headers: Record<string, string>): Promise<string | null> {
  const proxyUrl = await getProxyUrl();
  const proxiesToTry: string[] = proxyUrl ? [proxyUrl] : [];
  if (!proxyUrl) {
    const list = await fetchProxifly();
    for (const p of list.slice(0, 5)) {
      if (!proxiesToTry.includes(p)) proxiesToTry.push(p);
    }
  }

  for (const px of proxiesToTry) {
    try {
      const agent = new ProxyAgent(px);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const r = await undiciFetch(
        "https://h5-api.aoneroom.com/wefeed-h5api-bff/home?host=moviebox.ph",
        { headers: h5Headers, signal: controller.signal, dispatcher: agent },
      );
      clearTimeout(timeout);
      const xUser = r.headers.get("x-user");
      if (!xUser) continue;
      const parsed = JSON.parse(xUser);
      if (parsed.token) {
        knownGoodProxy = { url: px, foundAt: Date.now() };
        logger.info({ proxy: px.replace(/\/\/.*@/, "//**@") }, "H5 guest token via proxy");
        return parsed.token;
      }
    } catch (err) {
      logger.debug({ proxy: px.replace(/\/\/.*@/, "//**@"), err: String(err).slice(0, 80) }, "H5 proxy guest token attempt failed");
    }
  }
  return null;
}

const CF_H5_WORKER_URL = process.env.CF_H5_WORKER_URL || "https://h5-token-proxy.popcorntv-proxy.workers.dev/";

async function tryH5GuestTokenViaCfWorker(): Promise<string | null> {
  if (!CF_H5_WORKER_URL) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(CF_H5_WORKER_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) {
      logger.debug({ status: r.status }, "CF Worker H5 token request failed");
      return null;
    }
    const data = (await r.json()) as { token?: string; error?: string };
    if (data.token) {
      logger.info("Obtained H5 guest token via Cloudflare Worker");
      return data.token;
    }
    logger.debug({ error: data.error }, "CF Worker returned no token");
    return null;
  } catch (err) {
    logger.debug({ err: String(err).slice(0, 80) }, "CF Worker H5 token failed");
    return null;
  }
}

async function getH5GuestToken(): Promise<string | null> {
  if (cachedH5Token && cachedH5Token.expiresAt > Date.now() + 60000) {
    return cachedH5Token.token;
  }
  try {
    const ct = makeClientToken();
    const h5Headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      "X-Client-Token": ct,
      "X-Client-Info": JSON.stringify({ timezone: "Asia/Kolkata" }),
      "X-Request-Lang": "en",
    };

    let token = await tryH5GuestTokenDirect(h5Headers);
    if (!token) {
      token = await tryH5GuestTokenViaProxy(h5Headers);
    }
    if (!token) {
      token = await tryH5GuestTokenViaCfWorker();
    }
    if (!token) return null;

    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString(),
    );
    cachedH5Token = {
      token,
      expiresAt: (payload.exp || 0) * 1000,
    };
    logger.info("Obtained H5 guest token");
    return token;
  } catch (err) {
    logger.error({ err: String(err) }, "Failed to get H5 guest token");
    return null;
  }
}

let cachedBffAuth: { token: string; expiresAt: number; userId: string } | null = null;
let bffLoginInProgress: Promise<string | null> | null = null;

async function bffEmailLogin(): Promise<string | null> {
  if (BFF_AUTH_TOKEN_ENV && (!cachedBffAuth || cachedBffAuth.token !== BFF_AUTH_TOKEN_ENV)) {
    try {
      const payload = JSON.parse(
        Buffer.from(BFF_AUTH_TOKEN_ENV.split(".")[1], "base64").toString(),
      ) as { exp?: number; uid?: number };
      const expiresAt = (payload.exp || 0) * 1000;
      if (expiresAt > Date.now() + 300000) {
        cachedBffAuth = {
          token: BFF_AUTH_TOKEN_ENV,
          expiresAt,
          userId: String(payload.uid || ""),
        };
        logger.info(
          { expiresIn: Math.round((expiresAt - Date.now()) / 86400000) + "d" },
          "Using pre-set BFF_AUTH_TOKEN",
        );
        return BFF_AUTH_TOKEN_ENV;
      }
      logger.warn("Pre-set BFF_AUTH_TOKEN is expired, falling back to login");
    } catch {
      logger.warn("Pre-set BFF_AUTH_TOKEN is invalid, falling back to login");
    }
  }
  if (cachedBffAuth && cachedBffAuth.expiresAt > Date.now() + 300000) {
    return cachedBffAuth.token;
  }
  if (!MB_EMAIL || !MB_PASSWORD) {
    return null;
  }
  if (bffLoginInProgress) {
    return bffLoginInProgress;
  }
  bffLoginInProgress = (async () => {
    try {
      const loginPath = "/wefeed-mobile-bff/user-api/login";
      const loginBody = JSON.stringify({
        authType: 1,
        mail: MB_EMAIL,
        password: md5hex(MB_PASSWORD),
      });
      const ts = Date.now();
      const bodyMd5 = crypto.createHash("md5").update(loginBody).digest("hex");
      const sts = [
        "POST",
        "application/json",
        "application/json",
        String(Buffer.byteLength(loginBody)),
        String(ts),
        bodyMd5,
        loginPath,
      ].join("\n");
      const hmac = crypto.createHmac("md5", SECRET_BYTES);
      hmac.update(sts, "utf-8");
      const sig = ts + "|2|" + hmac.digest("base64");

      const loginHeaders: Record<string, string> = {
          "x-tr-signature": sig,
          "X-Client-Token": makeClientToken(),
          Accept: "application/json",
          "User-Agent": "okhttp/4.9.3",
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(loginBody)),
      };

      const directRes = await bffFetchDirect("POST", loginPath, { ...loginHeaders }, loginBody, true);
      if (!directRes.ok) {
        logger.error({ status: directRes.status }, "BFF email login failed");
        return null;
      }
      const result = JSON.parse(directRes.text) as {
        code?: number;
        message?: string;
        data?: { token?: string; userId?: string };
      };

      if (result.code !== 0 || !result.data?.token) {
        logger.error({ message: result.message, code: result.code }, "BFF email login failed");
        return null;
      }
      const jwt = result.data.token;
      const payload = JSON.parse(
        Buffer.from(jwt.split(".")[1], "base64").toString(),
      ) as { exp?: number };
      cachedBffAuth = {
        token: jwt,
        expiresAt: (payload.exp || 0) * 1000,
        userId: result.data.userId || "",
      };
      logger.info(
        { userId: cachedBffAuth.userId, expiresIn: Math.round((cachedBffAuth.expiresAt - Date.now()) / 86400000) + "d" },
        "BFF email login successful",
      );
      return jwt;
    } catch (err) {
      logger.error({ err: String(err) }, "BFF email login error");
      return null;
    } finally {
      bffLoginInProgress = null;
    }
  })();
  return bffLoginInProgress;
}

export async function getBffAuthToken(): Promise<string | null> {
  const bffToken = await bffEmailLogin();
  if (bffToken) return bffToken;
  if (useCfProxy) {
    logger.warn("BFF email login failed (USE_CF_PROXY mode) — not falling back to H5 guest token");
    return null;
  }
  return getH5GuestToken();
}

async function bffRequestWithAuth(
  method: string,
  path: string,
  queryString: string,
  body?: string,
): Promise<Record<string, unknown>> {
  const token = await getBffAuthToken();
  const sig = signRequest(method, path, queryString, body || "");
  const fullPath = queryString ? path + "?" + queryString : path;

  const headers: Record<string, string> = {
    "x-tr-signature": sig,
    "X-Client-Token": makeClientToken(),
    Accept: "application/json",
    "User-Agent": "okhttp/4.9.3",
    "X-Client-Info": '{"timezone":"Asia/Kolkata"}',
    "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
  };
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }

  const res = await bffFetchDirect(method, fullPath, { ...headers }, body, true);
  if (!res.ok) {
    throw new Error(`BFF auth request returned ${res.status} for ${path}: ${res.text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse BFF auth response from ${path}: ${res.text.slice(0, 200)}`);
  }
}

const H5_DIRECT_URL = "https://h5-api.aoneroom.com";
const H5_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://videodownloader.site",
  Referer: "https://videodownloader.site/",
};

export async function h5SearchFallback(
  keyword: string,
  page: number = 1,
): Promise<{ items: BffSearchItem[]; totalCount: number; hasMore: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`${H5_DIRECT_URL}/wefeed-h5api-bff/subject/search`, {
      method: "POST",
      headers: { ...H5_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, page, perPage: 20 }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`H5 search returned ${resp.status}`);
    const raw = await resp.json() as {
      data?: {
        items?: BffSearchItem[];
        pager?: { total?: number; hasMore?: boolean };
      };
    };
    const items = raw?.data?.items || [];
    return {
      items,
      totalCount: raw?.data?.pager?.total || items.length,
      hasMore: raw?.data?.pager?.hasMore || false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function h5HomeViaCfWorker(
  page: number = 1,
): Promise<{ data: { operatingList: unknown[] }; hasMore: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const cfHeaders: Record<string, string> = { Accept: "application/json" };
    if (CF_MOVIEBOX_API_KEY) cfHeaders["X-Api-Key"] = CF_MOVIEBOX_API_KEY;
    const resp = await fetch(`${CF_MOVIEBOX_PROXY_URL}/home?page=${page}`, {
      headers: cfHeaders,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`H5 home via CF Worker returned ${resp.status}`);
    const raw = await resp.json() as {
      data?: {
        operatingList?: unknown[];
        items?: unknown[];
        pager?: { hasMore?: boolean };
      };
    };
    const operatingList = raw?.data?.operatingList || raw?.data?.items || [];
    logger.info({ page, sectionCount: operatingList.length, source: "h5-cf-worker" }, "H5 home via CF Worker succeeded");
    return {
      data: { operatingList },
      hasMore: raw?.data?.pager?.hasMore || false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function h5HomeFallback(
  page: number = 1,
): Promise<{ data?: { operatingList?: unknown[]; items?: BffHomeFeedItem[] }; items: BffHomeFeedItem[]; hasMore: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const ct = makeClientToken();
    const resp = await fetch(
      `${H5_DIRECT_URL}/wefeed-h5api-bff/home?host=moviebox.ph&page=${page}`,
      {
        headers: {
          ...H5_HEADERS,
          "X-Client-Token": ct,
          "X-Client-Info": JSON.stringify({ timezone: "Asia/Kolkata" }),
          "X-Request-Lang": "en",
        },
        signal: controller.signal,
      },
    );
    if (!resp.ok) throw new Error(`H5 home returned ${resp.status}`);
    const raw = await resp.json() as {
      data?: {
        operatingList?: unknown[];
        items?: BffHomeFeedItem[];
        pager?: { hasMore?: boolean };
      };
    };
    return {
      data: raw?.data,
      items: raw?.data?.items || [],
      hasMore: raw?.data?.pager?.hasMore || false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export {
  bffRequest,
  bffRequestWithAuth,
  bffEmailLogin,
  getH5GuestToken,
};
