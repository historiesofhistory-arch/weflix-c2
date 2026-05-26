import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getVidLinkStream, rewriteM3u8, fetchUpstream } from "../scrapers/vidlink";
import { getVidSrcStream } from "../scrapers/vidsrc";
import { resolveMovieBoxStream, resolveMovieBoxLanguageStream, probeLanguageVariants, normalizeLangKey, displayLangName, h5GetPlayStreams } from "../scrapers/moviebox";
import { resolveImdbMetadata } from "../scrapers/imdb-lookup";
import {
  bffGetSubjectDetail,
  bffGetSeasonInfo,
  bffSearchSubtitles,
  bffGetStreamCaptions,
  bffGetExtCaptions,
  bffSearch,
  bffEmailLogin,
  bffGetResourceFromSearch,
  bffGetPlayInfo,
  bffGetHomeFeed,
  h5SearchFallback,
  h5HomeFallback,
  h5HomeViaCfWorker,
  signRequest,
  makeClientToken,
  getBffAuthToken,
  useCfProxy,
  CF_MOVIEBOX_PROXY_URL,
  CF_MOVIEBOX_API_KEY,
  type BffDubEntry,
} from "../scrapers/moviebox-bff";

const router: IRouter = Router();

const STREAM_PROXY_URL = process.env.STREAM_PROXY_URL || process.env.CF_STREAM_PROXY_URL || "";
const SUBTITLE_PROXY_URL = process.env.SUBTITLE_PROXY_URL || process.env.CF_SUBTITLE_PROXY_URL || "";
// Mode switch — pick which proxy to use without deleting URLs.
//   "cf"   → use the external Cloudflare Worker URL (requires *_PROXY_URL set)
//   "self" → use this server's own /api/stream/proxy (eats Koyeb bandwidth)
// Default: "cf" if the corresponding *_PROXY_URL is set, else "self".
function resolveMode(envValue: string | undefined, hasUrl: boolean): "cf" | "self" {
  const v = (envValue ?? "").toLowerCase().trim();
  if (v === "cf" || v === "self") return v;
  return hasUrl ? "cf" : "self";
}
const STREAM_PROXY_MODE = resolveMode(process.env.STREAM_PROXY_MODE, !!STREAM_PROXY_URL);
const SUBTITLE_PROXY_MODE = resolveMode(process.env.SUBTITLE_PROXY_MODE, !!SUBTITLE_PROXY_URL);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function getServerProxyBase(req: Request): string {
  if (STREAM_PROXY_MODE === "cf" && STREAM_PROXY_URL) {
    return STREAM_PROXY_URL;
  }
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  return `${proto}://${host}/api/stream/proxy`;
}

function wrapSubtitleUrls<T extends { url?: string }>(subs: T[] | undefined, req?: Request): T[] {
  if (!subs || subs.length === 0) return subs || [];
  // Subtitle CDNs (pbcdn.aoneroom.com, etc) don't send CORS headers, so the
  // browser cannot fetch SRT/VTT files directly via Vidstack <Track>. Always
  // route through a proxy (CF Worker or self) which sets CORS headers.
  let base = "";
  if (SUBTITLE_PROXY_MODE === "cf" && SUBTITLE_PROXY_URL) {
    base = SUBTITLE_PROXY_URL.replace(/\/+$/, "");
  } else if (req) {
    // self mode — use this server's own /api/stream/proxy
    const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
    base = `${proto}://${host}/api/stream/proxy`;
  }
  if (!base) return subs;
  return subs.map((s) => {
    if (!s.url || typeof s.url !== "string" || !s.url.startsWith("http")) return s;
    if (s.url.startsWith(base)) return s;
    return { ...s, url: `${base}?url=${encodeURIComponent(s.url)}` };
  });
}

const bffPlayHealth = {
  failures: 0,
  lastFailure: 0,
  threshold: 5,
  cooldownMs: 30000,
  isHealthy(): boolean {
    if (this.failures < this.threshold) return true;
    if (Date.now() - this.lastFailure > this.cooldownMs) {
      this.failures = 0;
      return true;
    }
    return false;
  },
  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  },
  recordSuccess(): void {
    this.failures = 0;
  },
};

const EMBED_VIDLINK = {
  movie: (id: string) =>
    `https://vidlink.pro/movie/${id}?primaryColor=c45454&secondaryColor=a2a2a2&autoplay=true`,
  tv: (id: string, s: string, e: string) =>
    `https://vidlink.pro/tv/${id}/${s}/${e}?primaryColor=c45454&secondaryColor=a2a2a2&autoplay=true`,
};
const EMBED_VIDSRC = {
  movie: (id: string) => `https://vidsrc.cc/v2/embed/movie/${id}?autoPlay=true`,
  tv: (id: string, s: string, e: string) =>
    `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}?autoPlay=true`,
};

function getProxyBase(req: Request): string {
  if (STREAM_PROXY_MODE === "cf" && STREAM_PROXY_URL) {
    return STREAM_PROXY_URL;
  }
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  return `${proto}://${host}/api/stream/proxy`;
}

const ALLOWED_BFF_PATHS = new Set([
  "/wefeed-mobile-bff/tab-operating",
  "/wefeed-mobile-bff/subject-api/home",
  "/wefeed-mobile-bff/subject-api/search",
  "/wefeed-mobile-bff/subject-api/get",
  "/wefeed-mobile-bff/subject-api/subject-detail",
  "/wefeed-mobile-bff/subject-api/season-info",
  "/wefeed-mobile-bff/subject-api/subtitle-search",
  "/wefeed-mobile-bff/subject-api/play-info",
  "/wefeed-mobile-bff/subject-api/resource",
  "/wefeed-mobile-bff/subject-api/get-stream-captions",
  "/wefeed-mobile-bff/subject-api/get-ext-captions",
]);

router.all("/bff-sign", async (req: Request, res: Response) => {
  const { path, query, method: reqMethod, body: reqBody } = req.method === "POST"
    ? { ...req.query as Record<string, string>, method: (req.body?.method || "POST") as string, body: (req.body?.body || "") as string }
    : { ...req.query as Record<string, string>, method: "GET", body: "" };
  if (!path) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  if (!ALLOWED_BFF_PATHS.has(path)) {
    res.status(403).json({ error: "path not allowed" });
    return;
  }
  try {
    const sig = signRequest(reqMethod, path, query || "", reqBody);
    const clientToken = makeClientToken();
    let authToken: string | null = null;
    try {
      let timer: ReturnType<typeof setTimeout>;
      authToken = await Promise.race([
        getBffAuthToken().then((t) => { clearTimeout(timer); return t; }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            logger.info("bff-sign: auth token retrieval timed out after 3s, returning without auth");
            resolve(null);
          }, 3000);
        }),
      ]);
    } catch {
    }
    const baseUrl = useCfProxy
      ? CF_MOVIEBOX_PROXY_URL + "/bff"
      : "https://api3.aoneroom.com";
    res.json({
      authReady: !!authToken,
      method: reqMethod,
      headers: {
        "x-tr-signature": sig,
        "X-Client-Token": clientToken,
        Accept: "application/json",
        "User-Agent": "okhttp/4.9.3",
        ...(reqBody ? { "Content-Type": "application/json" } : {}),
        ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
        ...(useCfProxy && CF_MOVIEBOX_API_KEY ? { "X-Api-Key": CF_MOVIEBOX_API_KEY } : {}),
      },
      url: baseUrl + (query ? path + "?" + query : path),
      ...(reqBody ? { body: reqBody } : {}),
    });
  } catch (err) {
    logger.error({ err: String(err) }, "bff-sign error");
    res.status(500).json({ error: "signing failed" });
  }
});

router.get("/stream/source", async (req: Request, res: Response) => {
  const { type, id, season, episode, title, year, overview, countries, genres, cast } = req.query as Record<string, string>;

  if (!type || !id) {
    res.status(400).json({ error: "type and id are required" });
    return;
  }
  if (type === "tv" && (!season || !episode)) {
    res.status(400).json({ error: "season and episode required for tv" });
    return;
  }

  const proxyBase = getProxyBase(req);

  try {
    const cleanTitle = title
      ? title
          .replace(/\s*S\d+\s*[·.]\s*E\d+$/i, "")
          .replace(/\s*S\d+E\d+$/i, "")
          .trim()
      : "";
    logger.info({ type, id, title: cleanTitle || "(no title)", year, season, episode }, "trying MovieBox first");
    const tmdbCountries = countries ? countries.split(",").filter(Boolean) : undefined;
    const tmdbGenres = genres ? genres.split(",").filter(Boolean) : undefined;
    const tmdbCast = cast ? cast.split(",").filter(Boolean) : undefined;
    const mbResult = await resolveMovieBoxStream(cleanTitle, year, type, season, episode, overview || undefined, id, tmdbCountries, tmdbGenres, tmdbCast);
    if (mbResult && mbResult.streams.length > 0) {
      logger.info(
        { type, id, source: "moviebox", streams: mbResult.streams.length, dubs: mbResult.dubs?.length || 0 },
        "MovieBox resolved"
      );
      const mbResponse: Record<string, unknown> = {
        source: "moviebox",
        type: "mp4",
        streams: mbResult.streams,
        languages: mbResult.languages,
        dubs: mbResult.dubs || [],
        currentSubjectId: mbResult.currentSubjectId || "",
        proxyBase: getServerProxyBase(req),
      };
      if (mbResult.remappedSeason !== undefined) {
        mbResponse.remappedSeason = mbResult.remappedSeason;
        mbResponse.remappedEpisode = mbResult.remappedEpisode;
      }
      if (mbResult.subtitles && mbResult.subtitles.length > 0) {
        mbResponse.subtitles = wrapSubtitleUrls(mbResult.subtitles, req);
      }
      if (mbResult.imdbId) mbResponse.imdbId = mbResult.imdbId;
      if (mbResult.imdbTitle) mbResponse.imdbTitle = mbResult.imdbTitle;
      if (mbResult.imdbRating) mbResponse.imdbRating = mbResult.imdbRating;
      res.json(mbResponse);
      return;
    }
  } catch (mbErr) {
    logger.warn({ err: String(mbErr) }, "MovieBox failed, trying VidLink");
  }

  try {
    logger.info({ type, id, season, episode }, "scraping VidLink stream");
    const playlist = await getVidLinkStream(id, season, episode);
    const proxiedUrl = `${proxyBase}?url=${encodeURIComponent(playlist)}`;
    logger.info({ type, id, source: "vidlink-hls" }, "VidLink HLS resolved");
    res.json({
      source: "vidlink-hls",
      streamUrl: proxiedUrl,
      type: "hls",
    });
    return;
  } catch (vidlinkErr) {
    logger.warn({ err: String(vidlinkErr) }, "VidLink scrape failed, trying VidSrc");
  }

  try {
    logger.info({ type, id, season, episode }, "scraping VidSrc stream");
    const stream = await getVidSrcStream(id, season, episode);
    if (stream) {
      const proxiedUrl = `${proxyBase}?url=${encodeURIComponent(stream)}`;
      logger.info({ type, id, source: "vidsrc-hls" }, "VidSrc HLS resolved");
      res.json({
        source: "vidsrc-hls",
        streamUrl: proxiedUrl,
        type: "hls",
      });
      return;
    }
  } catch (vidsrcErr) {
    logger.warn({ err: String(vidsrcErr) }, "VidSrc scrape failed, falling back to embed");
  }

  logger.info({ type, id }, "All scrapers failed, using embed fallback");
  const embedUrl =
    type === "movie"
      ? EMBED_VIDLINK.movie(id)
      : EMBED_VIDLINK.tv(id, season, episode);
  const fallbackUrl =
    type === "movie"
      ? EMBED_VIDSRC.movie(id)
      : EMBED_VIDSRC.tv(id, season, episode);

  res.json({
    source: "embed",
    embedUrl,
    fallbackUrl,
    type: "embed",
  });
});

const mbStreamCache = new Map<string, { data: Record<string, unknown>; ts: number }>();
const MB_STREAM_CACHE_TTL = 120_000;

function getMbStreamCached(key: string): Record<string, unknown> | null {
  const entry = mbStreamCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > MB_STREAM_CACHE_TTL) {
    mbStreamCache.delete(key);
    return null;
  }
  return entry.data;
}

function setMbStreamCache(key: string, data: Record<string, unknown>) {
  mbStreamCache.set(key, { data, ts: Date.now() });
  if (mbStreamCache.size > 200) {
    const oldest = mbStreamCache.keys().next().value;
    if (oldest) mbStreamCache.delete(oldest);
  }
}

router.get("/stream/mb-stream", async (req: Request, res: Response) => {
  const { subjectId, type, se, ep, title: titleParam } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  const seNum = parseInt(se || "0", 10);
  const epNum = parseInt(ep || "0", 10);
  const isTV = type === "tv";

  const cacheKey = `${type || "movie"}:${subjectId}:${seNum}:${epNum}`;
  const cached = getMbStreamCached(cacheKey);
  if (cached) {
    logger.info({ subjectId, cacheKey }, "mb-stream: serving from cache");
    res.json({ ...cached, proxyBase: getServerProxyBase(req) });
    return;
  }

  let actualSe = seNum;
  let actualEp = epNum;

  logger.info({ subjectId, type, se: actualSe, ep: actualEp }, "mb-stream: resolving stream");

  const currentSubjectId = subjectId;

  const detailPromise = bffGetSubjectDetail(subjectId).catch((err: unknown) => {
    logger.warn({ err: String(err), subjectId }, "mb-stream: detail fetch failed (non-blocking)");
    return null;
  });

  try {
    logger.info({ subjectId, se: actualSe, ep: actualEp }, "mb-stream: trying H5 play (primary)");
    const h5Streams = await h5GetPlayStreams(subjectId, actualSe, actualEp);

    if (h5Streams.length === 0 && actualSe === 0 && actualEp === 0) {
      const detail = await detailPromise;
      if (detail && detail.subjectType !== 1) {
        logger.info({ subjectId, subjectType: detail.subjectType }, "mb-stream: detected non-movie with se=0/ep=0, retrying H5 with se=1/ep=1");
        actualSe = 1;
        actualEp = 1;
        const retryStreams = await h5GetPlayStreams(subjectId, actualSe, actualEp);
        if (retryStreams.length > 0) h5Streams.push(...retryStreams);
      }
    }

    if (h5Streams.length > 0) {
      const normalizedStreams = h5Streams.map((s: Record<string, unknown>) => ({
        ...s,
        quality: String((s as any).quality || (s as any).resolutions || (s as any).resolution || 720),
      }));
      normalizedStreams.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        parseInt(String((a as any).quality), 10) - parseInt(String((b as any).quality), 10)
      );
      let dubs: BffDubEntry[] = [];
      let subs: Array<{ lan: string; lanName: string; url: string }> = [];
      const detailTimeout = Promise.race([
        detailPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 2000)),
      ]);
      try {
        const detail = await detailTimeout;
        if (detail?.dubs) dubs = detail.dubs;
      } catch {}
      // Primary caption sources (discovered via APK decompile of MovieBox
      // v3.0.13). The official player calls TWO endpoints in parallel and
      // unions the results — that's why their CC menu shows captions even
      // for episodes where one endpoint returns empty. We do the same:
      //   1. get-stream-captions  (keyed by streamId + subjectId + se/ep)
      //   2. get-ext-captions     (keyed by resourceId = streamId, + se/ep)
      // Either may be empty for a given episode; the union is what the app
      // shows. Captions are deduped by ISO language code, preferring the
      // first-seen URL (stream-captions usually has slightly cleaner names).
      const primaryStreamId = String(normalizedStreams[0]?.id || "");
      if (primaryStreamId) {
        try {
          const [streamCaps, extCaps] = await Promise.all([
            Promise.race([
              bffGetStreamCaptions(
                primaryStreamId,
                currentSubjectId || subjectId,
                actualSe,
                actualEp,
              ),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("stream-caps timeout")), 3500)),
            ]).catch(() => []),
            Promise.race([
              bffGetExtCaptions(primaryStreamId, actualSe, actualEp),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ext-caps timeout")), 3500)),
            ]).catch(() => []),
          ]);
          const seen = new Set<string>();
          const merged: Array<{ lan: string; lanName: string; url: string }> = [];
          for (const c of [...streamCaps, ...extCaps]) {
            const key = (c.lan || c.lanName || c.url).toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push({ lan: c.lan, lanName: c.lanName, url: c.url });
          }
          if (merged.length > 0) subs = merged;
        } catch {}
      }
      // Fallbacks if the new endpoint somehow returned empty.
      if (subs.length === 0) {
        try {
          subs = await Promise.race([
            bffSearchSubtitles(subjectId),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("sub timeout")), 2000)),
          ]);
        } catch {}
      }
      if (subs.length === 0) {
        try {
          const resResult = await Promise.race([
            bffGetResourceFromSearch(subjectId, titleParam || undefined),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("res-sub timeout")), 3000)),
          ]);
          if (resResult?.subtitles?.length > 0) subs = resResult.subtitles;
        } catch {}
      }
      logger.info({ subjectId, source: "h5-play", streams: normalizedStreams.length, dubs: dubs.length }, "mb-stream: resolved via H5 play");
      const resp: Record<string, unknown> = {
        source: "h5-play",
        type: "mp4",
        streams: normalizedStreams,
        dubs,
        currentSubjectId,
        proxyBase: getServerProxyBase(req),
      };
      if (subs.length > 0) resp.subtitles = wrapSubtitleUrls(subs, req);
      setMbStreamCache(cacheKey, resp);
      res.json(resp);
      return;
    }
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "mb-stream: H5 play failed");
  }

  const detail = await detailPromise;
  const dubs: BffDubEntry[] = detail?.dubs || [];

  if (bffPlayHealth.isHealthy()) {
    try {
      const playInfo = await bffGetPlayInfo(subjectId, actualSe, actualEp, 1080);
      if (playInfo && playInfo.streams.length > 0) {
        bffPlayHealth.recordSuccess();
        const normalizedStreams = playInfo.streams.map((s: Record<string, unknown>) => ({
          ...s,
          quality: String(s.quality || s.resolutions || s.resolution || 720),
        }));
        normalizedStreams.sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          parseInt(String(a.quality), 10) - parseInt(String(b.quality), 10)
        );
        logger.info({ subjectId, source: "bff-play-info", streams: normalizedStreams.length }, "mb-stream: resolved via BFF play-info fallback");
        const resp: Record<string, unknown> = {
          source: "bff-play-info",
          type: "mp4",
          streams: normalizedStreams,
          dubs,
          currentSubjectId,
          proxyBase: getServerProxyBase(req),
        };
        const subs = await bffSearchSubtitles(subjectId).catch(() => []);
        if (subs.length > 0) resp.subtitles = wrapSubtitleUrls(subs, req);
        setMbStreamCache(cacheKey, resp);
        res.json(resp);
        return;
      }
    } catch (err) {
      bffPlayHealth.recordFailure();
      logger.warn({ err: String(err), subjectId }, "mb-stream: BFF play-info fallback failed");
    }

    const titleHint = detail?.title || undefined;
    try {
      const resourceResult = await bffGetResourceFromSearch(subjectId, titleHint);
      if (resourceResult.streams.length > 0) {
        bffPlayHealth.recordSuccess();
        logger.info({ subjectId, source: "bff-resource-search", streams: resourceResult.streams.length }, "mb-stream: resolved via resource-search fallback");
        const resp: Record<string, unknown> = {
          source: "bff-resource-search",
          type: "mp4",
          streams: resourceResult.streams,
          dubs,
          currentSubjectId,
          proxyBase: getServerProxyBase(req),
        };
        if (resourceResult.subtitles.length > 0) resp.subtitles = wrapSubtitleUrls(resourceResult.subtitles, req);
        setMbStreamCache(cacheKey, resp);
        res.json(resp);
        return;
      }
    } catch (err) {
      bffPlayHealth.recordFailure();
      logger.warn({ err: String(err), subjectId }, "mb-stream: resource-search fallback failed");
    }
  } else {
    logger.info({ subjectId }, "mb-stream: BFF unhealthy, skipping BFF fallbacks");
  }

  logger.warn({ subjectId }, "mb-stream: all sources failed");
  res.status(404).json({ error: "No streams found" });
});

router.get("/stream/mb-play", async (req: Request, res: Response) => {
  const { detailPath, season, episode, subjectId } = req.query as Record<string, string>;
  if (!detailPath && !subjectId) {
    res.status(400).json({ error: "detailPath or subjectId is required" });
    return;
  }
  logger.info({ detailPath, subjectId, season, episode }, "mb-play: resolving language variant");
  try {
    const result = await resolveMovieBoxLanguageStream(
      detailPath || "", season, episode, subjectId
    );
    if (result && result.streams.length > 0) {
      logger.info({ detailPath, subjectId, streams: result.streams.length }, "mb-play: resolved");
      const resp: Record<string, unknown> = {
        type: "mp4",
        streams: result.streams,
        proxyBase: getServerProxyBase(req),
      };
      if (result.subtitles && result.subtitles.length > 0) {
        resp.subtitles = wrapSubtitleUrls(result.subtitles, req);
      }
      res.json(resp);
      return;
    }
    logger.warn({ detailPath, subjectId, season, episode }, "mb-play: no streams found");
    res.status(404).json({ error: "No streams found for this variant" });
  } catch (err) {
    logger.error({ err: String(err), detailPath, subjectId }, "mb-play error");
    res.status(500).json({ error: "Failed to resolve language variant" });
  }
});

router.get("/stream/mb-languages", async (req: Request, res: Response) => {
  let { title, year, type, season, episode, subjectId } = req.query as Record<string, string>;

  let dubs: BffDubEntry[] = [];
  let derivedTitle = title;
  let derivedType = type;

  if (subjectId) {
    logger.info({ subjectId }, "mb-languages: fetching dubs from subjectId");
    try {
      const detail = await bffGetSubjectDetail(subjectId);
      if (detail?.dubs && detail.dubs.length > 0) {
        dubs = [...detail.dubs];
      }
      if (!derivedTitle && detail?.title) {
        derivedTitle = detail.title;
      }
      if (!derivedType && detail?.subjectType !== undefined) {
        derivedType = detail.subjectType !== 1 ? "tv" : "movie";
      }
    } catch (err) {
      logger.error({ err: String(err), subjectId }, "mb-languages dubs error");
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
    logger.info({ dubCount: dubs.length }, "mb-languages: skipping dub validation (play-info blocked from datacenter)");
    logger.info({ title: derivedTitle, totalDubs: dubs.length, probed: languages.length }, "mb-languages: merged probe results");
    res.json({ dubs, languages: [] });
  } catch (err) {
    logger.error({ err: String(err), title: derivedTitle }, "mb-languages error");
    res.json({ dubs, languages: [] });
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
    const h5Result = await h5SearchFallback(q, pageNum);
    searchCache.set(cacheKey, { data: h5Result, ts: Date.now() });
    res.json(h5Result);
  } catch (h5Err) {
    logger.warn({ err: String(h5Err), q }, "H5 search failed, trying BFF fallback");
    try {
      const result = await bffSearch(q, pageNum);
      searchCache.set(cacheKey, { data: result, ts: Date.now() });
      res.json(result);
    } catch (bffErr) {
      if (cached) {
        logger.warn({ err: String(bffErr), q }, "BFF search also failed, serving stale cache");
        res.json(cached.data);
        return;
      }
      logger.error({ h5Err: String(h5Err), bffErr: String(bffErr), q }, "All search sources failed");
      res.status(502).json({ error: "Search failed" });
    }
  }
});

const BFF_HOME_CACHE_TTL = 3 * 60 * 1000;
const bffHomeCacheMap = new Map<string, { data: unknown; ts: number }>();

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

  if (useCfProxy) {
    try {
      const result = await h5HomeViaCfWorker(pageNum);
      bffHomeCacheMap.set(cacheKey, { data: result, ts: Date.now() });
      res.json(result);
      return;
    } catch (h5Err) {
      logger.warn({ err: String(h5Err), page: pageNum }, "H5 home via CF Worker failed (CF proxy mode), falling back to BFF");
    }
    try {
      const result = await bffGetHomeFeed(pageNum, tabNum);
      bffHomeCacheMap.set(cacheKey, { data: result, ts: Date.now() });
      res.json(result);
      return;
    } catch (bffErr) {
      if (cached) {
        logger.warn({ err: String(bffErr), page: pageNum }, "BFF home also failed in production, serving stale cache");
        res.json(cached.data);
        return;
      }
      logger.error({ err: String(bffErr), page: pageNum }, "All home feed sources failed in production");
      res.status(502).json({ error: "Home feed failed" });
    }
    return;
  }

  try {
    const h5Result = await h5HomeFallback(pageNum);
    bffHomeCacheMap.set(cacheKey, { data: h5Result, ts: Date.now() });
    res.json(h5Result);
  } catch (h5Err) {
    logger.warn({ err: String(h5Err), page: pageNum, tabId: tabNum }, "H5 home feed failed, trying BFF fallback");
    try {
      const result = await bffGetHomeFeed(pageNum, tabNum);
      bffHomeCacheMap.set(cacheKey, { data: result, ts: Date.now() });
      res.json(result);
    } catch (bffErr) {
      if (cached) {
        logger.warn({ err: String(bffErr) }, "BFF home also failed, serving stale cache");
        res.json(cached.data);
        return;
      }
      logger.error({ h5Err: String(h5Err), bffErr: String(bffErr) }, "All home feed sources failed");
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
  try {
    const detail = await bffGetSubjectDetail(subjectId, title || undefined);
    if (!detail) {
      res.status(404).json({ error: "Subject not found" });
      return;
    }
    res.json(detail);
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "mb-detail error");
    res.status(500).json({ error: "Failed to fetch subject detail" });
  }
});

router.get("/stream/mb-seasons", async (req: Request, res: Response) => {
  const { subjectId } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  try {
    const info = await bffGetSeasonInfo(subjectId);
    if (!info) {
      res.status(404).json({ error: "Season info not found" });
      return;
    }
    const seasons = (info.seasons || []).map((s) => {
      const maxEp = s.maxEp || 0;
      const episodes: { episodeNumber: number; name: string }[] = [];
      for (let i = 1; i <= maxEp; i++) {
        episodes.push({ episodeNumber: i, name: `Episode ${i}` });
      }
      return {
        seasonNumber: s.se,
        name: `Season ${s.se}`,
        episodes,
      };
    });
    res.json({ seasons });
  } catch (err) {
    logger.error({ err: String(err), subjectId }, "mb-seasons error");
    res.status(500).json({ error: "Failed to fetch season info" });
  }
});

router.get("/stream/mb-play-info", async (req: Request, res: Response) => {
  const { subjectId, se, ep, resolution } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  try {
    const { bffGetPlayInfo } = await import("../scrapers/moviebox-bff");
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
    res.json({ subtitles: wrapSubtitleUrls(subs, req) });
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
        expiresIn: Math.round(((payload.exp || 0) * 1000 - Date.now()) / 86400000) + " days",
      });
    } else {
      res.json({ authenticated: false, reason: "MOVIEBOX_EMAIL or MOVIEBOX_PASSWORD not set" });
    }
  } catch (err) {
    logger.error({ err: String(err) }, "mb-auth-status error");
    res.json({ authenticated: false, reason: "Login failed" });
  }
});

router.get("/stream/imdb", async (req: Request, res: Response) => {
  const { id, type } = req.query as Record<string, string>;
  if (!id) { res.status(400).json({ error: "Missing id" }); return; }
  try {
    const meta = await resolveImdbMetadata(id, type || "movie");
    if (!meta) { res.json({ found: false }); return; }
    res.json({
      found: true,
      imdbId: meta.imdbId,
      title: meta.title,
      year: meta.year,
      rating: meta.rating,
      votes: meta.votes,
      runtime: meta.runtime,
      genre: meta.genre,
      director: meta.director,
      actors: meta.actors,
    });
  } catch (err) {
    logger.error({ err: String(err) }, "imdb lookup error");
    res.json({ found: false });
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
      "moviebox.id", "moviebox.ng", "movieboxapp.in", "fmoviesunblocked.net",
      "sflix.film", "netnaija.video", "netnaija.com", "videodownloader.site",
    ];
    const allowed = PROXY_ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    if (!allowed) {
      logger.warn({ hostname, url: url.substring(0, 100) }, "proxy: blocked disallowed domain");
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
    const proxyBase = getProxyBase(req);
    const fetchHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
    };
    const rangeRaw = req.headers["range"];
    if (rangeRaw) fetchHeaders["Range"] = Array.isArray(rangeRaw) ? rangeRaw[0] : rangeRaw;
    const ifRangeRaw = req.headers["if-range"];
    if (ifRangeRaw) fetchHeaders["If-Range"] = Array.isArray(ifRangeRaw) ? ifRangeRaw[0] : ifRangeRaw;

    const isMovieBox = /hakunaymatata\.com|aoneroom\.com/i.test(url);
    if (isMovieBox) {
      fetchHeaders["Referer"] = "https://videodownloader.site/";
      fetchHeaders["Origin"] = "https://videodownloader.site";
    }
    logger.info({ url: url.substring(0, 80), isMovieBox, hasRange: !!rangeRaw }, "proxy: fetching upstream (native fetch)");

    const PROXY_ALLOWED_DOMAINS_SET = [
      "hakunaymatata.com", "aoneroom.com", "moviebox.ph", "moviebox.pk",
      "moviebox.id", "moviebox.ng", "movieboxapp.in", "fmoviesunblocked.net",
      "sflix.film", "netnaija.video", "netnaija.com", "videodownloader.site",
    ];
    const isAllowedHost = (u: string) => {
      try {
        const h = new URL(u).hostname.toLowerCase();
        return PROXY_ALLOWED_DOMAINS_SET.some(d => h === d || h.endsWith(`.${d}`));
      } catch { return false; }
    };

    let upstream: globalThis.Response;
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
          logger.warn({ redirect: nextUrl.substring(0, 100) }, "proxy: redirect to disallowed domain blocked");
          res.status(403).send("Redirect to disallowed domain");
          return;
        }
        currentUrl = nextUrl;
        continue;
      }
      upstream = resp;
      break;
    }

    const ct = (upstream.headers.get("content-type") ?? "").toLowerCase();
    if (upstream.status >= 400) {
      logger.warn({ url: url.substring(0, 80), status: upstream.status, isMovieBox }, "proxy: upstream error");
    }
    const isM3u8 =
      ct.includes("mpegurl") ||
      ct.includes("m3u8") ||
      /\.m3u8?(\?|$)/i.test(url.split("?")[0]);

    if (isM3u8) {
      const body = await upstream.text();
      const rewritten = rewriteM3u8(body, url, proxyBase);
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.end(rewritten);
    } else {
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
    }
  } catch (err) {
    logger.error({ err: String(err), url }, "proxy error");
    if (!res.headersSent) res.status(502).send("Upstream error");
  }
});

export default router;
