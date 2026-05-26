import app from "./app";
import { logger } from "./lib/logger";
import { probeDirectAccess, getBffAuthToken } from "./scrapers/moviebox-bff";


const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  fetch("https://ipinfo.io/json")
    .then((r) => {
      if (!r.ok) throw new Error(`ipinfo returned ${r.status}`);
      return r.json();
    })
    .then((data: Record<string, unknown>) => {
      logger.info(
        {
          ip: data.ip,
          city: data.city,
          region: data.region,
          country: data.country,
          org: data.org,
          timezone: data.timezone,
        },
        "Server datacenter info",
      );
    })
    .catch((err) => {
      logger.warn({ err: String(err) }, "Could not fetch datacenter IP info");
    });

  const streamProxy = process.env.STREAM_PROXY_URL || process.env.CF_STREAM_PROXY_URL || "";
  const subtitleProxy = process.env.SUBTITLE_PROXY_URL || process.env.CF_SUBTITLE_PROXY_URL || "";
  const resolveMode = (envValue: string | undefined, hasUrl: boolean): "cf" | "self" => {
    const v = (envValue ?? "").toLowerCase().trim();
    if (v === "cf" || v === "self") return v;
    return hasUrl ? "cf" : "self";
  };
  const streamMode = resolveMode(process.env.STREAM_PROXY_MODE, !!streamProxy);
  const subtitleMode = resolveMode(process.env.SUBTITLE_PROXY_MODE, !!subtitleProxy);

  if (streamMode === "cf" && streamProxy) {
    logger.info({ streamProxy, mode: "cf" }, "Stream proxy: using external CF Worker");
  } else if (streamMode === "cf" && !streamProxy) {
    logger.warn("Stream proxy: STREAM_PROXY_MODE=cf but no STREAM_PROXY_URL set — falling back to self proxy");
  } else {
    logger.info({ mode: "self" }, "Stream proxy: using server's own /api/stream/proxy");
  }

  if (subtitleMode === "cf" && subtitleProxy) {
    logger.info({ subtitleProxy, mode: "cf" }, "Subtitle proxy: using external CF Worker");
  } else if (subtitleMode === "cf" && !subtitleProxy) {
    logger.warn("Subtitle proxy: SUBTITLE_PROXY_MODE=cf but no SUBTITLE_PROXY_URL set — falling back to self proxy");
  } else {
    logger.info({ mode: "self" }, "Subtitle proxy: using server's own /api/stream/proxy");
  }

  probeDirectAccess()
    .then(() => getBffAuthToken())
    .then((token) => {
      if (token) logger.info("Auth token pre-warmed at startup");
      else logger.warn("Auth token pre-warm failed — will retry on first request");
    })
    .catch(() => {});
});
