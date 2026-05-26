import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { resolveMovieBoxLanguageStream, normalizeLangKey, displayLangName, probeLanguageVariants, h5GetSubjectDetail, h5GetSeasonInfo } from "../scrapers/moviebox";
import {
  bffGetSubjectDetail,
  bffGetSeasonInfo,
  bffSearchSubtitles,
  bffSearch,
  bffGetResourceFromSearch,
  bffGetPlayInfo,
  bffGetHomeFeed,
  h5SearchFallback,
  h5HomeFallback,
  h5HomeViaCfWorker,
  bffEmailLogin,
  useCfProxy,
  CF_MOVIEBOX_PROXY_URL,
  CF_MOVIEBOX_API_KEY,
  type BffDubEntry,
} from "../scrapers/moviebox-bff";

const router = Router();

function getServerProxyBase(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  return `${proto}://${host}/api/stream/proxy`;
}


router.get("/stream/mb-play", async (req: Request, res: Response) => {
  const { detailPath, season, episode, subjectId } = req.query as Record<string, string>;
  if (!detailPath && !subjectId) {
    res.status(400).json({ error: "detailPath or subjectId is required" });
    return;
  }
  try {
    const result = await resolveMovieBoxLanguageStream(detailPath || "", season, episode, subjectId);
    if (result && result.streams.length > 0) {
      const resp: Record<string, unknown> = {
        type: "mp4",
        streams: result.streams,
        proxyBase: getServerProxyBase(req),
      };
      if (result.subtitles && result.subtitles.length > 0) {
        resp.subtitles = result.subtitles;
      }
      res.json(resp);
      return;
    }
    res.status(404).json({ error: "No streams found for this variant" });
  } catch (err) {
    logger.error({ err: String(err), detailPath, subjectId }, "mb-play error");
    res.status(500).json({ error: "Failed to resolve stream" });
  }
});

router.get("/stream/mb-stream", async (req: Request, res: Response) => {
  const { detailPath, season, episode, subjectId } = req.query as Record<string, string>;
  if (!detailPath && !subjectId) {
    res.status(400).json({ error: "detailPath or subjectId is required" });
    return;
  }
  try {
    const result = await resolveMovieBoxLanguageStream(detailPath || "", season, episode, subjectId);
    if (result && result.streams.length > 0) {
      const resp: Record<string, unknown> = {
        type: "mp4",
        streams: result.streams,
        proxyBase: getServerProxyBase(req),
      };
      if (result.subtitles && result.subtitles.length > 0) {
        resp.subtitles = result.subtitles;
      }
      res.json(resp);
      return;
    }
    res.status(404).json({ error: "No streams found for this variant" });
  } catch (err) {
    logger.error({ err: String(err), detailPath, subjectId }, "mb-stream error");
    res.status(500).json({ error: "Failed to resolve stream" });
  }
});

const searchCache = new Map<string, { data: unknown; ts: number }>();
const SEARCH_CACHE_TTL = 60_000;

router.get("/stream/mb-search", async (req: Request, res: Response) => {
  const { q, page } = req.query as Record<string, string>;
  if (!q) {
    res.status(400).json({ error: "q (query) is required" });
    return;
  }
  const pageNum = parseInt(page || "1", 10);
  const cacheKey = `${q.toLowerCase().trim()}:${pageNum}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
    res.json(cached.data);
    return;
  }
  try {
    let result;
    if (useCfProxy) {
      result = await bffSearch(q, pageNum);
    } else {
      result = await h5SearchFallback(q, pageNum);
    }
    searchCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    if (cached) {
      res.json(cached.data);
      return;
    }
    res.status(502).json({ error: "Search failed" });
  }
});

const BFF_HOME_CACHE_TTL = 3 * 60 * 1000;
const bffHomeCacheMap = new Map<string, { data: unknown; ts: number }>();

function normalizeHomeResponse(raw: unknown): { items: unknown[]; hasMore: boolean } {
  if (!raw || typeof raw !== "object") return { items: [], hasMore: false };
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.items)) return { items: r.items, hasMore: !!r.hasMore };
  if (r.data && typeof r.data === "object") {
    const d = r.data as Record<string, unknown>;
    const list = (d.operatingList || d.items || []) as unknown[];
    const flatItems: unknown[] = [];
    for (const section of list) {
      if (section && typeof section === "object" && Array.isArray((section as Record<string, unknown>).items)) {
        flatItems.push(...((section as Record<string, unknown>).items as unknown[]));
      } else {
        flatItems.push(section);
      }
    }
    return { items: flatItems, hasMore: !!(d.pager && (d.pager as Record<string, unknown>).hasMore) || !!r.hasMore };
  }
  if (Array.isArray(r.sections)) {
    const flatItems: unknown[] = [];
    for (const section of r.sections as unknown[]) {
      if (section && typeof section === "object" && Array.isArray((section as Record<string, unknown>).items)) {
        flatItems.push(...((section as Record<string, unknown>).items as unknown[]));
      }
    }
    return { items: flatItems, hasMore: !!r.hasMore };
  }
  if (Array.isArray(raw)) return { items: raw, hasMore: false };
  return { items: [], hasMore: false };
}

router.get("/stream/mb-home", async (req: Request, res: Response) => {
  const { page, tabId } = req.query as Record<string, string>;
  const pageNum = parseInt(page || "1", 10);
  const tabNum = parseInt(tabId || "0", 10);
  const cacheKey = `${pageNum}:${tabNum}`;
  const cached = bffHomeCacheMap.get(cacheKey);
  if (cached && Date.now() - cached.ts < BFF_HOME_CACHE_TTL) {
    res.json(cached.data);
    return;
  }
  const sendNormalized = (raw: unknown) => {
    const normalized = normalizeHomeResponse(raw);
    bffHomeCacheMap.set(cacheKey, { data: normalized, ts: Date.now() });
    res.json(normalized);
  };
  try {
    const h5Result = await h5HomeFallback(pageNum);
    sendNormalized(h5Result);
  } catch {
    try {
      const result = await bffGetHomeFeed(pageNum, tabNum);
      sendNormalized(result);
    } catch {
      if (cached) { res.json(cached.data); return; }
      res.status(502).json({ error: "Home feed failed" });
    }
  }
});

router.get("/stream/mb-detail", async (req: Request, res: Response) => {
  const { subjectId, title } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }

  const normalizeDetail = (detail: Record<string, unknown>) => {
    const releaseDate = String(detail.releaseDate || "");
    const yearMatch = releaseDate.match(/\d{4}/);
    const genre = String(detail.genre || "");
    return {
      ...detail,
      coverUrl: (detail.cover as Record<string, unknown>)?.url || "",
      rating: String(detail.imdbRatingValue || ""),
      year: yearMatch ? yearMatch[0] : "",
      genres: genre ? genre.split(/[,/]/).map((g: string) => g.trim()).filter(Boolean) : [],
      overview: String(detail.description || ""),
    };
  };

  try {
    const h5Detail = await h5GetSubjectDetail(subjectId);
    if (h5Detail) {
      res.json(normalizeDetail(h5Detail));
      return;
    }
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "mb-detail: H5 failed, trying BFF");
  }

  try {
    const detail = await bffGetSubjectDetail(subjectId, title || undefined);
    if (detail) {
      res.json(normalizeDetail(detail as unknown as Record<string, unknown>));
      return;
    }
    res.status(404).json({ error: "Subject not found" });
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "mb-detail: BFF fallback also failed");
    res.status(500).json({ error: "Failed to fetch subject detail" });
  }
});

router.get("/stream/mb-seasons", async (req: Request, res: Response) => {
  const { subjectId } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }

  const formatSeasons = (info: { subjectId: string; seasons: Array<{ se: number; maxEp: number; resolutions?: number[] }> }) => {
    const seasons = (info.seasons || []).map((s) => {
      const maxEp = s.maxEp || 0;
      const episodes = [];
      for (let i = 1; i <= maxEp; i++) {
        episodes.push({
          episodeNumber: i,
          episode: i,
          name: `Episode ${i}`,
          title: `Episode ${i}`,
        });
      }
      return {
        seasonNumber: s.se,
        season: s.se,
        name: `Season ${s.se}`,
        episodeCount: maxEp,
        episodes,
        resolutions: s.resolutions,
      };
    });
    return { subjectId: info.subjectId, seasons };
  };

  try {
    const h5Info = await h5GetSeasonInfo(subjectId);
    if (h5Info) {
      res.json(formatSeasons(h5Info));
      return;
    }
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "mb-seasons: H5 failed, trying BFF");
  }

  try {
    const info = await bffGetSeasonInfo(subjectId);
    if (info) {
      res.json(formatSeasons(info));
      return;
    }
    res.status(404).json({ error: "Season info not found" });
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "mb-seasons: BFF fallback also failed");
    res.status(500).json({ error: "Failed to fetch season info" });
  }
});

router.get("/stream/mb-languages", async (req: Request, res: Response) => {
  let { title, year, type, season, episode, subjectId } = req.query as Record<string, string>;

  let dubs: BffDubEntry[] = [];
  let derivedTitle = title;
  let derivedType = type;

  if (subjectId) {
    logger.info({ subjectId }, "mb-languages: fetching dubs from subjectId");
    let gotDetail = false;
    try {
      const h5Detail = await h5GetSubjectDetail(subjectId);
      if (h5Detail) {
        gotDetail = true;
        if (Array.isArray(h5Detail.dubs) && h5Detail.dubs.length > 0) {
          dubs = h5Detail.dubs as BffDubEntry[];
        }
        if (!derivedTitle && h5Detail.title) {
          derivedTitle = String(h5Detail.title);
        }
        if (!derivedType && h5Detail.subjectType !== undefined) {
          derivedType = Number(h5Detail.subjectType) !== 1 ? "tv" : "movie";
        }
      }
    } catch (err) {
      logger.warn({ err: String(err), subjectId }, "mb-languages: H5 failed, trying BFF");
    }
    if (!gotDetail) {
      try {
        const detail = await bffGetSubjectDetail(subjectId);
        if (detail) {
          if (detail.dubs && detail.dubs.length > 0) {
            dubs = [...detail.dubs];
          }
          if (!derivedTitle && detail.title) {
            derivedTitle = detail.title;
          }
          if (!derivedType && detail.subjectType !== undefined) {
            derivedType = detail.subjectType !== 1 ? "tv" : "movie";
          }
        }
      } catch (err) {
        logger.error({ err: String(err), subjectId }, "mb-languages: BFF fallback also failed");
      }
    }
  }

  if (!derivedTitle || !derivedType) {
    res.json({ dubs, languages: [] });
    return;
  }

  logger.info({ title: derivedTitle, year, type: derivedType, season, episode, hasDubs: dubs.length }, "mb-languages: probing for additional languages");
  try {
    const cleanTitle = derivedTitle
      .replace(/\s*S\d+\s*[·.]\s*E\d+$/i, "")
      .replace(/\s*S\d+E\d+$/i, "")
      .trim();
    for (const dub of dubs) {
      if (!dub.original) {
        dub.lanName = displayLangName(dub.lanName, dub.lanCode);
      }
    }
    const existingLangNames = dubs.map((d) => ({ name: d.lanName, detailPath: "", subjectId: d.subjectId }));
    const languages = await probeLanguageVariants(cleanTitle, year, derivedType, season, episode, existingLangNames);
    const seenSubjectIds = new Set(dubs.map((d) => d.subjectId));
    const seenNormKeys = new Set(dubs.map((d) => normalizeLangKey(d.lanName)));
    for (const lang of languages) {
      if (seenSubjectIds.has(lang.subjectId)) continue;
      const normKey = normalizeLangKey(lang.name);
      if (seenNormKeys.has(normKey)) continue;
      seenNormKeys.add(normKey);
      const probeLanCode = lang.name.toLowerCase().slice(0, 3);
      dubs.push({
        subjectId: lang.subjectId,
        lanName: displayLangName(lang.name, probeLanCode),
        lanCode: probeLanCode,
        original: false,
      });
    }
    logger.info({ title: derivedTitle, totalDubs: dubs.length, probed: languages.length }, "mb-languages: merged probe results");
    res.json({ dubs, languages: [] });
  } catch (err) {
    logger.error({ err: String(err), title: derivedTitle }, "mb-languages error");
    res.json({ dubs, languages: [] });
  }
});

router.get("/stream/mb-play-info", async (req: Request, res: Response) => {
  const { subjectId, se, ep, resolution } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  try {
    const info = await bffGetPlayInfo(
      subjectId,
      parseInt(se || "0", 10),
      parseInt(ep || "0", 10),
      parseInt(resolution || "1080", 10),
    );
    if (!info) {
      res.status(404).json({ error: "Play info not found" });
      return;
    }
    res.json(info);
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "mb-play-info error");
    res.status(500).json({ error: "Failed to fetch play info" });
  }
});

router.get("/stream/mb-subtitles", async (req: Request, res: Response) => {
  const { subjectId } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  try {
    const subs = await bffSearchSubtitles(subjectId);
    res.json({ subtitles: subs });
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "mb-subtitles error");
    res.status(500).json({ error: "Failed to fetch subtitles" });
  }
});

router.get("/stream/mb-resource", async (req: Request, res: Response) => {
  const { subjectId, title } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  try {
    const result = await bffGetResourceFromSearch(subjectId, title || undefined);
    res.json(result);
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "mb-resource error");
    res.status(500).json({ error: "Failed to fetch resource" });
  }
});

router.get("/stream/mb-auth-status", async (_req: Request, res: Response) => {
  try {
    const token = await bffEmailLogin();
    if (token) {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString(),
      );
      res.json({
        authenticated: true,
        userId: String(payload.uid || ""),
        userType: payload.utp,
        expiresAt: new Date((payload.exp || 0) * 1000).toISOString(),
      });
    } else {
      res.json({ authenticated: false, reason: "Credentials not set" });
    }
  } catch (err) {
    res.json({ authenticated: false, reason: "Login failed" });
  }
});

router.get("/stream/proxy", async (req: Request, res: Response) => {
  const rawUrl = req.query.url as string;
  if (!rawUrl) {
    res.status(400).send("Missing url parameter");
    return;
  }
  let url: string;
  try {
    url = decodeURIComponent(rawUrl);
  } catch {
    res.status(400).send("Invalid url");
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      res.status(403).send("Only HTTPS allowed");
      return;
    }
    const hostname = parsed.hostname.toLowerCase();
    const PROXY_ALLOWED_DOMAINS = [
      "hakunaymatata.com", "aoneroom.com", "moviebox.ph", "moviebox.pk",
      "moviebox.id", "moviebox.ng", "movieboxapp.in",
    ];
    const allowed = PROXY_ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    if (!allowed) {
      res.status(403).send("Domain not allowed");
      return;
    }
  } catch {
    res.status(400).send("Invalid URL format");
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  try {
    const fetchHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Referer": "https://videodownloader.site/",
      "Origin": "https://videodownloader.site",
    };
    const rangeRaw = req.headers["range"];
    if (rangeRaw) fetchHeaders["Range"] = Array.isArray(rangeRaw) ? rangeRaw[0] : rangeRaw;

    let upstream: globalThis.Response;

    if (useCfProxy) {
      const cfStreamUrl = `${CF_MOVIEBOX_PROXY_URL}/stream?url=${encodeURIComponent(url)}`;
      const cfHeaders: Record<string, string> = { ...fetchHeaders };
      if (CF_MOVIEBOX_API_KEY) cfHeaders["X-Api-Key"] = CF_MOVIEBOX_API_KEY;
      upstream = await fetch(cfStreamUrl, { headers: cfHeaders, redirect: "follow" });
      logger.info({ status: upstream.status, url: url.slice(0, 80) }, "CF Worker stream proxy");
    } else {
      const isAllowedHost = (u: string) => {
        try {
          const h = new URL(u).hostname.toLowerCase();
          const ALLOWED = ["hakunaymatata.com", "aoneroom.com", "moviebox.ph", "moviebox.pk", "moviebox.id", "moviebox.ng", "movieboxapp.in"];
          return ALLOWED.some(d => h === d || h.endsWith(`.${d}`));
        } catch { return false; }
      };

      let currentUrl = url;
      let redirectCount = 0;
      while (true) {
        const resp = await fetch(currentUrl, {
          headers: fetchHeaders,
          redirect: "manual",
        });
        if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
          redirectCount++;
          if (redirectCount > 5) throw new Error("Too many redirects");
          const loc = resp.headers.get("location")!;
          const nextUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
          if (!isAllowedHost(nextUrl)) {
            res.status(403).send("Redirect to disallowed domain");
            return;
          }
          currentUrl = nextUrl;
          continue;
        }
        upstream = resp;
        break;
      }
    }

    const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();
    res.status(upstream.status);
    res.setHeader("Content-Type", ct || "application/octet-stream");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);
    res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
    if (upstream.body) {
      const reader = upstream.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          if (!res.write(value)) {
            await new Promise<void>(resolve => res.once("drain", resolve));
          }
        }
      };
      res.on("close", () => reader.cancel());
      await pump();
    } else {
      res.end();
    }
  } catch (err) {
    logger.error({ err: String(err), url }, "proxy error");
    if (!res.headersSent) res.status(502).send("Upstream error");
  }
});

export default router;
