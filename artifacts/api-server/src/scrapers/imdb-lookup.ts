import { logger } from "../lib/logger";

const TMDB_API_KEY = process.env.VITE_TMDB_API || "";
const OMDB_API_KEY = process.env.OMDB_API_KEY || "trilogy";
const TMDB_BASE = "https://api.themoviedb.org/3";
const OMDB_BASE = "https://www.omdbapi.com";

export interface ImdbMetadata {
  imdbId: string;
  title: string;
  year: string;
  rating: string;
  votes: string;
  plot: string;
  runtime: string;
  country: string;
  genre: string;
  actors: string;
  director: string;
}

interface CacheEntry {
  data: ImdbMetadata | null;
  ts: number;
  transient?: boolean;
}

const imdbCache = new Map<string, CacheEntry>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_TTL_ERROR = 10 * 60 * 1000;

function getCached(key: string): ImdbMetadata | null | undefined {
  const entry = imdbCache.get(key);
  if (!entry) return undefined;
  const ttl = entry.transient ? CACHE_TTL_ERROR : CACHE_TTL;
  if (Date.now() - entry.ts > ttl) {
    imdbCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCache(key: string, data: ImdbMetadata | null, transient = false) {
  imdbCache.set(key, { data, ts: Date.now(), transient });
  if (imdbCache.size > 2000) {
    const oldest = imdbCache.keys().next().value;
    if (oldest) imdbCache.delete(oldest);
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getImdbId(tmdbId: string, type: string): Promise<string | null> {
  if (!TMDB_API_KEY) {
    logger.warn("IMDB lookup: no TMDB API key configured");
    return null;
  }
  const mediaType = type === "tv" ? "tv" : "movie";
  const url = `${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
  try {
    const resp = await fetchWithTimeout(url, 6000);
    if (!resp.ok) {
      logger.warn({ status: resp.status, tmdbId, type }, "IMDB lookup: TMDB external_ids failed");
      return null;
    }
    const data = await resp.json() as { imdb_id?: string };
    return data.imdb_id || null;
  } catch (err) {
    logger.warn({ err: String(err), tmdbId }, "IMDB lookup: TMDB external_ids error");
    return null;
  }
}

async function getOmdbData(imdbId: string): Promise<ImdbMetadata | null> {
  const url = `${OMDB_BASE}/?i=${encodeURIComponent(imdbId)}&apikey=${OMDB_API_KEY}&plot=short`;
  try {
    const resp = await fetchWithTimeout(url, 6000);
    if (!resp.ok) {
      logger.warn({ status: resp.status, imdbId }, "IMDB lookup: OMDB request failed");
      return null;
    }
    const data = await resp.json() as Record<string, string>;
    if (data.Response === "False") {
      logger.warn({ imdbId, error: data.Error }, "IMDB lookup: OMDB returned no data");
      return null;
    }
    return {
      imdbId,
      title: data.Title || "",
      year: data.Year || "",
      rating: data.imdbRating || "",
      votes: data.imdbVotes || "",
      plot: data.Plot || "",
      runtime: data.Runtime || "",
      country: data.Country || "",
      genre: data.Genre || "",
      actors: data.Actors || "",
      director: data.Director || "",
    };
  } catch (err) {
    logger.warn({ err: String(err), imdbId }, "IMDB lookup: OMDB error");
    return null;
  }
}

export async function resolveImdbMetadata(
  tmdbId: string,
  type: string,
): Promise<ImdbMetadata | null> {
  if (!tmdbId) return null;

  const cacheKey = `${type}:${tmdbId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const imdbId = await getImdbId(tmdbId, type);
    if (!imdbId) {
      logger.info({ tmdbId, type }, "IMDB lookup: no IMDB ID found for TMDB ID");
      setCache(cacheKey, null, true);
      return null;
    }

    const omdbData = await getOmdbData(imdbId);
    if (!omdbData) {
      logger.info({ tmdbId, imdbId }, "IMDB lookup: OMDB returned no data");
      setCache(cacheKey, null, true);
      return null;
    }

    logger.info(
      { tmdbId, imdbId, imdbTitle: omdbData.title, imdbYear: omdbData.year, imdbRating: omdbData.rating },
      "IMDB lookup: resolved successfully",
    );
    setCache(cacheKey, omdbData);
    return omdbData;
  } catch (err) {
    logger.warn({ err: String(err), tmdbId }, "IMDB lookup: unexpected error");
    return null;
  }
}
