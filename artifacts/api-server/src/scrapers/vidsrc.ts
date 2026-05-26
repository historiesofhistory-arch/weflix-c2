import * as cheerio from "cheerio";
import { vidsrcDecrypt } from "./vidsrc-decoder";

const VIDSRC_BASE = "https://vidsrc.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124";

let baseDomain = "https://whisperingauroras.com";

async function getServers(html: string): Promise<{ hash: string }[]> {
  const $ = cheerio.load(html);
  const base = $("iframe").attr("src") ?? "";
  if (base) {
    try {
      baseDomain = new URL(base.startsWith("//") ? "https:" + base : base).origin ?? baseDomain;
    } catch { /* keep default */ }
  }
  const servers: { hash: string }[] = [];
  $(".serversList .server").each((_i, el) => {
    const hash = $(el).attr("data-hash");
    if (hash) servers.push({ hash });
  });
  return servers;
}

async function resolveRcp(hash: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseDomain}/rcp/${hash}`, {
      headers: { "User-Agent": UA, Referer: `${VIDSRC_BASE}/` },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const match = html.match(/src:\s*'([^']*)'/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function resolveProrcp(prorcp: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseDomain}/prorcp/${prorcp}`, {
      headers: { "User-Agent": UA, Referer: `${baseDomain}/` },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const scripts = $("script[src]")
      .map((_i, el) => $(el).attr("src") ?? "")
      .get()
      .filter((s) => s && !s.includes("cpt.js"));
    if (!scripts.length) return null;

    const lastScript = scripts[scripts.length - 1];
    const scriptUrl = lastScript.startsWith("http")
      ? lastScript
      : `${baseDomain}/${lastScript.replace(/^\//, "")}`;

    const jsRes = await fetch(scriptUrl, {
      headers: { "User-Agent": UA, Referer: `${baseDomain}/` },
      signal: AbortSignal.timeout(8000),
    });
    const jsCode = await jsRes.text();

    const decryptRegex = /\}\}window\[([^"]+)\("([^"]+)"\)\]/;
    const m = jsCode.match(decryptRegex);
    if (!m || m.length < 3) return null;

    const fnName = m[1].trim();
    const encParam = m[2].trim();
    const id = vidsrcDecrypt(encParam, fnName);
    if (!id) return null;

    const dataEl = $(`#${id}`);
    const encrypted = dataEl.text();
    if (!encrypted) return null;

    return vidsrcDecrypt(encrypted, encParam);
  } catch {
    return null;
  }
}

export async function getVidSrcStream(
  id: string,
  season?: string,
  episode?: string,
): Promise<string | null> {
  try {
    const url =
      season && episode
        ? `${VIDSRC_BASE}/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`
        : `${VIDSRC_BASE}/embed/movie?tmdb=${id}`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const servers = await getServers(html);
    if (!servers.length) return null;

    for (const server of servers) {
      const rcpData = await resolveRcp(server.hash);
      if (!rcpData) continue;
      if (rcpData.startsWith("/prorcp/")) {
        const stream = await resolveProrcp(rcpData.replace("/prorcp/", ""));
        if (stream) return stream;
      }
    }
    return null;
  } catch {
    return null;
  }
}
