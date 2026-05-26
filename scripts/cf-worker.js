const ALLOWED_DOMAINS = [
  "hakunaymatata.com", "aoneroom.com", "moviebox.ph", "moviebox.pk",
  "moviebox.id", "moviebox.ng", "movieboxapp.in", "videodownloader.site",
  "fmoviesunblocked.net", "sflix.film", "netnaija.video", "netnaija.com",
];

function isAllowed(hostname) {
  return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith("." + d));
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Range, If-Range",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response("Missing url param", { status: 400 });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return new Response("Invalid url", { status: 400 });
    }

    if (parsed.protocol !== "https:") {
      return new Response("Only HTTPS allowed", { status: 403 });
    }

    if (!isAllowed(parsed.hostname.toLowerCase())) {
      return new Response("Domain not allowed", { status: 403 });
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Referer": "https://videodownloader.site/",
      "Origin": "https://videodownloader.site",
    };

    const range = request.headers.get("Range");
    if (range) headers["Range"] = range;
    const ifRange = request.headers.get("If-Range");
    if (ifRange) headers["If-Range"] = ifRange;

    let upstream;
    let currentUrl = targetUrl;
    let redirects = 0;

    while (true) {
      const fetchInit = { headers, redirect: "manual" };
      if (range) fetchInit.cf = { cacheEverything: false };
      const resp = await fetch(currentUrl, fetchInit);
      if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
        redirects++;
        if (redirects > 5) return new Response("Too many redirects", { status: 502 });
        const loc = resp.headers.get("location");
        currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
        try {
          const redir = new URL(currentUrl);
          if (redir.protocol !== "https:" || !isAllowed(redir.hostname.toLowerCase())) {
            return new Response("Redirect to disallowed domain", { status: 403 });
          }
        } catch {
          return new Response("Invalid redirect", { status: 502 });
        }
        continue;
      }
      upstream = resp;
      break;
    }

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    const ct = upstream.headers.get("Content-Type");
    if (ct) responseHeaders.set("Content-Type", ct);
    const cl = upstream.headers.get("Content-Length");
    if (cl) responseHeaders.set("Content-Length", cl);
    const cr = upstream.headers.get("Content-Range");
    if (cr) responseHeaders.set("Content-Range", cr);
    responseHeaders.set("Accept-Ranges", upstream.headers.get("Accept-Ranges") || "bytes");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
