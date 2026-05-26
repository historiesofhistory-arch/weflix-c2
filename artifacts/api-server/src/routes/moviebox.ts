import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const H5_DIRECT_URL = "https://h5-api.aoneroom.com";

const DEFAULT_HEADERS: Record<string, string> = {
  "X-Client-Info": '{"timezone":"Asia/Kolkata"}',
  "Accept-Language": "en-US,en;q=0.5",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
  Referer: "https://videodownloader.site/",
};

async function mbGet(path: string): Promise<Record<string, unknown>> {
  const url = `${H5_DIRECT_URL}${path}`;
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`H5 API returned ${resp.status} for GET ${path}`);
    }
    const text = await resp.text();
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function mbPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${H5_DIRECT_URL}${path}`;
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    "Content-Type": "application/json",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`H5 API returned ${resp.status} for POST ${path}`);
    }
    const text = await resp.text();
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/mb/search", async (req: Request, res: Response) => {
  const { q, page } = req.query as Record<string, string>;
  if (!q) {
    res.status(400).json({ error: "q (query) is required" });
    return;
  }
  try {
    const p = page || "1";
    const data = await mbPost("/wefeed-h5api-bff/subject/search", {
      keyword: q,
      page: parseInt(p, 10),
      perPage: 20,
    });
    res.json(data);
  } catch (err) {
    logger.error({ err: String(err) }, "MovieBox search error");
    res.status(502).json({ error: "MovieBox API error" });
  }
});

router.get("/mb/search-suggest", async (req: Request, res: Response) => {
  const { q } = req.query as Record<string, string>;
  if (!q) {
    res.status(400).json({ error: "q (query) is required" });
    return;
  }
  try {
    const data = await mbPost("/wefeed-h5api-bff/subject/search-suggest", {
      keyword: q,
    });
    res.json(data);
  } catch (err) {
    logger.error({ err: String(err) }, "MovieBox search-suggest error");
    res.status(502).json({ error: "MovieBox API error" });
  }
});

router.get("/mb/detail", async (req: Request, res: Response) => {
  const { detailPath } = req.query as Record<string, string>;
  if (!detailPath) {
    res.status(400).json({ error: "detailPath is required" });
    return;
  }
  try {
    const data = await mbGet(
      `/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`
    );
    res.json(data);
  } catch (err) {
    logger.error({ err: String(err) }, "MovieBox detail error");
    res.status(502).json({ error: "MovieBox API error" });
  }
});

let homeCache: { data: Record<string, unknown>; ts: number } | null = null;
const HOME_CACHE_TTL = 3 * 60 * 1000;

router.get("/mb/home", async (_req: Request, res: Response) => {
  try {
    if (homeCache && Date.now() - homeCache.ts < HOME_CACHE_TTL) {
      res.json(homeCache.data);
      return;
    }
    const data = await mbGet(`/wefeed-h5api-bff/home?host=moviebox.ph`);
    homeCache = { data, ts: Date.now() };
    res.json(data);
  } catch (err) {
    if (homeCache) {
      res.json(homeCache.data);
      return;
    }
    logger.error({ err: String(err) }, "MovieBox home error");
    res.status(502).json({ error: "MovieBox API error" });
  }
});

const ALLOWED_STREAM_DOMAINS = new Set([
  "hakunaymatata.com",
  "aoneroom.com",
  "moviebox.ph",
  "moviebox.pk",
  "moviebox.id",
  "moviebox.ng",
  "movieboxapp.in",
  "fmoviesunblocked.net",
  "sflix.film",
  "netnaija.video",
  "netnaija.com",
  "videodownloader.site",
]);

function isAllowedStreamHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  for (const domain of ALLOWED_STREAM_DOMAINS) {
    if (lower === domain || lower.endsWith(`.${domain}`)) return true;
  }
  return false;
}

router.get("/mb/play", async (req: Request, res: Response) => {
  const { subjectId, resolution, se, ep } = req.query as Record<string, string>;
  if (!subjectId) {
    res.status(400).json({ error: "subjectId is required" });
    return;
  }
  try {
    const qs = new URLSearchParams({ subjectId });
    qs.set("resolution", resolution || "1080");
    if (se) qs.set("se", se);
    if (ep) qs.set("ep", ep);
    const data = await mbGet(`/wefeed-h5api-bff/subject/play?${qs.toString()}`);
    res.json(data);
  } catch (err) {
    logger.error({ err: String(err) }, "MovieBox H5 play error");
    res.status(502).json({ error: "MovieBox API error" });
  }
});

router.get("/mb/stream", async (req: Request, res: Response) => {
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

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).send("Invalid URL format");
    return;
  }

  if (parsedUrl.protocol !== "https:") {
    res.status(400).send("Only HTTPS URLs are allowed");
    return;
  }

  if (!isAllowedStreamHost(parsedUrl.hostname)) {
    logger.warn({ hostname: parsedUrl.hostname, url }, "Blocked disallowed stream host");
    res.status(403).send("Host not allowed");
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  try {
    const upstreamHeaders: Record<string, string> = { Accept: "*/*" };
    const rangeHeader = req.headers["range"];
    if (typeof rangeHeader === "string") upstreamHeaders["Range"] = rangeHeader;
    const ifRangeHeader = req.headers["if-range"];
    if (typeof ifRangeHeader === "string") upstreamHeaders["If-Range"] = ifRangeHeader;

    const upstream = await fetch(url, { headers: upstreamHeaders });
    res.status(upstream.status);

    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) res.setHeader("Accept-Ranges", ar);
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);

    if (upstream.body) {
      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        return pump();
      };
      await pump();
    } else {
      res.end();
    }
  } catch (err) {
    logger.error({ err: String(err), url }, "Stream proxy error");
    if (!res.headersSent) res.status(502).send("Upstream error");
  }
});

export default router;
