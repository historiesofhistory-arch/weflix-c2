import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";

const REFERER = "https://vidlink.pro/";
const ORIGIN = "https://vidlink.pro";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124";

let wasmReady = false;
let bootPromise: Promise<void> | null = null;

const scrapersDir = path.join(__dirname, "scrapers");

function bootWasm(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      (globalThis as any).window = globalThis;
      (globalThis as any).self = globalThis;
      (globalThis as any).document = {
        createElement: () => ({}),
        body: { appendChild: () => {} },
      };

      const sodiumModule = await import("libsodium-wrappers");
      // libsodium-wrappers is a CommonJS module; the actual API object may be on .default
      const sodium: any = (sodiumModule as any).default ?? sodiumModule;
      await sodium.ready;
      (globalThis as any).sodium = sodium;

      // Expose all sodium functions directly on globalThis so the Go WASM can call them
      for (const key of Object.getOwnPropertyNames(sodium)) {
        if (key === "ready") continue;
        try {
          const val = sodium[key];
          if (typeof val === "function") {
            (globalThis as any)[key] = val.bind(sodium);
          } else if (val !== undefined) {
            (globalThis as any)[key] = val;
          }
        } catch { /* skip */ }
      }
      (globalThis as any).libsodium = sodium;

      const runtimeCode = fs.readFileSync(
        path.join(scrapersDir, "wasm-runtime.js"),
        "utf8",
      );
      // eslint-disable-next-line no-eval
      eval(runtimeCode);

      const Go = (globalThis as any).Dm;
      const go = new Go();
      const wasmBuf = fs.readFileSync(path.join(scrapersDir, "fu.wasm"));
      const { instance } = await WebAssembly.instantiate(wasmBuf, go.importObject);
      go.run(instance);

      // Give the Go runtime time to register globalThis.getAdv
      await new Promise<void>((r) => setTimeout(r, 800));

      if (typeof (globalThis as any).getAdv !== "function") {
        throw new Error("getAdv not found after WASM boot");
      }
      wasmReady = true;
    } catch (err) {
      bootPromise = null;
      wasmReady = false;
      throw err;
    }
  })();
  return bootPromise;
}

export async function getVidLinkStream(
  id: string,
  season?: string,
  episode?: string,
): Promise<string> {
  await bootWasm();

  const token: string = (globalThis as any).getAdv(String(id));
  if (!token) throw new Error("getAdv returned null");

  const apiUrl = season
    ? `https://vidlink.pro/api/b/tv/${token}/${season}/${episode ?? 1}?multiLang=0`
    : `https://vidlink.pro/api/b/movie/${token}?multiLang=0`;

  const res = await fetch(apiUrl, {
    headers: { Referer: REFERER, Origin: ORIGIN, "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`VidLink API returned ${res.status}`);

  const data = await res.json();
  const playlist = data?.stream?.playlist;
  if (!playlist) throw new Error("No playlist in VidLink response");

  return playlist as string;
}

export function rewriteM3u8(body: string, baseUrl: string, proxyBase: string): string {
  const base = baseUrl.split("?")[0];
  const baseDir = base.substring(0, base.lastIndexOf("/") + 1);
  const origin = new URL(baseUrl).origin;
  return body
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      const abs = t.startsWith("http")
        ? t
        : t.startsWith("/")
          ? origin + t
          : baseDir + t;
      return `${proxyBase}?url=${encodeURIComponent(abs)}`;
    })
    .join("\n");
}

interface UpstreamResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  pipe: (dest: any) => void;
  [Symbol.asyncIterator](): AsyncIterableIterator<Buffer>;
}

export function fetchUpstream(
  url: string,
  redirects = 0,
  extraHeaders?: Record<string, string>,
): Promise<UpstreamResult> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects"));
    const mod = url.startsWith("https") ? https : http;
    mod
      .get(
        url,
        {
          headers: {
            Referer: REFERER,
            Origin: ORIGIN,
            "User-Agent": UA,
            Accept: "*/*",
            ...extraHeaders,
          },
        },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const loc = res.headers.location;
            return resolve(
              fetchUpstream(
                loc.startsWith("http") ? loc : new URL(loc, url).href,
                redirects + 1,
                extraHeaders,
              ),
            );
          }
          resolve(res as unknown as UpstreamResult);
        },
      )
      .on("error", reject);
  });
}
