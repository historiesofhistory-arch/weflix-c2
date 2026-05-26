import { logger } from "../lib/logger";
import { bffSearch, bffGetSeasonInfo, bffGetSubjectDetail, bffGetPlayInfo, bffGetResourceFromSearch, type BffDubEntry, type BffSubjectDetail } from "./moviebox-bff";
import { resolveImdbMetadata, type ImdbMetadata } from "./imdb-lookup";

const H5_DIRECT_URL = "https://h5-api.aoneroom.com";

const DEFAULT_HEADERS: Record<string, string> = {
  "X-Client-Info": '{"timezone":"Asia/Kolkata"}',
  "Accept-Language": "en-US,en;q=0.5",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
  Referer: "https://videodownloader.site/",
};

async function getSubjectDetail(subjectId: string, titleHint?: string): Promise<BffSubjectDetail | null> {
  try {
    const h5 = await h5GetSubjectDetail(subjectId);
    if (h5) {
      return {
        subjectId: String(h5.subjectId || subjectId),
        subjectType: Number(h5.subjectType || 1),
        title: String(h5.title || ""),
        description: String(h5.description || ""),
        releaseDate: String(h5.releaseDate || ""),
        duration: String(h5.duration || ""),
        genre: String(h5.genre || ""),
        cover: h5.cover as BffSubjectDetail["cover"] || null,
        countryName: String(h5.countryName || ""),
        language: "",
        imdbRatingValue: String(h5.imdbRatingValue || ""),
        staffList: (h5.staffList || []) as BffSubjectDetail["staffList"],
        dubs: (h5.dubs || []) as BffDubEntry[],
      };
    }
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "getSubjectDetail: H5 failed, trying BFF");
  }
  return bffGetSubjectDetail(subjectId, titleHint);
}

interface MbStream {
  format: string;
  id: string;
  url: string;
  quality: string;
  size: string;
  duration: number;
  codec: string;
}

interface MbLanguageVariant {
  name: string;
  detailPath: string;
  subjectId?: string;
}

export interface MbSubtitle {
  id: string;
  lan: string;
  lanName: string;
  url: string;
}

export interface MbResolveResult {
  streams: MbStream[];
  languages: MbLanguageVariant[];
  dubs: BffDubEntry[];
  currentSubjectId: string;
  proxyBase: string;
  remappedSeason?: number;
  remappedEpisode?: number;
  subtitles?: MbSubtitle[];
  imdbId?: string;
  imdbTitle?: string;
  imdbRating?: string;
}

export interface MbPlayResult {
  streams: MbStream[];
  proxyBase: string;
  subtitles?: MbSubtitle[];
}

async function mbPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${H5_DIRECT_URL}${path}`;
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    "Content-Type": "application/json",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`H5 API returned ${resp.status} for POST ${path}`);
    }
    const text = await resp.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Failed to parse H5 response from ${path}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function mbGet(path: string): Promise<Record<string, unknown>> {
  const url = `${H5_DIRECT_URL}${path}`;
  const headers: Record<string, string> = { ...DEFAULT_HEADERS };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`H5 API returned ${resp.status} for GET ${path}`);
    }
    const text = await resp.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Failed to parse H5 response from ${path}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/['']s\b/g, "s")
    .replace(/s\d+-s\d+/gi, "")
    .replace(/s\d+/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const KNOWN_LANGUAGES = new Set([
  "english", "hindi", "telugu", "tamil", "spanish", "french",
  "korean", "chinese", "arabic", "portuguese", "japanese",
  "german", "italian", "russian", "turkish", "thai",
  "bengali", "kannada", "malayalam", "marathi", "gujarati",
  "punjabi", "urdu", "indonesian", "vietnamese", "polish",
  "dutch", "swedish", "norwegian", "danish", "finnish",
  "czech", "hungarian", "romanian", "greek", "hebrew",
]);

const LANG_CODE_TO_DISPLAY: Record<string, string> = {
  esla: "Spanish", es: "Spanish", spa: "Spanish",
  ptbr: "Portuguese", pt: "Portuguese", por: "Portuguese",
  ja: "Japanese", jpn: "Japanese",
  ko: "Korean", kor: "Korean",
  zh: "Chinese", zho: "Chinese", chi: "Chinese",
  en: "English", eng: "English",
  hi: "Hindi", hin: "Hindi",
  ta: "Tamil", tam: "Tamil",
  te: "Telugu", tel: "Telugu",
  fr: "French", fre: "French", fra: "French",
  ar: "Arabic", ara: "Arabic",
  de: "German", ger: "German", deu: "German",
  it: "Italian", ita: "Italian",
  ru: "Russian", rus: "Russian",
  tr: "Turkish", tur: "Turkish",
  th: "Thai", tha: "Thai",
  bn: "Bengali", ben: "Bengali",
  kn: "Kannada", kan: "Kannada",
  ml: "Malayalam", mal: "Malayalam",
  mr: "Marathi", mar: "Marathi",
  gu: "Gujarati", guj: "Gujarati",
  pa: "Punjabi", pan: "Punjabi",
  ur: "Urdu", urd: "Urdu",
};

export function normalizeLangKey(name: string): string {
  const base = name.replace(/\s*dub$/i, "").trim().toLowerCase();
  return LANG_CODE_TO_DISPLAY[base]?.toLowerCase() || base;
}

export function displayLangName(lanName: string, lanCode: string): string {
  const baseName = lanName.replace(/\s*dub$/i, "").trim();
  const mapped = LANG_CODE_TO_DISPLAY[baseName.toLowerCase()] ||
                 LANG_CODE_TO_DISPLAY[lanCode.toLowerCase()];
  if (mapped) return mapped;
  if (baseName.length <= 4 && baseName.toLowerCase() !== baseName) return baseName;
  if (baseName.length <= 4) {
    const capped = baseName.charAt(0).toUpperCase() + baseName.slice(1).toLowerCase();
    return capped;
  }
  return baseName;
}

function extractLangTag(title: string): string | null {
  const nonLang = new Set(["CAM", "HC", "TS", "HDCAM", "HDTS", "NETFLIX", "MULTI AUDIO", "DUAL AUDIO"]);

  const bracketMatches = title.matchAll(/\[([A-Za-z][A-Za-z\s]*[A-Za-z]|[A-Za-z]+)\]/g);
  for (const match of bracketMatches) {
    const tag = match[1].trim();
    if (!nonLang.has(tag.toUpperCase())) return tag;
  }

  const parenMatches = title.matchAll(/\(([A-Za-z][A-Za-z\s]*[A-Za-z]|[A-Za-z]+)\)/g);
  for (const match of parenMatches) {
    const tag = match[1].trim();
    if (nonLang.has(tag.toUpperCase())) continue;
    if (KNOWN_LANGUAGES.has(tag.toLowerCase())) return tag;
    const parenWords = tag.split(/\s+/);
    for (const pw of parenWords) {
      if (KNOWN_LANGUAGES.has(pw.toLowerCase())) return pw;
    }
  }

  const dashMatch = title.match(/[-–—]\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*$/);
  if (dashMatch) {
    const dashWords = dashMatch[1].trim().split(/\s+/);
    for (const dw of dashWords) {
      if (KNOWN_LANGUAGES.has(dw.toLowerCase())) return dw;
    }
  }

  const words = title.split(/\s+/);
  if (words.length >= 2) {
    const lastWord = words[words.length - 1].replace(/[^A-Za-z]/g, "");
    if (lastWord.length >= 4 && KNOWN_LANGUAGES.has(lastWord.toLowerCase())) return lastWord;
    if (words.length >= 3) {
      const secondLast = words[words.length - 2].replace(/[^A-Za-z]/g, "");
      if (secondLast.length >= 4 && KNOWN_LANGUAGES.has(secondLast.toLowerCase())) return secondLast;
    }
  }

  return null;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or",
  "is", "it", "by", "with", "from", "as", "its", "has", "was", "are",
]);

function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1.0;
  if (na.startsWith(nb) || nb.startsWith(na)) {
    const prefixNumsA: string[] = na.match(/\d+/g) || [];
    const prefixNumsB: string[] = nb.match(/\d+/g) || [];
    const prefixSeqConflict =
      prefixNumsA.length > 0 && prefixNumsB.length > 0 &&
      !prefixNumsA.some((n) => prefixNumsB.includes(n));
    if (prefixSeqConflict) {
      return 0.4;
    }
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return ratio * 0.9;
  }

  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");

  const firstWordA = wordsA.find((w) => w.length >= 3 && !STOP_WORDS.has(w)) || wordsA[0];
  const setB = new Set(wordsB);
  if (firstWordA && firstWordA.length >= 3 && !setB.has(firstWordA)) {
    return 0.1;
  }

  const setA = new Set(wordsA);
  const intersection = wordsB.filter((w) => setA.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  let jaccard = union > 0 ? intersection / union : 0;

  const sigA = wordsA.filter((w) => !STOP_WORDS.has(w));
  const sigB = wordsB.filter((w) => !STOP_WORDS.has(w));

  const numsA = sigA.filter((w) => /^\d+$/.test(w));
  const numsB = sigB.filter((w) => /^\d+$/.test(w));
  const hasSequelConflict =
    numsA.length > 0 && numsB.length > 0 &&
    !numsA.some((n) => numsB.includes(n));
  const oneHasNumOtherDoesnt =
    (numsA.length > 0 && numsB.length === 0) ||
    (numsA.length === 0 && numsB.length > 0);

  if (sigA.length > 0 && sigB.length > 0) {
    const sigSetA = new Set(sigA);
    const sigSetB = new Set(sigB);
    const sigIntersection = sigB.filter((w) => sigSetA.has(w)).length;
    const sigUnion = new Set([...sigA, ...sigB]).size;
    const sigJaccard = sigUnion > 0 ? sigIntersection / sigUnion : 0;
    jaccard = Math.max(jaccard, sigJaccard);

    if (hasSequelConflict) {
      jaccard = Math.min(jaccard, 0.45);
    } else {
      const [shorter, longer] = sigA.length <= sigB.length
        ? [sigA, sigSetB] : [sigB, sigSetA];
      const allShorterInLonger = shorter.every((w) => longer.has(w));
      if (allShorterInLonger && shorter.length >= 2) {
        if (oneHasNumOtherDoesnt) {
          jaccard = Math.max(jaccard, 0.7);
        } else {
          jaccard = Math.max(jaccard, 0.85);
        }
      } else if (allShorterInLonger && shorter.length === 1) {
        jaccard = Math.max(jaccard, 0.6);
      }
    }
  }

  return jaccard;
}

interface SearchItem {
  title: string;
  subjectId: string;
  detailPath: string;
  releaseYear?: number;
  year?: number;
  subjectType?: string;
  type?: number;
  imdbRatingValue?: string;
}

function parseStreams(data: Record<string, unknown>): MbStream[] {
  const d = data as { data?: { streams?: Array<Record<string, unknown>> } };
  const rawStreams = d?.data?.streams || [];
  return rawStreams.map((s) => ({
    format: String(s.format || "MP4"),
    id: String(s.id || ""),
    url: String(s.url || ""),
    quality: String(s.resolutions || ""),
    size: String(s.size || "0"),
    duration: Number(s.duration || 0),
    codec: String(s.codecName || ""),
  }));
}

function parseBffPlayInfoStreams(raw: Array<Record<string, unknown>>): MbStream[] {
  return raw
    .filter((s) => s.url && String(s.url).startsWith("http"))
    .map((s) => ({
      format: String(s.format || "MP4"),
      id: String(s.id || ""),
      url: String(s.url || ""),
      quality: String(s.resolutions || ""),
      size: String(s.size || "0"),
      duration: Number(s.duration || 0),
      codec: String(s.codecName || ""),
    }));
}

async function tryBffPlayInfo(
  subjectId: string,
  se: number,
  ep: number,
): Promise<MbStream[]> {
  try {
    const result = await bffGetPlayInfo(subjectId, se, ep, 1080);
    if (result && result.streams.length > 0) {
      const streams = parseBffPlayInfoStreams(result.streams);
      if (streams.length > 0) {
        logger.info(
          { subjectId, se, ep, count: streams.length },
          "MovieBox: BFF play-info returned streams (authenticated)",
        );
        return streams;
      }
    }
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "MovieBox: BFF play-info failed, will try H5");
  }
  return [];
}

async function tryBffResource(
  subjectId: string,
  _se: number,
  _ep: number,
  titleHint?: string,
): Promise<{ streams: MbStream[]; subtitles: MbSubtitle[] }> {
  try {
    const result = await bffGetResourceFromSearch(subjectId, titleHint);
    if (result.streams.length === 0) return { streams: [], subtitles: [] };

    const streams: MbStream[] = result.streams.map((s) => ({
      format: "MP4",
      id: "",
      url: s.url,
      quality: s.quality,
      size: String(s.size || 0),
      duration: 0,
      codec: "",
    }));

    const seenResolutions = new Set<string>();
    const dedupedStreams = streams.filter((s) => {
      if (seenResolutions.has(s.quality)) return false;
      seenResolutions.add(s.quality);
      return true;
    });

    const subtitles: MbSubtitle[] = result.subtitles.map((s) => ({
      id: s.lan,
      lan: s.lan,
      lanName: s.lanName,
      url: s.url,
    }));

    if (dedupedStreams.length > 0) {
      logger.info(
        { subjectId, count: dedupedStreams.length, subtitleCount: subtitles.length },
        "MovieBox: resourceDetectors returned streams",
      );
    }

    return { streams: dedupedStreams, subtitles };
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "MovieBox: BFF resource failed");
    return { streams: [], subtitles: [] };
  }
}

function parseImdbRuntimeSeconds(runtime: string | undefined): number {
  if (!runtime) return 0;
  const m = runtime.match(/(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) * 60 : 0;
}

function imdbSignalsMatch(
  imdbRating: string | undefined,
  imdbRuntimeStr: string | undefined,
  mbRatingStr: string | undefined,
  mbDurationSec: number | undefined,
): { ratingOk: boolean; runtimeOk: boolean; bothBad: boolean } {
  const imdbR = imdbRating ? parseFloat(imdbRating) : 0;
  const mbR = mbRatingStr ? parseFloat(mbRatingStr) : 0;
  const ratingOk = !imdbR || !mbR || Math.abs(imdbR - mbR) <= 0.5;

  const imdbSec = parseImdbRuntimeSeconds(imdbRuntimeStr);
  const runtimeOk =
    !imdbSec || !mbDurationSec ||
    Math.abs(imdbSec - mbDurationSec) / Math.max(imdbSec, mbDurationSec) <= 0.20;

  return { ratingOk, runtimeOk, bothBad: !ratingOk && !runtimeOk };
}

function passesBidirectionalCoverage(
  searchTitle: string,
  itemTitle: string,
  threshold = 0.65,
): boolean {
  const cleanItem = itemTitle.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").trim();
  const isNonNumericSig = (w: string) => !STOP_WORDS.has(w) && w.length >= 2 && !/^\d+$/.test(w);
  const searchSigWords = normalizeTitle(searchTitle).split(" ").filter(isNonNumericSig);
  const itemSigWords = normalizeTitle(cleanItem).split(" ").filter(isNonNumericSig);
  if (searchSigWords.length === 0 || itemSigWords.length === 0) return true;
  const searchSet = new Set(searchSigWords);
  const itemSet = new Set(itemSigWords);
  const searchCov = searchSigWords.filter((w) => itemSet.has(w)).length / searchSigWords.length;
  const itemCov = itemSigWords.filter((w) => searchSet.has(w)).length / itemSigWords.length;
  return searchCov >= threshold && itemCov >= threshold;
}

function parseDurationToSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  let total = 0;
  const hMatch = duration.match(/(\d+)\s*h/i);
  const mMatch = duration.match(/(\d+)\s*m/i);
  if (hMatch) total += parseInt(hMatch[1], 10) * 3600;
  if (mMatch) total += parseInt(mMatch[1], 10) * 60;
  return total;
}

function matchItems(
  items: SearchItem[],
  title: string,
  yearNum: number,
  wantsTv: boolean,
): { bestMatch: SearchItem | null; languageVariants: MbLanguageVariant[] } {
  let bestMatch: SearchItem | null = null;
  let bestScore = 0;
  const languageVariants: MbLanguageVariant[] = [];

  for (const item of items) {
    if (item.type !== undefined) {
      const isTvItem = item.type === 2;
      if (wantsTv !== isTvItem) continue;
    }

    const langTag = extractLangTag(item.title);
    const sim = titleSimilarity(title, item.title);

    if (sim < 0.5) continue;

    if (!passesBidirectionalCoverage(title, item.title)) continue;

    const itemYear = item.releaseYear || item.year || 0;
    const yearMatch = !yearNum || !itemYear || Math.abs(itemYear - yearNum) <= 2;

    if (!yearMatch && yearNum && itemYear) continue;

    if (langTag) {
      languageVariants.push({
        name: langTag,
        detailPath: item.detailPath,
        subjectId: item.subjectId,
      });
    }

    const score = sim + (yearMatch && yearNum && itemYear ? 0.2 : 0);
    if (!langTag && score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  if (!bestMatch) {
    let firstClean: SearchItem | null = null;
    let firstAny: SearchItem | null = null;
    for (const item of items) {
      if (item.type !== undefined) {
        const isTvItem = item.type === 2;
        if (wantsTv !== isTvItem) continue;
      }
      const sim = titleSimilarity(title, item.title);
      if (sim < 0.5) continue;
      if (!passesBidirectionalCoverage(title, item.title)) continue;
      const itemYear = item.releaseYear || item.year || 0;
      const yearMatch = !yearNum || !itemYear || Math.abs(itemYear - yearNum) <= 2;
      if (!yearMatch && yearNum && itemYear) continue;
      if (!firstAny) firstAny = item;
      if (!firstClean && !extractLangTag(item.title)) firstClean = item;
      if (firstClean) break;
    }
    bestMatch = firstClean || firstAny || null;
  }

  return { bestMatch, languageVariants };
}

async function tryBffSearch(
  title: string,
  yearNum: number,
  wantsTv: boolean,
): Promise<{ items: SearchItem[]; bestMatch: SearchItem | null; languageVariants: MbLanguageVariant[] } | null> {
  try {
    const bffResult = await bffSearch(title, 1, 20);
    if (!bffResult.items || bffResult.items.length === 0) return null;

    const items: SearchItem[] = bffResult.items.map((item) => {
      const yearMatch = item.releaseDate ? parseInt(item.releaseDate, 10) : 0;
      return {
        title: item.title,
        subjectId: item.subjectId,
        detailPath: "",
        releaseYear: yearMatch,
        year: yearMatch,
        type: item.subjectType,
        subjectType: item.subjectType === 1 ? "movie" : "tv",
        imdbRatingValue: item.imdbRatingValue || "",
      };
    });

    const { bestMatch, languageVariants } = matchItems(items, title, yearNum, wantsTv);
    if (!bestMatch) return null;

    return { items, bestMatch, languageVariants };
  } catch (err) {
    logger.warn({ err: String(err), title }, "BFF search failed, will try H5");
    return null;
  }
}

function mapH5Items(raw: Record<string, unknown>[]): SearchItem[] {
  return raw.map((item: Record<string, unknown>) => {
    const rd = typeof item.releaseDate === "string" ? parseInt(item.releaseDate, 10) : 0;
    const st = typeof item.subjectType === "number" ? item.subjectType : (typeof item.subjectType === "string" ? parseInt(item.subjectType, 10) : undefined);
    return {
      title: String(item.title || ""),
      subjectId: String(item.subjectId || ""),
      detailPath: String(item.detailPath || ""),
      releaseYear: rd || 0,
      year: rd || 0,
      type: st && !isNaN(st) ? st : undefined,
      subjectType: st === 1 ? "movie" : "tv",
    };
  });
}

async function tryH5Search(
  title: string,
  yearNum: number,
  wantsTv: boolean,
): Promise<{ items: SearchItem[]; bestMatch: SearchItem | null; languageVariants: MbLanguageVariant[] } | null> {
  const searchResult = await mbPost("/wefeed-h5api-bff/subject/search", {
    keyword: title,
    page: 1,
    perPage: 20,
  });

  const rawItems = ((searchResult as { data?: { items?: Record<string, unknown>[] } })?.data?.items) || [];
  let items: SearchItem[] = mapH5Items(rawItems);

  let { bestMatch, languageVariants } = matchItems(items, title, yearNum, wantsTv);

  if (!bestMatch) {
    const nTitle = normalizeTitle(title);
    const words = nTitle.split(" ").filter((w) => !STOP_WORDS.has(w) && w.length >= 3);
    const shortKeyword = words.length > 0 ? words[0] : "";
    if (shortKeyword && shortKeyword !== nTitle) {
      logger.info({ title, shortKeyword }, "MovieBox H5: retrying with short keyword");
      const retryResult = await mbPost("/wefeed-h5api-bff/subject/search", {
        keyword: shortKeyword,
        page: 1,
        perPage: 20,
      });
      const retryRaw = ((retryResult as { data?: { items?: Record<string, unknown>[] } })?.data?.items) || [];
      const retryItems: SearchItem[] = mapH5Items(retryRaw);
      if (retryItems.length > 0) {
        items = retryItems;
        const retryMatch = matchItems(retryItems, title, yearNum, wantsTv);
        bestMatch = retryMatch.bestMatch;
        languageVariants = retryMatch.languageVariants;
      }
    }
  }

  if (items.length === 0 || !bestMatch) return null;
  return { items, bestMatch, languageVariants };
}

async function remapSeasonEpisode(
  subjectId: string,
  tmdbSeason: number,
  tmdbEpisode: number
): Promise<{ se: number; ep: number } | null> {
  try {
    let seasonInfo = await h5GetSeasonInfo(subjectId).catch(() => null);
    if (!seasonInfo?.seasons?.length) {
      seasonInfo = await bffGetSeasonInfo(subjectId).catch(() => null);
    }
    if (!seasonInfo?.seasons?.length) return null;

    const sorted = [...seasonInfo.seasons].sort((a, b) => a.se - b.se);

    let totalEpsBefore = 0;
    for (const s of sorted) {
      if (s.se < tmdbSeason) {
        totalEpsBefore += s.maxEp;
      }
    }
    const absoluteEp = totalEpsBefore + tmdbEpisode;

    let runningTotal = 0;
    for (const s of sorted) {
      if (runningTotal + s.maxEp >= absoluteEp) {
        const mapped = { se: s.se, ep: absoluteEp - runningTotal };
        if (mapped.se === tmdbSeason && mapped.ep === tmdbEpisode) {
          logger.info(
            { subjectId, se: tmdbSeason, ep: tmdbEpisode },
            "MovieBox: remap computed same se/ep, no alternative found"
          );
          return null;
        }
        return mapped;
      }
      runningTotal += s.maxEp;
    }

    const lastSeason = sorted[sorted.length - 1];
    if (lastSeason) {
      const totalEps = sorted.reduce((sum, s) => sum + s.maxEp, 0);
      if (absoluteEp <= totalEps) return null;
      logger.info(
        { subjectId, absoluteEp, totalEps, tmdbSeason, tmdbEpisode },
        "MovieBox: episode beyond total episode count"
      );
    }

    return null;
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "MovieBox: season remap failed");
    return null;
  }
}

function textJaccard(a: string, b: string): number {
  if (!a || !b) return 0;
  const stopWords = new Set(["the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "is", "it", "by", "with", "from", "as", "its", "has", "was", "are", "be", "this", "that", "who", "which", "their", "they", "but", "not", "have", "had", "will", "can", "do", "does", "did", "been", "being", "were", "would", "could", "should", "may", "might", "shall", "into", "than", "then", "also", "about", "up", "out", "just", "only", "more", "very", "so", "no", "he", "she", "him", "her", "his"]);
  const tokenize = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

const COUNTRY_CODE_MAP: Record<string, string[]> = {
  jp: ["japan", "japanese"], us: ["united states", "american", "usa"], kr: ["korea", "korean", "south korea"],
  cn: ["china", "chinese"], in: ["india", "indian"], gb: ["united kingdom", "british", "uk"],
  fr: ["france", "french"], de: ["germany", "german"], es: ["spain", "spanish"],
  it: ["italy", "italian"], br: ["brazil", "brazilian"], mx: ["mexico", "mexican"],
  th: ["thailand", "thai"], tw: ["taiwan", "taiwanese"], ph: ["philippines", "filipino"],
  tr: ["turkey", "turkish"], ru: ["russia", "russian"],
};

interface DisambiguationMeta {
  tmdbOverview: string;
  tmdbCountries?: string[];
  tmdbGenres?: string[];
  tmdbCast?: string[];
  imdb?: ImdbMetadata | null;
}

function computeDisambiguationScore(
  meta: DisambiguationMeta,
  mbDescription: string,
  mbCountryName: string,
  mbGenre: string,
  mbStaffList: Array<{ name: string }>,
  mbImdbRating?: string,
  mbDuration?: string,
): number {
  let score = 0;

  if (meta.imdb && meta.imdb.plot) {
    const descScore = textJaccard(meta.imdb.plot, mbDescription);
    score += descScore * 0.5;
  } else {
    const descScore = textJaccard(meta.tmdbOverview, mbDescription);
    score += descScore * 0.5;
  }

  if (meta.imdb && meta.imdb.rating && mbImdbRating) {
    const imdbRating = parseFloat(meta.imdb.rating);
    const mbRating = parseFloat(mbImdbRating);
    if (!isNaN(imdbRating) && !isNaN(mbRating)) {
      const ratingDiff = Math.abs(imdbRating - mbRating);
      if (ratingDiff < 0.05) score += 0.3;
      else if (ratingDiff < 0.2) score += 0.2;
      else if (ratingDiff < 0.5) score += 0.1;
    }
  }

  if (meta.tmdbCountries && meta.tmdbCountries.length > 0 && mbCountryName) {
    const mbCountryLower = mbCountryName.toLowerCase();
    let countryMatch = false;
    for (const code of meta.tmdbCountries) {
      const aliases = COUNTRY_CODE_MAP[code.toLowerCase()] || [code.toLowerCase()];
      if (aliases.some((a) => mbCountryLower.includes(a) || a.includes(mbCountryLower))) {
        countryMatch = true;
        break;
      }
    }
    score += countryMatch ? 0.15 : 0;
  }

  if (meta.tmdbGenres && meta.tmdbGenres.length > 0 && mbGenre) {
    const tmdbGenreLower = meta.tmdbGenres.map((g) => g.toLowerCase());
    const mbGenreLower = mbGenre.toLowerCase();
    const genreMap: Record<string, string[]> = {
      animation: ["anime", "animation", "cartoon", "animated"],
      anime: ["anime", "animation"],
      action: ["action"], drama: ["drama"], comedy: ["comedy"],
      horror: ["horror", "thriller"], crime: ["crime"],
      "sci-fi": ["sci-fi", "science fiction"], romance: ["romance", "romantic"],
    };
    let genreOverlap = 0;
    for (const tg of tmdbGenreLower) {
      const aliases = genreMap[tg] || [tg];
      if (aliases.some((a) => mbGenreLower.includes(a))) {
        genreOverlap++;
      }
    }
    score += Math.min(genreOverlap / Math.max(tmdbGenreLower.length, 1), 1) * 0.1;
  }

  if (meta.tmdbCast && meta.tmdbCast.length > 0 && mbStaffList && mbStaffList.length > 0) {
    const tmdbNames = new Set(meta.tmdbCast.map((n) => n.toLowerCase().trim()));
    const mbNames = mbStaffList.map((s) => s.name.toLowerCase().trim());
    const castMatches = mbNames.filter((n) => tmdbNames.has(n)).length;
    score += Math.min(castMatches / Math.max(tmdbNames.size, 1), 1) * 0.1;
  }

  if (meta.imdb && meta.imdb.votes && mbImdbRating) {
    const imdbVotes = parseInt(meta.imdb.votes.replace(/,/g, ""), 10);
    if (!isNaN(imdbVotes) && imdbVotes > 50000) {
      score += 0.05;
    } else if (!isNaN(imdbVotes) && imdbVotes > 10000) {
      score += 0.03;
    }
  }

  if (meta.imdb && meta.imdb.runtime && mbDuration) {
    const imdbMinMatch = meta.imdb.runtime.match(/(\d+)/);
    const mbMinMatch = mbDuration.match(/(\d+)/);
    if (imdbMinMatch && mbMinMatch) {
      const imdbMin = parseInt(imdbMinMatch[1], 10);
      const mbMin = parseInt(mbMinMatch[1], 10);
      if (imdbMin > 0 && mbMin > 0) {
        const diff = Math.abs(imdbMin - mbMin);
        if (diff <= 2) score += 0.15;
        else if (diff <= 5) score += 0.1;
        else if (diff <= 10) score += 0.05;
      }
    }
  }

  return score;
}

export async function resolveMovieBoxStream(
  title: string,
  year: string | undefined,
  type: string,
  season?: string,
  episode?: string,
  tmdbOverview?: string,
  tmdbId?: string,
  tmdbCountries?: string[],
  tmdbGenres?: string[],
  tmdbCast?: string[],
): Promise<MbResolveResult | null> {
  if (!title || !title.trim()) {
    logger.info({ type, season, episode }, "MovieBox: skipped, no title provided");
    return null;
  }

  try {
    const yearNum = year ? parseInt(year, 10) : 0;
    const wantsTv = type === "tv";

    let imdbMeta: ImdbMetadata | null = null;
    let searchTitle = title;
    let searchYearNum = yearNum;
    let titleSource = "tmdb";

    if (tmdbId) {
      try {
        imdbMeta = await resolveImdbMetadata(tmdbId, type);
        if (imdbMeta && imdbMeta.title) {
          const imdbTitle = imdbMeta.title;
          const imdbYear = imdbMeta.year ? parseInt(imdbMeta.year, 10) : 0;
          if (imdbTitle.toLowerCase() !== title.toLowerCase() || (imdbYear && imdbYear !== yearNum)) {
            logger.info(
              { tmdbTitle: title, imdbTitle, tmdbYear: yearNum, imdbYear, imdbId: imdbMeta.imdbId },
              "MovieBox: using IMDB title for search (differs from TMDB)",
            );
          }
          searchTitle = imdbTitle;
          if (imdbYear) searchYearNum = imdbYear;
          titleSource = "imdb";
        }
      } catch (err) {
        logger.warn({ err: String(err), tmdbId }, "MovieBox: IMDB lookup failed, using TMDB title");
      }
    }

    let bestMatch: SearchItem | null = null;
    let languageVariants: MbLanguageVariant[] = [];
    let searchSource = "unknown";
    let allCandidates: SearchItem[] = [];

    const h5Result = await tryH5Search(searchTitle, searchYearNum, wantsTv);
    if (h5Result && h5Result.bestMatch) {
      bestMatch = h5Result.bestMatch;
      languageVariants = h5Result.languageVariants;
      allCandidates = h5Result.items;
      searchSource = "h5";
      logger.info({ title: searchTitle, matched: bestMatch.title, source: "h5", titleSource }, "MovieBox: H5 match found");
    }

    if (!bestMatch) {
      const bffResult = await tryBffSearch(searchTitle, searchYearNum, wantsTv);
      if (bffResult && bffResult.bestMatch) {
        bestMatch = bffResult.bestMatch;
        languageVariants = bffResult.languageVariants;
        allCandidates = bffResult.items;
        searchSource = "bff";
        logger.info({ title: searchTitle, matched: bestMatch.title, source: "bff", titleSource }, "MovieBox: BFF match found");
      }
    }

    if (!bestMatch && titleSource === "imdb" &&
        (searchTitle.toLowerCase() !== title.toLowerCase() || searchYearNum !== yearNum)) {
      logger.info({ imdbTitle: searchTitle, tmdbTitle: title, imdbYear: searchYearNum, tmdbYear: yearNum }, "MovieBox: IMDB search got no results, retrying with TMDB title/year");
      const h5Fallback = await tryH5Search(title, yearNum, wantsTv);
      if (h5Fallback && h5Fallback.bestMatch) {
        bestMatch = h5Fallback.bestMatch;
        languageVariants = h5Fallback.languageVariants;
        allCandidates = h5Fallback.items;
        searchSource = "h5";
        titleSource = "tmdb-fallback";
      }
      if (!bestMatch) {
        const bffFallback = await tryBffSearch(title, yearNum, wantsTv);
        if (bffFallback && bffFallback.bestMatch) {
          bestMatch = bffFallback.bestMatch;
          languageVariants = bffFallback.languageVariants;
          allCandidates = bffFallback.items;
          searchSource = "bff";
          titleSource = "tmdb-fallback";
        }
      }
    }

    if (!bestMatch) {
      logger.info({ title: searchTitle, year, titleSource }, "MovieBox: no match from BFF or H5");
      return null;
    }

    const disambigMeta: DisambiguationMeta | null = tmdbOverview
      ? { tmdbOverview, tmdbCountries, tmdbGenres, tmdbCast, imdb: imdbMeta }
      : null;

    if (disambigMeta && allCandidates.length > 1) {
      const closeMatches = allCandidates.filter((item) => {
        if (item.type !== undefined) {
          const isTvItem = item.type === 2;
          if (wantsTv !== isTvItem) return false;
        }
        const sim = titleSimilarity(title, item.title);
        if (sim < 0.7) return false;
        const itemYear = item.releaseYear || item.year || 0;
        if (yearNum && itemYear && Math.abs(itemYear - yearNum) > 2) return false;
        return true;
      });

      if (closeMatches.length > 1) {
        logger.info({ title, candidates: closeMatches.length }, "MovieBox: disambiguating same-name candidates via TMDB metadata");
        let bestDisambigScore = -1;
        let bestDisambigMatch: SearchItem | null = null;

        for (const candidate of closeMatches.slice(0, 4)) {
          try {
            const candidateId = candidate.subjectId;
            if (!candidateId) continue;
            const detail = await getSubjectDetail(candidateId);
            if (!detail) continue;
            const score = computeDisambiguationScore(
              disambigMeta,
              detail.description || "",
              detail.countryName || "",
              detail.genre || "",
              detail.staffList || [],
              detail.imdbRatingValue || "",
              detail.duration || "",
            );
            logger.info({ candidate: candidate.title, candidateId, score }, "MovieBox: disambiguation score");
            if (score > bestDisambigScore) {
              bestDisambigScore = score;
              bestDisambigMatch = candidate;
            }
          } catch {}
        }

        if (bestDisambigMatch && bestDisambigMatch.subjectId !== bestMatch.subjectId && bestDisambigScore >= 0.08) {
          let currentMatchScore = 0;
          try {
            const currentDetail = await getSubjectDetail(bestMatch.subjectId);
            if (currentDetail) {
              currentMatchScore = computeDisambiguationScore(
                disambigMeta,
                currentDetail.description || "",
                currentDetail.countryName || "",
                currentDetail.genre || "",
                currentDetail.staffList || [],
                currentDetail.imdbRatingValue || "",
                currentDetail.duration || "",
              );
            }
          } catch {}
          if (bestDisambigScore > currentMatchScore + 0.03) {
            logger.info(
              { title, from: bestMatch.subjectId, to: bestDisambigMatch.subjectId, oldScore: currentMatchScore, newScore: bestDisambigScore },
              "MovieBox: disambiguation changed best match"
            );
            bestMatch = bestDisambigMatch;
          }
        }
      }
    }

    const seenLangs = new Set<string>();
    const dedupedLanguages = languageVariants.filter((lv) => {
      const key = lv.name.toLowerCase();
      if (seenLangs.has(key)) return false;
      seenLangs.add(key);
      return true;
    });

    let subjectId = bestMatch.subjectId;

    if (searchSource === "h5" && bestMatch.detailPath) {
      const detailData = await mbGet(
        `/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(bestMatch.detailPath)}`
      );
      const detail = detailData as {
        data?: {
          subject?: { subjectId?: string };
          resource?: { seasons?: Array<{ se: number; maxEp: number }> };
        };
      };
      subjectId = detail?.data?.subject?.subjectId || bestMatch.subjectId;
    }

    if (!subjectId) {
      logger.warn({ title, searchSource }, "MovieBox: no subjectId found");
      return null;
    }

    let dubsList: BffDubEntry[] = [];
    let matchedDetail: Awaited<ReturnType<typeof bffGetSubjectDetail>> = null;
    try {
      matchedDetail = await getSubjectDetail(subjectId);
      if (matchedDetail?.dubs && matchedDetail.dubs.length > 0) {
        dubsList = [...matchedDetail.dubs];
        logger.info({ title, subjectId, dubsCount: dubsList.length }, "MovieBox: dubs array loaded");
      }
    } catch (err) {
      logger.warn({ err: String(err), subjectId }, "MovieBox: failed to fetch dubs");
    }

    if (imdbMeta && matchedDetail) {
      const mbDurSec = matchedDetail.durationSeconds || parseDurationToSeconds(matchedDetail.duration);
      const sig = imdbSignalsMatch(
        imdbMeta.rating, imdbMeta.runtime,
        matchedDetail.imdbRatingValue, mbDurSec,
      );
      if (sig.bothBad) {
        logger.warn(
          {
            title: searchTitle, matchedTitle: matchedDetail.title,
            imdbRating: imdbMeta.rating, mbRating: matchedDetail.imdbRatingValue,
            imdbRuntime: imdbMeta.runtime, mbDurationSec: mbDurSec,
          },
          "MovieBox: IMDB verification FAILED (rating+runtime mismatch), trying next candidate",
        );
        const altCandidates = allCandidates.filter((c) => {
          if (c.subjectId === subjectId) return false;
          if (extractLangTag(c.title)) return false;
          if (titleSimilarity(searchTitle, c.title) < 0.5) return false;
          if (!passesBidirectionalCoverage(searchTitle, c.title)) return false;
          const cYear = c.releaseYear || c.year || 0;
          if (searchYearNum && cYear && Math.abs(cYear - searchYearNum) > 2) return false;
          return true;
        });
        for (const altCandidate of altCandidates.slice(0, 4)) {
          try {
            const altDetail = await getSubjectDetail(altCandidate.subjectId);
            if (!altDetail) continue;
            const altSig = imdbSignalsMatch(
              imdbMeta.rating, imdbMeta.runtime,
              altDetail.imdbRatingValue,
              altDetail.durationSeconds || parseDurationToSeconds(altDetail.duration),
            );
            if (altSig.ratingOk && altSig.runtimeOk) {
              logger.info(
                { title: searchTitle, from: subjectId, to: altCandidate.subjectId, altTitle: altCandidate.title },
                "MovieBox: IMDB verification switched to alternative candidate",
              );
              subjectId = altCandidate.subjectId;
              bestMatch = altCandidate;
              matchedDetail = altDetail;
              dubsList = altDetail.dubs ? [...altDetail.dubs] : [];
              break;
            }
          } catch {}
        }
      } else if (!sig.ratingOk || !sig.runtimeOk) {
        logger.warn(
          {
            title: searchTitle, matchedTitle: matchedDetail.title,
            imdbRating: imdbMeta.rating, mbRating: matchedDetail.imdbRatingValue,
            imdbRuntime: imdbMeta.runtime, mbDurationSec: mbDurSec,
            ratingOk: sig.ratingOk, runtimeOk: sig.runtimeOk,
          },
          "MovieBox: IMDB verification partial mismatch (proceeding with caution)",
        );
      }
    }

    const closeMatchCandidates = allCandidates.filter((item) => {
      if (item.subjectId === subjectId) return false;
      if (item.type !== undefined) {
        const isTvItem = item.type === 2;
        if (wantsTv !== isTvItem) return false;
      }
      const sim = titleSimilarity(searchTitle, item.title);
      if (sim < 0.7) return false;
      const itemYear = item.releaseYear || item.year || 0;
      if (yearNum && itemYear && Math.abs(itemYear - yearNum) > 2) return false;
      if (!passesBidirectionalCoverage(searchTitle, item.title)) return false;
      return true;
    });

    if (closeMatchCandidates.length > 0) {
      const seenLanCodes = new Set(dubsList.map((d) => d.lanCode));
      for (const candidate of closeMatchCandidates.slice(0, 5)) {
        try {
          const candidateDetail = await getSubjectDetail(candidate.subjectId);
          if (!candidateDetail?.dubs || candidateDetail.dubs.length === 0) continue;

          if (imdbMeta) {
            const candSig = imdbSignalsMatch(
              imdbMeta.rating, imdbMeta.runtime,
              candidateDetail.imdbRatingValue,
              candidateDetail.durationSeconds || parseDurationToSeconds(candidateDetail.duration),
            );
            if (!candSig.ratingOk || !candSig.runtimeOk) {
              logger.info(
                {
                  title: searchTitle, candidate: candidate.title, candidateId: candidate.subjectId,
                  ratingOk: candSig.ratingOk, runtimeOk: candSig.runtimeOk,
                },
                "MovieBox: skipping dub merge candidate (IMDB verification failed)",
              );
              continue;
            }
          }

          for (const dub of candidateDetail.dubs) {
            if (!seenLanCodes.has(dub.lanCode)) {
              dubsList.push(dub);
              seenLanCodes.add(dub.lanCode);
            }
          }
        } catch {}
      }
      if (dubsList.length > 0) {
        logger.info({ title, subjectId, mergedDubsCount: dubsList.length, candidatesChecked: closeMatchCandidates.length }, "MovieBox: merged dubs from multiple clusters");
      }
    }

    for (const dub of dubsList) {
      if (!dub.original) {
        dub.lanName = displayLangName(dub.lanName, dub.lanCode);
      }
    }

    try {
      const existingLangNames = dubsList.map((d) => ({ name: d.lanName, detailPath: "", subjectId: d.subjectId }));
      const probeVariants = await probeLanguageVariants(title, year, type, season, episode, existingLangNames, imdbMeta);
      const seenSubjectIds = new Set(dubsList.map((d) => d.subjectId));
      const seenNormKeys = new Set(dubsList.map((d) => normalizeLangKey(d.lanName)));
      for (const variant of probeVariants) {
        if (!variant.subjectId || seenSubjectIds.has(variant.subjectId)) continue;
        const normKey = normalizeLangKey(variant.name);
        if (seenNormKeys.has(normKey)) continue;
        seenNormKeys.add(normKey);
        const probeLanCode = variant.name.toLowerCase().slice(0, 3);
        dubsList.push({
          subjectId: variant.subjectId as string,
          lanName: displayLangName(variant.name, probeLanCode),
          lanCode: probeLanCode,
          original: false,
        });
      }
      if (probeVariants.length > 0) {
        logger.info({ title, totalDubs: dubsList.length, probed: probeVariants.length }, "MovieBox: merged probe-discovered dubs");
      }
    } catch (err) {
      logger.warn({ err: String(err), title }, "MovieBox: probe for additional dubs failed");
    }

    let se = wantsTv && season ? parseInt(season, 10) : 0;
    let ep = wantsTv && episode ? parseInt(episode, 10) : 0;
    const origSe = se;
    const origEp = ep;

    let resourceSubtitles: MbSubtitle[] = [];

    const playData = await mbGet(
      `/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(subjectId)}&resolution=1080&se=${se}&ep=${ep}`
    );
    let streams = parseStreams(playData);
    let streamSource = streams.length > 0 ? "h5" : "";

    if (streams.length === 0) {
      streams = await tryBffPlayInfo(subjectId, se, ep);
      if (streams.length > 0) streamSource = "bff-auth";
    }

    if (streams.length === 0) {
      const resourceResult = await tryBffResource(subjectId, se, ep, title);
      if (resourceResult.streams.length > 0) {
        streams = resourceResult.streams;
        streamSource = "bff-resource";
        resourceSubtitles = resourceResult.subtitles;
      }
    }

    if (streams.length === 0 && wantsTv && se > 0 && ep > 0) {
      const remapped = await remapSeasonEpisode(subjectId, se, ep);
      if (remapped) {
        logger.info(
          { title, from: `S${se}E${ep}`, to: `S${remapped.se}E${remapped.ep}` },
          "MovieBox: season/episode remapped"
        );
        se = remapped.se;
        ep = remapped.ep;
        const remapPlayData = await mbGet(
          `/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(subjectId)}&resolution=1080&se=${se}&ep=${ep}`
        );
        streams = parseStreams(remapPlayData);
        if (streams.length > 0) {
          streamSource = "h5";
        } else {
          streams = await tryBffPlayInfo(subjectId, se, ep);
          if (streams.length > 0) streamSource = "bff-auth";
        }
        if (streams.length === 0) {
          const remapResource = await tryBffResource(subjectId, se, ep, title);
          if (remapResource.streams.length > 0) {
            streams = remapResource.streams;
            streamSource = "bff-resource";
            resourceSubtitles = remapResource.subtitles;
          }
        }
      }
    }

    if (streams.length === 0 && dubsList.length > 0) {
      logger.info({ title, subjectId, dubs: dubsList.length }, "MovieBox: no streams from best match, trying dub variants");
      for (const dub of dubsList) {
        if (dub.subjectId === subjectId) continue;
        try {
          const dubResult = await resolveMovieBoxLanguageStream(
            "", season, episode, dub.subjectId
          );
          if (dubResult && dubResult.streams.length > 0) {
            logger.info(
              { title, dub: dub.lanName, dubSubjectId: dub.subjectId, streams: dubResult.streams.length },
              "MovieBox: resolved via dub variant fallback"
            );
            subjectId = dub.subjectId;
            streams = dubResult.streams;
            break;
          }
        } catch {}
      }
    }

    if (streams.length === 0 && dedupedLanguages.length > 0) {
      logger.info({ title, subjectId, variants: dedupedLanguages.length }, "MovieBox: trying search-based language variants as last resort");
      for (const variant of dedupedLanguages) {
        try {
          const variantResult = await resolveMovieBoxLanguageStream(
            variant.detailPath, season, episode, variant.subjectId
          );
          if (variantResult && variantResult.streams.length > 0) {
            const result: MbResolveResult = {
              streams: variantResult.streams,
              languages: dedupedLanguages.filter((l) => l.subjectId !== variant.subjectId),
              dubs: dubsList,
              currentSubjectId: variant.subjectId || subjectId,
              proxyBase: variantResult.proxyBase,
            };
            if (imdbMeta) {
              result.imdbId = imdbMeta.imdbId;
              result.imdbTitle = imdbMeta.title;
              result.imdbRating = imdbMeta.rating;
            }
            return result;
          }
        } catch {}
      }
    }

    if (streams.length === 0) {
      logger.info({ title, subjectId, searchSource }, "MovieBox: no streams from play endpoint");
      return null;
    }

    logger.info(
      { title, streams: streams.length, dubs: dubsList.length, languages: dedupedLanguages.length, searchSource, streamSource },
      "MovieBox: resolved successfully"
    );

    const result: MbResolveResult = {
      streams,
      languages: dedupedLanguages,
      dubs: dubsList,
      currentSubjectId: subjectId,
      proxyBase: "",
    };
    if (se !== origSe || ep !== origEp) {
      result.remappedSeason = se;
      result.remappedEpisode = ep;
    }
    if (resourceSubtitles.length > 0) {
      result.subtitles = resourceSubtitles;
    }
    if (imdbMeta) {
      result.imdbId = imdbMeta.imdbId;
      result.imdbTitle = imdbMeta.title;
      result.imdbRating = imdbMeta.rating;
    }
    return result;
  } catch (err) {
    logger.error({ err: String(err), title }, "MovieBox resolve error");
    return null;
  }
}

export async function resolveMovieBoxLanguageStream(
  detailPath: string,
  season?: string,
  episode?: string,
  directSubjectId?: string
): Promise<MbPlayResult | null> {
  try {
    let subjectId = directSubjectId;

    if (!subjectId && detailPath) {
      const detailData = await mbGet(
        `/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`
      );
      const detail = detailData as {
        data?: {
          subject?: { subjectId?: string };
          resource?: { seasons?: Array<{ se: number; maxEp: number }> };
        };
      };
      subjectId = detail?.data?.subject?.subjectId;
    }

    if (!subjectId) return null;

    let langTitle: string | undefined;
    try {
      const detail = await getSubjectDetail(subjectId);
      if (detail?.title) langTitle = detail.title;
    } catch {}

    let se = season ? parseInt(season, 10) : 0;
    let ep = episode ? parseInt(episode, 10) : 0;

    let resourceSubtitles: MbSubtitle[] = [];

    const langPlayData = await mbGet(
      `/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(subjectId)}&resolution=1080&se=${se}&ep=${ep}`
    );
    let streams = parseStreams(langPlayData);

    if (streams.length === 0) {
      streams = await tryBffPlayInfo(subjectId, se, ep);
    }

    if (streams.length === 0) {
      const resourceResult = await tryBffResource(subjectId, se, ep, langTitle);
      if (resourceResult.streams.length > 0) {
        streams = resourceResult.streams;
        resourceSubtitles = resourceResult.subtitles;
      }
    }

    if (streams.length === 0 && se > 0 && ep > 0) {
      const remapped = await remapSeasonEpisode(subjectId, se, ep);
      if (remapped) {
        se = remapped.se;
        ep = remapped.ep;
        const remapData = await mbGet(
          `/wefeed-h5api-bff/subject/play?subjectId=${encodeURIComponent(subjectId)}&resolution=1080&se=${se}&ep=${ep}`
        );
        streams = parseStreams(remapData);
        if (streams.length === 0) {
          streams = await tryBffPlayInfo(subjectId, se, ep);
        }
        if (streams.length === 0) {
          const remapResource = await tryBffResource(subjectId, se, ep, langTitle);
          if (remapResource.streams.length > 0) {
            streams = remapResource.streams;
            resourceSubtitles = remapResource.subtitles;
          }
        }
      }
    }

    if (streams.length === 0) return null;

    const result: MbPlayResult = {
      streams,
      proxyBase: "",
    };
    if (resourceSubtitles.length > 0) {
      result.subtitles = resourceSubtitles;
    }
    return result;
  } catch (err) {
    logger.error({ err: String(err), detailPath, directSubjectId }, "MovieBox language resolve error");
    return null;
  }
}

const PROBE_LANGUAGES = [
  "English", "Hindi", "Telugu", "Tamil", "Spanish",
  "French", "Korean", "Chinese", "Arabic", "Portuguese",
];

function matchAndValidateVariant(
  items: SearchItem[],
  title: string,
  lang: string,
  yearNum: number,
  wantsTv: boolean,
  triedIds: Set<string>,
  imdbMeta?: ImdbMetadata | null,
): { candidates: Array<{ item: SearchItem; tag: string }>; } {
  const candidates: Array<{ item: SearchItem; tag: string }> = [];

  for (const item of items) {
    if (item.subjectId && triedIds.has(item.subjectId)) continue;
    if (item.type !== undefined) {
      const isTvItem = item.type === 2;
      if (wantsTv !== isTvItem) continue;
    }
    const itemYear = item.releaseYear || item.year || 0;
    if (yearNum && itemYear && Math.abs(itemYear - yearNum) > 1) continue;
    const tag = extractLangTag(item.title);
    if (!tag) continue;
    if (tag.toLowerCase() !== lang.toLowerCase()) continue;

    const sim = titleSimilarity(title, item.title);
    if (sim < 0.5) continue;

    if (!passesBidirectionalCoverage(title, item.title)) continue;

    if (imdbMeta && imdbMeta.rating && item.imdbRatingValue) {
      const imdbR = parseFloat(imdbMeta.rating);
      const mbR = parseFloat(item.imdbRatingValue);
      if (imdbR && mbR && Math.abs(imdbR - mbR) > 0.5) {
        logger.info(
          { title, itemTitle: item.title, imdbRating: imdbMeta.rating, mbRating: item.imdbRatingValue },
          "lang-probe: skipping candidate (IMDB rating too different)",
        );
        continue;
      }
    }

    candidates.push({ item, tag });
  }
  return { candidates };
}

async function probeOneLanguage(
  title: string,
  lang: string,
  yearNum: number,
  wantsTv: boolean,
  season?: string,
  episode?: string,
  imdbMeta?: ImdbMetadata | null,
): Promise<MbLanguageVariant | null> {
  try {
    const keyword = `${title} ${lang}`;
    const triedIds = new Set<string>();

    let h5Items: SearchItem[] = [];
    try {
      const h5Result = await mbPost("/wefeed-h5api-bff/subject/search", {
        keyword,
        page: 1,
        perPage: 10,
      });
      const rawH5 = ((h5Result as { data?: { items?: Record<string, unknown>[] } })?.data?.items) || [];
      h5Items = mapH5Items(rawH5);
    } catch {}

    if (h5Items.length > 0) {
      const { candidates } = matchAndValidateVariant(h5Items, title, lang, yearNum, wantsTv, triedIds, imdbMeta);
      for (const { item, tag } of candidates) {
        triedIds.add(item.subjectId);
        const result = await resolveMovieBoxLanguageStream(
          item.detailPath || "", season, episode, item.subjectId
        );
        if (result && result.streams.length > 0) {
          return { name: tag, detailPath: item.detailPath || "", subjectId: item.subjectId };
        }
      }
    }

    let bffItems: SearchItem[] = [];
    try {
      const bffResult = await bffSearch(keyword, 1, 10);
      if (bffResult.items && bffResult.items.length > 0) {
        bffItems = bffResult.items.map((item) => ({
          title: item.title,
          subjectId: item.subjectId,
          detailPath: "",
          releaseYear: item.releaseDate ? parseInt(item.releaseDate, 10) : 0,
          year: item.releaseDate ? parseInt(item.releaseDate, 10) : 0,
          type: item.subjectType,
          subjectType: item.subjectType === 1 ? "movie" : "tv",
          imdbRatingValue: item.imdbRatingValue || "",
        }));
      }
    } catch {}

    if (bffItems.length > 0) {
      const { candidates } = matchAndValidateVariant(bffItems, title, lang, yearNum, wantsTv, triedIds, imdbMeta);
      for (const { item, tag } of candidates) {
        triedIds.add(item.subjectId);
        const result = await resolveMovieBoxLanguageStream(
          item.detailPath || "", season, episode, item.subjectId
        );
        if (result && result.streams.length > 0) {
          return { name: tag, detailPath: item.detailPath || "", subjectId: item.subjectId };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function probeLanguageVariants(
  title: string,
  year: string | undefined,
  type: string,
  season?: string,
  episode?: string,
  initialVariants?: MbLanguageVariant[],
  imdbMeta?: ImdbMetadata | null,
): Promise<MbLanguageVariant[]> {
  const yearNum = year ? parseInt(year, 10) : 0;
  const wantsTv = type === "tv";

  const existingNames = new Set<string>(
    (initialVariants || []).map((v) => v.name.toLowerCase())
  );
  const languagesToProbe = PROBE_LANGUAGES.filter(
    (l) => !existingNames.has(l.toLowerCase())
  );

  logger.info(
    { title, probing: languagesToProbe.length, existing: existingNames.size },
    "lang-probe: starting probes"
  );

  const probeResults = await Promise.allSettled(
    languagesToProbe.map((lang) =>
      probeOneLanguage(title, lang, yearNum, wantsTv, season, episode, imdbMeta)
    )
  );

  const discovered: MbLanguageVariant[] = [];
  for (const r of probeResults) {
    if (r.status === "fulfilled" && r.value) {
      discovered.push(r.value);
    }
  }

  const merged = [...(initialVariants || []), ...discovered];
  const seenLangs = new Set<string>();
  const deduped = merged.filter((lv) => {
    const key = lv.name.toLowerCase();
    if (seenLangs.has(key)) return false;
    seenLangs.add(key);
    return true;
  });

  logger.info(
    { title, probed: languagesToProbe.length, discovered: discovered.length, total: deduped.length },
    "lang-probe: complete"
  );

  return deduped;
}

export async function h5GetSubjectDetail(subjectId: string): Promise<Record<string, unknown> | null> {
  try {
    const detailData = await mbGet(
      `/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(subjectId)}`
    );
    const detail = detailData as {
      data?: {
        subject?: Record<string, unknown>;
        resource?: { seasons?: Array<{ se: number; maxEp: number; resolutions?: number[] }> };
      };
    };
    if (detail?.data?.subject) {
      const s = detail.data.subject;
      return {
        subjectId: String(s.subjectId || s.subject_id || subjectId),
        title: String(s.title || s.name || ""),
        description: String(s.description || s.desc || s.overview || ""),
        cover: s.cover || { url: String(s.coverUrl || s.cover_url || s.poster || "") },
        genre: String(s.genre || s.genres || ""),
        releaseDate: String(s.releaseDate || s.release_date || ""),
        duration: String(s.duration || ""),
        subjectType: Number(s.subjectType || s.subject_type || s.type || 1),
        countryName: String(s.countryName || s.country_name || s.country || ""),
        imdbRatingValue: String(s.imdbRatingValue || s.imdb_rating || s.rating || ""),
        staffList: (s.staffList || s.staff_list || []) as Array<Record<string, unknown>>,
        dubs: (s.dubs || []) as Array<Record<string, unknown>>,
        seasons: detail.data.resource?.seasons || [],
        _source: "h5",
      };
    }
    return null;
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "h5GetSubjectDetail failed");
    return null;
  }
}

export async function h5GetSeasonInfo(subjectId: string): Promise<{ subjectId: string; seasons: Array<{ se: number; maxEp: number; resolutions?: number[] }> } | null> {
  try {
    const h5Detail = await h5GetSubjectDetail(subjectId);
    if (h5Detail?.seasons && Array.isArray(h5Detail.seasons) && (h5Detail.seasons as unknown[]).length > 0) {
      return {
        subjectId,
        seasons: h5Detail.seasons as Array<{ se: number; maxEp: number; resolutions?: number[] }>,
      };
    }
    return null;
  } catch (err) {
    logger.warn({ err: String(err), subjectId }, "h5GetSeasonInfo failed");
    return null;
  }
}
