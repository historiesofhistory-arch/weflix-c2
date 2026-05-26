const ALLOWED_TARGETS = [
  "api3.aoneroom.com",
  "api.aoneroom.com",
  "aoneroom.com",
  "moviebox.ph",
  "moviebox.pk",
  "moviebox.id",
  "moviebox.ng",
  "movieboxapp.in",
];

const AUTH_KEY = "wfx-bff-k82nQ4xR7v";

function isAllowedTarget(hostname) {
  return ALLOWED_TARGETS.some(d => hostname === d || hostname.endsWith("." + d));
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Auth-Key",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const authHeader = request.headers.get("X-Auth-Key");
    if (authHeader !== AUTH_KEY) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const { url: targetUrl, method, headers: targetHeaders, body: targetBody } = payload;

    if (!targetUrl || !method) {
      return new Response("Missing url or method", { status: 400 });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return new Response("Invalid target url", { status: 400 });
    }

    if (parsed.protocol !== "https:") {
      return new Response("Only HTTPS targets allowed", { status: 403 });
    }

    if (!isAllowedTarget(parsed.hostname.toLowerCase())) {
      return new Response("Target domain not allowed", { status: 403 });
    }

    try {
      const fetchOpts = {
        method: method,
        headers: targetHeaders || {},
      };
      if (targetBody && method !== "GET" && method !== "HEAD") {
        fetchOpts.body = targetBody;
      }

      const resp = await fetch(targetUrl, fetchOpts);
      const respText = await resp.text();

      return new Response(JSON.stringify({
        ok: resp.ok,
        status: resp.status,
        text: respText,
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({
        ok: false,
        status: 502,
        text: "Upstream fetch failed: " + (err.message || String(err)),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
