const BASE = `${import.meta.env.BASE_URL}api`.replace(/\/\//g, '/');

const inFlight = new Map();
const responseCache = new Map();
const CACHE_TTL = 30000;

export function clearCache(path) {
  if (path) {
    const url = `${BASE}${path}`;
    responseCache.delete(url);
    inFlight.delete(url);
  } else {
    responseCache.clear();
    inFlight.clear();
  }
}

export async function apiFetch(path, opts = {}) {
  const url = `${BASE}${path}`;
  const cacheKey = url;

  if (!opts.method || opts.method === 'GET') {
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data;
    }

    const existing = inFlight.get(cacheKey);
    if (existing) return existing;

    const promise = fetch(url, opts)
      .then(res => {
        if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
        return res.json();
      })
      .then(data => {
        responseCache.set(cacheKey, { data, ts: Date.now() });
        return data;
      })
      .finally(() => {
        inFlight.delete(cacheKey);
      });

    inFlight.set(cacheKey, promise);
    return promise;
  }

  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export const API_BASE = BASE;
