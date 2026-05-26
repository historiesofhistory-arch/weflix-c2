const ALLOWED_DOMAINS = [
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
];

function isAllowed(hostname) {
  const h = hostname.toLowerCase();
  return ALLOWED_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, If-Range",
    "Access-Control-Expose-Headers":
      "Content-Type, Content-Length, Content-Range, Accept-Ranges",
    "Access-Control-Max-Age": "86400",
  };
}

function rewriteM3u8(body, baseUrl, proxyOrigin) {
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed.startsWith("#EXT-X-MAP:")) {
          return trimmed.replace(
            /URI="([^"]+)"/,
            (_, uri) => {
              const abs = uri.startsWith("http")
                ? uri
                : new URL(uri, baseUrl).href;
              return `URI="${proxyOrigin}/?url=${encodeURIComponent(abs)}"`;
            },
          );
        }
        return line;
      }
      const abs = trimmed.startsWith("http")
        ? trimmed
        : new URL(trimmed, baseUrl).href;
      return `${proxyOrigin}/?url=${encodeURIComponent(abs)}`;
    })
    .join("\n");
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const rawTarget = url.searchParams.get("url");
    if (!rawTarget) {
      return new Response("Missing url param", { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = decodeURIComponent(rawTarget);
    } catch {
      return new Response("Invalid url param", { status: 400 });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return new Response("Invalid URL format", { status: 400 });
    }

    if (parsed.protocol !== "https:") {
      return new Response("Only HTTPS allowed", { status: 403 });
    }

    if (!isAllowed(parsed.hostname)) {
      return new Response("Domain not allowed", { status: 403 });
    }

    const proxyOrigin = url.origin;

    try {
      const fetchHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
      };

      const rangeHeader = request.headers.get("Range");
      if (rangeHeader) fetchHeaders["Range"] = rangeHeader;
      const ifRange = request.headers.get("If-Range");
      if (ifRange) fetchHeaders["If-Range"] = ifRange;

      const isMovieBox = /hakunaymatata\.com|aoneroom\.com/i.test(targetUrl);
      if (isMovieBox) {
        fetchHeaders["Referer"] = "https://videodownloader.site/";
        fetchHeaders["Origin"] = "https://videodownloader.site";
      }

      let upstream;
      let currentUrl = targetUrl;
      let redirects = 0;
      while (true) {
        const resp = await fetch(currentUrl, {
          headers: fetchHeaders,
          redirect: "manual",
        });
        const loc = resp.headers.get("location");
        if (resp.status >= 300 && resp.status < 400 && loc) {
          redirects++;
          if (redirects > 5)
            return new Response("Too many redirects", { status: 502 });
          const next = loc.startsWith("http")
            ? loc
            : new URL(loc, currentUrl).href;
          try {
            if (!isAllowed(new URL(next).hostname)) {
              return new Response("Redirect to disallowed domain", {
                status: 403,
              });
            }
          } catch {
            return new Response("Invalid redirect URL", { status: 502 });
          }
          currentUrl = next;
          continue;
        }
        upstream = resp;
        break;
      }

      const ct = (upstream.headers.get("content-type") || "").toLowerCase();
      const isM3u8 =
        ct.includes("mpegurl") ||
        ct.includes("m3u8") ||
        /\.m3u8?(\?|$)/i.test(targetUrl.split("?")[0]);

      const respHeaders = { ...corsHeaders() };

      if (isM3u8) {
        const body = await upstream.text();
        const rewritten = rewriteM3u8(body, targetUrl, proxyOrigin);
        respHeaders["Content-Type"] = "application/vnd.apple.mpegurl";
        return new Response(rewritten, {
          status: upstream.status,
          headers: respHeaders,
        });
      }

      respHeaders["Content-Type"] = ct || "application/octet-stream";
      const cl = upstream.headers.get("content-length");
      if (cl) respHeaders["Content-Length"] = cl;
      const cr = upstream.headers.get("content-range");
      if (cr) respHeaders["Content-Range"] = cr;
      respHeaders["Accept-Ranges"] =
        upstream.headers.get("accept-ranges") || "bytes";

      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      });
    } catch (err) {
      return new Response("Upstream error: " + (err.message || String(err)), {
        status: 502,
        headers: corsHeaders(),
      });
    }
  },
};
