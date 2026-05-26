import { apiFetch, clearCache } from '../../lib/api';
import {
  bffHome,
  bffSearch as bffSearchDirect,
  bffDetail,
  bffSeasons,
  bffPlayInfo,
  bffSubtitles,
  isClientBffEnabled,
} from '../../lib/bffClient';

const RETRY_DELAYS = [1000, 3000, 8000];

async function fetchWithRetry(path, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiFetch(path);
    } catch (err) {
      if (attempt < maxRetries) {
        clearCache(path);
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 8000));
      } else {
        throw err;
      }
    }
  }
}

export async function fetchHome() {
  if (isClientBffEnabled()) {
    try {
      const data = await bffHome();
      if (data?.data?.items?.length > 0 || data?.data?.operatingList?.length > 0) {
        return data;
      }
    } catch {}
  }
  return apiFetch('/stream/mb-home');
}

export async function fetchMbSearch(query, page = 1) {
  if (isClientBffEnabled()) {
    try {
      const data = await bffSearchDirect(query, page);
      if (data?.data) {
        const items = data.data.subjects || data.data.items || data.data.list || [];
        return {
          items,
          totalCount: data.data.totalCount || data.data.pager?.totalCount || items.length,
          hasMore: data.data.hasMore ?? data.data.pager?.hasMore ?? items.length >= 20,
        };
      }
    } catch {}
  }
  return apiFetch(`/stream/mb-search?q=${encodeURIComponent(query)}&page=${page}`);
}

export async function fetchMbGenre(keyword, page = 1) {
  if (isClientBffEnabled()) {
    try {
      const data = await bffSearchDirect(keyword, page);
      if (data?.data) {
        const items = data.data.subjects || data.data.items || data.data.list || [];
        return items.map(item => ({
          subjectId: String(item.subjectId || item.id || ''),
          title: item.title || item.name || '',
          description: item.description || item.overview || '',
          cover: item.cover?.url || item.coverUrl || item.poster || '',
          backdrop: item.backdrop?.url || item.backdropUrl || item.cover?.url || '',
          releaseDate: item.releaseDate || item.release_date || '',
          subjectType: item.subjectType ?? (item.type === 'movie' ? 1 : 2),
          rating: item.imdbRatingValue || item.rating || '',
          genre: item.genre || '',
          hasResource: item.hasResource !== false,
        })).filter(i => i.cover && i.title);
      }
    } catch {}
  }
  const data = await apiFetch(`/stream/mb-search?q=${encodeURIComponent(keyword)}&page=${page}`);
  const items = data?.data?.subjects || data?.data?.list || data?.subjects || [];
  return items.map(item => ({
    subjectId: String(item.subjectId || item.id || ''),
    title: item.title || item.name || '',
    description: item.description || item.overview || '',
    cover: item.cover?.url || item.coverUrl || item.poster || '',
    backdrop: item.backdrop?.url || item.backdropUrl || item.cover?.url || '',
    releaseDate: item.releaseDate || item.release_date || '',
    subjectType: item.subjectType ?? (item.type === 'movie' ? 1 : 2),
    rating: item.imdbRatingValue || item.rating || '',
    genre: item.genre || '',
    hasResource: item.hasResource !== false,
  })).filter(i => i.cover && i.title);
}

export async function fetchMbDetail(subjectId, titleHint) {
  if (isClientBffEnabled()) {
    try {
      const data = await bffDetail(subjectId);
      if (data?.data) return data.data;
    } catch {}
  }
  let path = `/stream/mb-detail?subjectId=${encodeURIComponent(subjectId)}`;
  if (titleHint) path += `&title=${encodeURIComponent(titleHint)}`;
  return fetchWithRetry(path);
}

export async function fetchMbSeasons(subjectId) {
  if (isClientBffEnabled()) {
    try {
      const data = await bffSeasons(subjectId);
      if (data?.data) {
        const raw = data.data;
        if (raw.seasons) return raw;
        if (Array.isArray(raw)) return { seasons: raw };
        return raw;
      }
    } catch {}
  }
  return fetchWithRetry(`/stream/mb-seasons?subjectId=${encodeURIComponent(subjectId)}`);
}

export async function fetchMbStream(subjectId, type, se, ep, title) {
  const qs = new URLSearchParams({ subjectId });
  if (type) qs.set('type', type);
  if (se != null) qs.set('se', String(se));
  if (ep != null) qs.set('ep', String(ep));
  if (title) qs.set('title', title);
  return apiFetch(`/stream/mb-stream?${qs}`);
}

export async function fetchMbSubtitles(subjectId, title) {
  if (isClientBffEnabled()) {
    try {
      const data = await bffSubtitles(subjectId);
      if (data?.data?.items?.length > 0) return data.data.items;
    } catch {}
  }
  try {
    const data = await apiFetch(`/stream/mb-subtitles?subjectId=${encodeURIComponent(subjectId)}`);
    if (data?.subtitles?.length > 0) return data.subtitles;
  } catch {}
  try {
    const qs = new URLSearchParams({ subjectId });
    if (title) qs.set("title", title);
    const data = await apiFetch(`/stream/mb-resource?${qs}`);
    if (data?.subtitles?.length > 0) return data.subtitles;
  } catch {}
  return [];
}

// The MovieBox CDN (pbcdnw.aoneroom.com / static-cdnw.aoneroom.com) is
// backed by Aliyun OSS, which exposes image processing via the
// `x-oss-process` query string. Asking for `image/resize,w_<N>/format,webp`
// gives us a right-sized WebP — e.g. a ~1.4 MB JPEG poster shrinks to
// ~15 KB at w=300. We bump the requested width to ~2x the rendered CSS
// width so it stays sharp on high-DPI screens.
const MB_CDN_HOST_RE = /(?:^|\.)aoneroom\.com$/i;

export function mbCoverUrl(cover, width = 300) {
  if (!cover) return null;
  const raw = typeof cover === 'string' ? cover : cover.url;
  if (!raw) return null;
  if (!width) return raw;
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (!MB_CDN_HOST_RE.test(u.hostname)) return raw;
  if (u.searchParams.has('x-oss-process')) return raw;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(2, window.devicePixelRatio) : 1;
  const w = Math.max(1, Math.round(width * dpr));
  u.searchParams.set('x-oss-process', `image/resize,w_${w}/format,webp`);
  return u.toString();
}

export function mbTypeLabel(subjectType) {
  return subjectType === 1 ? 'movie' : 'tv';
}

export function normalizeHomeSection(section) {
  if (!section) return [];
  const items = section.subjects || section.items || section.list || [];
  return items.map(item => ({
    subjectId: String(item.subjectId || item.id || ''),
    title: item.title || item.name || '',
    description: item.description || item.overview || '',
    cover: item.cover?.url || item.coverUrl || item.poster || '',
    backdrop: item.backdrop?.url || item.backdropUrl || item.cover?.url || '',
    releaseDate: item.releaseDate || item.release_date || '',
    subjectType: item.subjectType ?? (item.type === 'movie' ? 1 : 2),
    rating: item.imdbRatingValue || item.rating || '',
    genre: item.genre || '',
    hasResource: item.hasResource !== false,
  }));
}
