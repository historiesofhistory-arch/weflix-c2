const MB_H5_HOST = "h5-api.aoneroom.com";
const MB_BFF_HOST = "api3.aoneroom.com";
const REFERER = "https://videodownloader.site/";

const DEFAULT_H5_HEADERS = {
  "X-Client-Info": '{"timezone":"Africa/Nairobi"}',
  "Accept-Language": "en-US,en;q=0.5",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
  Referer: REFERER,
};

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

function isAllowedStreamHost(hostname) {
  const lower = hostname.toLowerCase();
  for (const domain of ALLOWED_STREAM_DOMAINS) {
    if (lower === domain || lower.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, Range, If-Range, x-tr-signature, X-Client-Token",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}

const USER_AGENT_MAP = {
  [MB_BFF_HOST]: "okhttp/3.12.0",
  [MB_H5_HOST]: "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
};

async function proxyPassthrough(targetHost, backendPath, request) {
  const url = `https://${targetHost}${backendPath}`;
  const headers = {};
  headers["User-Agent"] = USER_AGENT_MAP[targetHost] || "okhttp/3.12.0";

  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "cf-connecting-ip" ||
      lower === "cf-ipcountry" ||
      lower === "cf-ray" ||
      lower === "cf-visitor" ||
      lower === "x-forwarded-for" ||
      lower === "x-forwarded-proto" ||
      lower === "x-real-ip" ||
      lower === "x-api-key" ||
      lower === "connection" ||
      lower === "accept-encoding" ||
      lower === "user-agent"
    ) continue;
    headers[key] = value;
  }

  if (targetHost === MB_BFF_HOST) {
    headers["X-Client-Info"] = '{"timezone":"Asia/Kolkata"}';
    headers["Accept-Language"] = "en-IN,en;q=0.9,hi;q=0.8";
  }

  const init = {
    method: request.method,
    headers,
  };

  if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
    init.body = await request.text();
  }

  const resp = await fetch(url, init);

  const responseHeaders = { ...corsHeaders() };
  const ct = resp.headers.get("content-type");
  if (ct) responseHeaders["Content-Type"] = ct;

  let status = resp.status;
  if (status === 407) status = 401;

  return new Response(resp.body, {
    status,
    headers: responseHeaders,
  });
}

async function handleStreamProxy(targetUrl, request) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return errorResponse("Invalid URL format", 400);
  }

  if (parsed.protocol !== "https:") {
    return errorResponse("Only HTTPS URLs are allowed", 400);
  }

  if (!isAllowedStreamHost(parsed.hostname)) {
    return errorResponse("Host not allowed", 403);
  }

  const headers = {
    Accept: "*/*",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
    Origin: REFERER,
    Referer: REFERER,
  };

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) headers["Range"] = rangeHeader;
  const ifRangeHeader = request.headers.get("if-range");
  if (ifRangeHeader) headers["If-Range"] = ifRangeHeader;

  const upstream = await fetch(targetUrl, {
    headers,
    cf: {
      cacheEverything: true,
      cacheTtl: 3600,
    },
  });

  const responseHeaders = { ...corsHeaders() };
  const ct = upstream.headers.get("content-type");
  if (ct) responseHeaders["Content-Type"] = ct;
  const cl = upstream.headers.get("content-length");
  if (cl) responseHeaders["Content-Length"] = cl;
  const ar = upstream.headers.get("accept-ranges");
  if (ar) responseHeaders["Accept-Ranges"] = ar;
  const cr = upstream.headers.get("content-range");
  if (cr) responseHeaders["Content-Range"] = cr;
  responseHeaders["Cache-Control"] = "public, max-age=3600";

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const apiKey = env.API_KEY;
    const needsAuth = path.startsWith("/bff/") || path.startsWith("/h5/");
    if (needsAuth && apiKey) {
      const provided = request.headers.get("x-api-key");
      if (provided !== apiKey) {
        return errorResponse("Unauthorized", 401);
      }
    }

    if (path.startsWith("/bff/")) {
      const backendPath = path.slice(4) + url.search;
      return proxyPassthrough(MB_BFF_HOST, backendPath, request);
    }

    if (path.startsWith("/h5/")) {
      const backendPath = path.slice(3) + url.search;
      return proxyPassthrough(MB_H5_HOST, backendPath, request);
    }

    if (request.method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    if (path === "/search") {
      const q = url.searchParams.get("q");
      if (!q) return errorResponse("q (query) is required", 400);
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const perPage = parseInt(url.searchParams.get("perPage") || "20", 10);
      const body = JSON.stringify({ keyword: q, page, perPage });
      const resp = await fetch(`https://${MB_H5_HOST}/wefeed-h5api-bff/subject/search`, {
        method: "POST",
        headers: { ...DEFAULT_H5_HEADERS, Accept: "application/json", "Content-Type": "application/json" },
        body,
      });
      if (!resp.ok) return errorResponse(`MovieBox API returned ${resp.status}`, 502);
      const data = await resp.json();
      return jsonResponse(data);
    }

    if (path === "/search-suggest") {
      const q = url.searchParams.get("q");
      if (!q) return errorResponse("q (query) is required", 400);
      const body = JSON.stringify({ keyword: q });
      const resp = await fetch(`https://${MB_H5_HOST}/wefeed-h5api-bff/subject/search-suggest`, {
        method: "POST",
        headers: { ...DEFAULT_H5_HEADERS, Accept: "application/json", "Content-Type": "application/json" },
        body,
      });
      if (!resp.ok) return errorResponse(`MovieBox API returned ${resp.status}`, 502);
      const data = await resp.json();
      return jsonResponse(data);
    }

    if (path === "/detail") {
      const detailPath = url.searchParams.get("detailPath");
      if (!detailPath) return errorResponse("detailPath is required", 400);
      const resp = await fetch(`https://${MB_H5_HOST}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`, {
        headers: { ...DEFAULT_H5_HEADERS, Accept: "application/json" },
      });
      if (!resp.ok) return errorResponse(`MovieBox API returned ${resp.status}`, 502);
      const data = await resp.json();
      return jsonResponse(data);
    }

    if (path === "/home") {
      const page = url.searchParams.get("page") || "1";
      const resp = await fetch(`https://${MB_H5_HOST}/wefeed-h5api-bff/home?host=moviebox.ph&page=${page}`, {
        headers: { ...DEFAULT_H5_HEADERS, Accept: "application/json" },
      });
      if (!resp.ok) return errorResponse(`MovieBox API returned ${resp.status}`, 502);
      const data = await resp.json();
      return jsonResponse(data);
    }

    if (path === "/play") {
      const subjectId = url.searchParams.get("subjectId");
      if (!subjectId) return errorResponse("subjectId is required", 400);
      const resolution = url.searchParams.get("resolution") || "1080";
      const se = url.searchParams.get("se") || "0";
      const ep = url.searchParams.get("ep") || "0";
      const resp = await fetch(
        `https://${MB_H5_HOST}/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(subjectId)}&resolution=${resolution}&se=${se}&ep=${ep}`,
        { headers: { ...DEFAULT_H5_HEADERS, Accept: "application/json" } }
      );
      if (!resp.ok) return errorResponse(`MovieBox API returned ${resp.status}`, 502);
      const data = await resp.json();
      return jsonResponse(data);
    }

    if (path === "/stream") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return errorResponse("Missing url parameter", 400);
      let decoded;
      try {
        decoded = decodeURIComponent(targetUrl);
      } catch {
        return errorResponse("Invalid url", 400);
      }
      return handleStreamProxy(decoded, request);
    }

    if (path === "/health") {
      return jsonResponse({ status: "ok", service: "moviebox-proxy" });
    }

    if (path === "/diag") {
      try {
        const start = Date.now();
        const testResp = await fetch(`https://${MB_BFF_HOST}/wefeed-mobile-bff/subject-api/get?subjectId=74738785354956752`, {
          headers: {
            "User-Agent": "okhttp/3.12.0",
            "X-Client-Info": '{"timezone":"Asia/Kolkata"}',
            "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
            Accept: "application/json",
          },
        });
        const elapsed = Date.now() - start;
        const body = await testResp.text();
        const code = JSON.parse(body)?.code;
        return jsonResponse({
          bffReachable: testResp.status !== 403 && code !== 403,
          upstreamStatus: testResp.status,
          bffCode: code,
          latency: elapsed + "ms",
          colo: request.cf?.colo || "unknown",
        });
      } catch (err) {
        return jsonResponse({ bffReachable: false, error: String(err).slice(0, 200), colo: request.cf?.colo || "unknown" }, 502);
      }
    }

    return errorResponse("Not found", 404);
  },
};
