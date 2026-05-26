const BFF_API = 'https://api3.aoneroom.com';
const SIGN_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/\//g, '/');

const signCache = new Map();
const SIGN_CACHE_TTL = 8000;

let authBecameReady = false;
let authCheckCooldown = 0;
const AUTH_CHECK_INTERVAL = 5000;

async function getSignedHeaders(path, query, { method = 'GET', body = '' } = {}) {
  const cacheKey = `${method}|${path}|${query || ''}|${body}`;
  const cached = signCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SIGN_CACHE_TTL) {
    return cached.data;
  }

  let data;
  if (method === 'POST' && body) {
    const qs = new URLSearchParams();
    qs.set('path', path);
    if (query) qs.set('query', query);
    const res = await fetch(`${SIGN_BASE}/bff-sign?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'POST', body }),
    });
    if (!res.ok) throw new Error(`Sign request failed: ${res.status}`);
    data = await res.json();
  } else {
    const qs = new URLSearchParams();
    qs.set('path', path);
    if (query) qs.set('query', query);
    const res = await fetch(`${SIGN_BASE}/bff-sign?${qs}`);
    if (!res.ok) throw new Error(`Sign request failed: ${res.status}`);
    data = await res.json();
  }

  if (data.authReady) {
    authBecameReady = true;
  }

  signCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

const BFF_COOLDOWN_MS = 60000;
let bffCooldownUntil = 0;
let networkFailures = 0;

export async function bffFetchDirect(path, query, { method = 'GET', body = '' } = {}) {
  if (bffCooldownUntil > Date.now()) {
    throw new Error('BFF in cooldown');
  }

  const signed = await getSignedHeaders(path, query, { method, body });

  if (!signed.authReady && !authBecameReady) {
    throw new Error('BFF auth not ready');
  }

  const headers = { ...signed.headers };
  delete headers['User-Agent'];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const fetchOpts = {
      method: signed.method || method,
      headers,
      signal: controller.signal,
    };
    if (signed.body) fetchOpts.body = signed.body;
    const resp = await fetch(signed.url, fetchOpts);
    if (!resp.ok) {
      const status = resp.status;
      if (status === 403) {
        networkFailures++;
        if (networkFailures >= 5) {
          bffCooldownUntil = Date.now() + BFF_COOLDOWN_MS;
          networkFailures = 0;
        }
      }
      throw new Error(`BFF direct ${status}`);
    }
    const data = await resp.json();
    networkFailures = 0;
    return data;
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'Failed to fetch' || err.message?.includes('NetworkError')) {
      networkFailures++;
      if (networkFailures >= 5) {
        bffCooldownUntil = Date.now() + BFF_COOLDOWN_MS;
        networkFailures = 0;
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function isClientBffEnabled() {
  if (bffCooldownUntil > Date.now()) return false;
  return true;
}

export function resetBffCooldown() {
  bffCooldownUntil = 0;
  networkFailures = 0;
}

export async function bffHome(page = 1, tabId = 0) {
  const query = `page=${page}&tabId=${tabId}&version=`;
  const data = await bffFetchDirect(
    '/wefeed-mobile-bff/tab-operating',
    query
  );
  return data;
}

export async function bffSearch(keyword, page = 1) {
  const body = JSON.stringify({ keyword, page, perPage: 20 });
  const data = await bffFetchDirect(
    '/wefeed-mobile-bff/subject-api/search',
    '',
    { method: 'POST', body }
  );
  return data;
}

export async function bffDetail(subjectId) {
  const data = await bffFetchDirect(
    '/wefeed-mobile-bff/subject-api/get',
    `subjectId=${subjectId}`
  );
  return data;
}

export async function bffSeasons(subjectId) {
  const data = await bffFetchDirect(
    '/wefeed-mobile-bff/subject-api/season-info',
    `subjectId=${subjectId}`
  );
  return data;
}

export async function bffPlayInfo(subjectId, se = 0, ep = 0, resolution = 1080) {
  const query = `subjectId=${subjectId}&se=${se}&ep=${ep}&resolution=${resolution}`;
  const data = await bffFetchDirect(
    '/wefeed-mobile-bff/subject-api/play-info',
    query
  );
  return data;
}

export async function bffSubtitles(subjectId) {
  const data = await bffFetchDirect(
    '/wefeed-mobile-bff/subject-api/subtitle-search',
    `subjectId=${subjectId}`
  );
  return data;
}
