import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  memo,
} from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { MediaPlayer, MediaProvider, Track } from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import {
  FaArrowLeft,
  FaChevronDown,
  FaPlay,
  FaRedo,
  FaSpinner,
} from "react-icons/fa";
import {
  fetchMbDetail,
  fetchMbSeasons,
  fetchMbStream,
  fetchMbSubtitles,
  mbCoverUrl,
} from "./Fetcher";

const LAN_CODE_NAMES = {
  ja: "Japanese", en: "English", hi: "Hindi", kn: "Kannada",
  ml: "Malayalam", ta: "Tamil", te: "Telugu", ko: "Korean",
  zh: "Chinese", "zh-Hans": "Chinese", "zh-Hant": "Chinese (Traditional)",
  es: "Spanish", esla: "Spanish (LA)", fr: "French", de: "German",
  pt: "Portuguese", ar: "Arabic", ru: "Russian", id: "Indonesian",
  th: "Thai", vi: "Vietnamese", ms: "Malay",
};

function dubLabel(dub) {
  if (!dub) return "Audio";
  const name = LAN_CODE_NAMES[dub.lanCode];
  if (dub.original) return name || dub.lanName || "Original";
  return dub.lanName || name || "Audio";
}

import { getIdFromDetailSlug, getTitleFromDetailSlug } from "./urlUtils";
import { saveToContinueWatching } from "../../utils/continueWatching";
import SEO from "./SEO";
import { useProgressWhile } from "../../context/ProgressContext";
import { useWatchlist } from "../../context/WatchlistContext";

const BLOCK_SIZE = 50;

function buildVideoSources(streamList, quality) {
  if (!streamList?.length) return [];
  const sorted = [...streamList].sort((a, b) => {
    const qa = parseInt(a.quality || a.resolutions || a.resolution || 720, 10);
    const qb = parseInt(b.quality || b.resolutions || b.resolution || 720, 10);
    return qb - qa;
  });
  if (quality) {
    const match = sorted.find(
      (s) =>
        String(s.quality || s.resolutions || s.resolution || "").startsWith(
          quality
        )
    );
    const src = match || sorted[0];
    return src ? [{ src: src.url, type: "video/mp4" }] : [];
  }
  return sorted.slice(0, 1).map((s) => ({ src: s.url, type: "video/mp4" }));
}

function getQualityLabel(s) {
  const q = parseInt(s.quality || s.resolutions || s.resolution || 0, 10);
  return q ? `${q}p` : "?";
}

function BottomSheet({ open, onClose, title, count, children }) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col justify-end transition-opacity duration-300 ${
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className={`relative bg-[#181818] rounded-t-2xl max-h-[75vh] flex flex-col transition-transform duration-300 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 bg-white/20 rounded-full" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <span className="text-white font-semibold text-base">{title}</span>
          {count != null && (
            <span className="text-gray-400 text-sm">{count} options</span>
          )}
        </div>
        <div className="overflow-y-auto flex-1 pb-6">{children}</div>
      </div>
    </div>
  );
}

function EpisodeGrid({ episodes, activeEpisode, onSelect, blockSize = BLOCK_SIZE }) {
  const totalEps = episodes.length;
  const blockCount = Math.ceil(totalEps / blockSize);
  const [activeBlock, setActiveBlock] = useState(0);

  useEffect(() => {
    if (activeEpisode == null) return;
    const idx = episodes.findIndex((e) => e.episode_number === activeEpisode);
    if (idx >= 0) setActiveBlock(Math.floor(idx / blockSize));
  }, [activeEpisode, episodes, blockSize]);

  const blockStart = activeBlock * blockSize;
  const blockEps = episodes.slice(blockStart, blockStart + blockSize);
  const firstNum = blockEps[0]?.episode_number;
  const lastNum = blockEps[blockEps.length - 1]?.episode_number;
  const numCols = Math.ceil(blockEps.length / 2);

  if (!episodes.length) return null;

  return (
    <div className="animate-fadeIn">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-white font-bold text-base">Episode {activeEpisode}</span>
          <span className="text-gray-500 text-sm">/ {totalEps}</span>
        </div>
        {blockCount > 1 && (
          <span className="text-[10px] font-semibold text-red-400 bg-red-600/10 border border-red-600/25 px-2.5 py-1 rounded-full uppercase tracking-wide">
            {firstNum}–{lastNum}
          </span>
        )}
      </div>

      {/* Block range selector */}
      {blockCount > 1 && (
        <div className="overflow-x-auto scrollbar-hide mb-3">
          <div className="flex gap-1.5 pb-1" style={{ width: "max-content" }}>
            {Array.from({ length: blockCount }, (_, i) => {
              const s = episodes[i * blockSize]?.episode_number;
              const e = episodes[Math.min((i + 1) * blockSize - 1, totalEps - 1)]?.episode_number;
              const isActive = activeBlock === i;
              return (
                <button
                  key={i}
                  onClick={() => setActiveBlock(i)}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition-all border ${
                    isActive
                      ? "bg-red-600 border-red-500 text-white shadow-md shadow-red-900/40"
                      : "bg-transparent border-white/12 text-gray-400 hover:border-white/25 hover:text-white"
                  }`}
                >
                  {s}–{e}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Episode grid */}
      <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${numCols}, minmax(52px, 1fr))`,
            gridTemplateRows: "auto auto",
            gridAutoFlow: "column",
            gap: "6px",
          }}
        >
          {blockEps.map((ep) => {
            const active = ep.episode_number === activeEpisode;
            return (
              <button
                key={ep.episode_number}
                onClick={() => onSelect(ep.episode_number)}
                className={`h-10 rounded-xl text-sm font-bold transition-all active:scale-95 flex items-center justify-center border ${
                  active
                    ? "bg-red-600 border-red-500 text-white shadow-lg shadow-red-900/50"
                    : "bg-transparent border-white/12 text-gray-400 hover:border-white/30 hover:text-white"
                }`}
              >
                {String(ep.episode_number).padStart(2, "0")}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const WatchPage = ({ type }) => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const subjectId = getIdFromDetailSlug(slug);
  const titleHint = getTitleFromDetailSlug(slug);

  const initSeason = parseInt(searchParams.get("season") || "1", 10) || 1;
  const initEpisode = parseInt(searchParams.get("episode") || "1", 10) || 1;

  const [detail, setDetail] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState(null);

  const [season, setSeason] = useState(initSeason);
  const [episode, setEpisode] = useState(initEpisode);

  const [streamData, setStreamData] = useState(null);
  const [streamLoading, setStreamLoading] = useState(true);
  const [streamError, setStreamError] = useState(null);

  const [subtitles, setSubtitles] = useState([]);

  const [dubs, setDubs] = useState([]);
  const [activeDubId, setActiveDubId] = useState(null);

  const [selectedQuality, setSelectedQuality] = useState(null);
  const [dubSheetOpen, setDubSheetOpen] = useState(false);
  const [seasonSheetOpen, setSeasonSheetOpen] = useState(false);

  const playerKey = useRef(0);
  const playerRef = useRef(null);
  const { user } = useWatchlist();

  // ── Progress tracking (resume from timestamp) ──────────────────────────
  const progressKey = useCallback(
    () =>
      type === "tv"
        ? `wf_p_${subjectId}_s${season}e${episode}`
        : `wf_p_${subjectId}`,
    [type, subjectId, season, episode]
  );

  useEffect(() => {
    const save = () => {
      const t = playerRef.current?.currentTime;
      if (t > 5) {
        try {
          localStorage.setItem(progressKey(), String(Math.floor(t)));
        } catch {}
      }
    };
    const timer = setInterval(save, 8000);
    return () => {
      save();
      clearInterval(timer);
    };
  }, [progressKey]);

  useProgressWhile(detailLoading);

  useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    const loadDetail = async () => {
      try {
        const [detailData, seasonsData] = await Promise.all([
          fetchMbDetail(subjectId, titleHint || undefined),
          type === "tv"
            ? fetchMbSeasons(subjectId).catch(() => ({ seasons: [] }))
            : Promise.resolve({ seasons: [] }),
        ]);
        if (cancelled) return;

        setDetail(detailData);

        if (type === "tv") {
          const mbSeasons = (seasonsData?.seasons || [])
            .map((s) => {
              const epCount =
                s.maxEp || s.episodeCount || s.episodes?.length || 0;
              const epList =
                s.episodes?.length > 0
                  ? s.episodes.map((e, i) => ({
                      episode_number:
                        e.episodeNumber ?? e.episode_number ?? i + 1,
                      name:
                        e.name ||
                        e.title ||
                        `Episode ${e.episodeNumber ?? e.episode_number ?? i + 1}`,
                    }))
                  : Array.from({ length: epCount }, (_, i) => ({
                      episode_number: i + 1,
                      name: `Episode ${i + 1}`,
                    }));
              return {
                season_number:
                  s.se != null ? s.se : s.seasonNumber,
                episode_count: epList.length || epCount,
                episodes: epList,
              };
            })
            .filter(
              (s) => s.season_number != null && s.episode_count > 0
            )
            .sort((a, b) => a.season_number - b.season_number);

          setSeasons(mbSeasons);

          if (mbSeasons.length > 0) {
            const validSeason =
              mbSeasons.find((s) => s.season_number === initSeason) ||
              mbSeasons[0];
            setSeason(validSeason.season_number);
            const maxEp = validSeason.episode_count;
            setEpisode(Math.min(initEpisode, maxEp));
          }
        }
      } catch {
        if (!cancelled) setDetailError("Failed to load content.");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };

    loadDetail();
    return () => { cancelled = true; };
  }, [subjectId, type, titleHint]);

  const fetchStream = useCallback(
    async (effectiveSeason, effectiveEpisode, dubSubjectId) => {
      const targetId = dubSubjectId || subjectId;
      setStreamLoading(true);
      setStreamError(null);

      try {
        const [data, subs] = await Promise.all([
          fetchMbStream(
            targetId,
            type,
            type === "tv" ? effectiveSeason : undefined,
            type === "tv" ? effectiveEpisode : undefined
          ),
          fetchMbSubtitles(targetId).catch(() => []),
        ]);

        setSubtitles(subs || []);

        if (!data) throw new Error("No stream data");

        if (data.type === "mp4" && data.streams?.length > 0) {
          const newDubs = data.dubs || [];
          if (newDubs.length > 0 && !dubSubjectId) {
            setDubs(newDubs);
            // If the page URL already points to a specific dub (e.g. user opened
            // "JJK Hindi" directly), find which dub matches this page's subjectId
            // and mark it active — otherwise the label defaults to dubs[0] (Original)
            // even though the audio is actually the matched dub.
            const selfDub = newDubs.find((d) => d.subjectId === subjectId);
            if (selfDub) setActiveDubId(selfDub.subjectId);
          }
          const qualities = [
            ...new Set(
              data.streams
                .map((s) => getQualityLabel(s))
                .filter((q) => q !== "?")
            ),
          ].sort((a, b) => parseInt(b) - parseInt(a));

          setStreamData({
            streams: data.streams,
            qualities,
            proxyBase: data.proxyBase ?? "",
          });
          playerKey.current += 1;
        } else if (data.type === "hls" && data.streamUrl) {
          setStreamData({
            hlsUrl: data.streamUrl,
            qualities: [],
            streams: [],
            proxyBase: "",
          });
          playerKey.current += 1;
        } else {
          throw new Error("No playable stream");
        }
      } catch {
        setStreamError("Stream unavailable. Try another episode or dub.");
        setStreamData(null);
      } finally {
        setStreamLoading(false);
      }
    },
    [subjectId, type]
  );

  useEffect(() => {
    if (detailLoading) return;
    fetchStream(season, episode, activeDubId);
  }, [season, episode, activeDubId, detailLoading]);

  useEffect(() => {
    if (!detail || type !== "tv") return;
    const next = new URLSearchParams(searchParams);
    next.set("season", String(season));
    next.set("episode", String(episode));
    setSearchParams(next, { replace: true });
  }, [season, episode, detail, type]);

  useEffect(() => {
    if (!detail) return;
    saveToContinueWatching(user?.uid, {
      id: detail.subjectId,
      mediaType: type,
      title:
        type === "tv"
          ? `${detail.title} - S${season}E${episode}`
          : detail.title,
      poster_path: detail.cover?.url || "",
      vote_average: parseFloat(detail.imdbRatingValue) || 0,
      release_date: detail.releaseDate,
      ...(type === "tv" ? { season, episode } : {}),
    });
  }, [detail, season, episode, type, user]);

  const currentSeasonData = useMemo(
    () => seasons.find((s) => s.season_number === season),
    [seasons, season]
  );

  const currentEpisodeName = useMemo(() => {
    if (type !== "tv" || !currentSeasonData) return null;
    return (
      currentSeasonData.episodes.find((e) => e.episode_number === episode)
        ?.name || `Episode ${episode}`
    );
  }, [currentSeasonData, episode, type]);

  const videoSources = useMemo(() => {
    if (!streamData?.streams?.length) return [];

    const proxyBase = streamData.proxyBase || "";
    const proxied = (rawUrl) =>
      proxyBase
        ? `${proxyBase}?url=${encodeURIComponent(rawUrl)}`
        : rawUrl;

    const sorted = [...streamData.streams].sort((a, b) => {
      const qa = parseInt(a.quality || a.resolutions || a.resolution || 720, 10);
      const qb = parseInt(b.quality || b.resolutions || b.resolution || 720, 10);
      return qb - qa;
    });

    if (selectedQuality) {
      const match = sorted.find((s) => getQualityLabel(s) === selectedQuality);
      const src = match || sorted[sorted.length - 1];
      return [{ src: proxied(src.url), type: "video/mp4" }];
    }

    // Auto mode — pick the lowest quality so it starts fast
    return [{ src: proxied(sorted[sorted.length - 1].url), type: "video/mp4" }];
  }, [streamData, selectedQuality]);

  // Start time from saved progress (resume where user left off)
  const startTime = useMemo(() => {
    if (!streamData) return 0;
    return parseInt(localStorage.getItem(progressKey()) || "0", 10) || 0;
  }, [streamData, progressKey]);

  const handleEpisodeSelect = (epNum) => {
    setStreamLoading(true);
    setStreamData(null);
    setEpisode(epNum);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSeasonSelect = (seasonNum) => {
    setStreamLoading(true);
    setStreamData(null);
    setSeason(seasonNum);
    setEpisode(1);
  };

  const parseSeasonsData = useCallback((seasonsData) => {
    return (seasonsData?.seasons || [])
      .map((s) => {
        const epCount = s.maxEp || s.episodeCount || s.episodes?.length || 0;
        const epList =
          s.episodes?.length > 0
            ? s.episodes.map((e, i) => ({
                episode_number: e.episodeNumber ?? e.episode_number ?? i + 1,
                name:
                  e.name ||
                  e.title ||
                  `Episode ${e.episodeNumber ?? e.episode_number ?? i + 1}`,
              }))
            : Array.from({ length: epCount }, (_, i) => ({
                episode_number: i + 1,
                name: `Episode ${i + 1}`,
              }));
        return {
          season_number: s.se != null ? s.se : s.seasonNumber,
          episode_count: epList.length || epCount,
          episodes: epList,
        };
      })
      .filter((s) => s.season_number != null && s.episode_count > 0)
      .sort((a, b) => a.season_number - b.season_number);
  }, []);

  const handleDubSelect = useCallback(async (dub) => {
    // Stop the old video immediately — no bleed-through of old audio/video
    setStreamLoading(true);
    setStreamData(null);
    setActiveDubId(dub.subjectId);

    // 2. In parallel, re-fetch the episode list for this dub so the grid
    //    shows the correct episode count for the selected audio track.
    if (type === "tv") {
      try {
        const seasonsData = await fetchMbSeasons(dub.subjectId).catch(() => ({ seasons: [] }));
        const parsed = parseSeasonsData(seasonsData);
        if (parsed.length > 0) {
          setSeasons(parsed);
          // Only reset episode if current episode is out of range for this dub
          const targetSeason = parsed.find((s) => s.season_number === season) || parsed[0];
          if (targetSeason) {
            const maxEp = targetSeason.episode_count;
            if (episode > maxEp) setEpisode(1);
          }
        }
      } catch {}
    }
  }, [type, season, episode, parseSeasonsData]);

  const coverUrl = detail ? mbCoverUrl(detail.cover, 1280) || "" : "";
  const year = (detail?.releaseDate || "").slice(0, 4);
  const overview = detail?.description || "";

  if (detailError) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center p-6">
        <div className="bg-red-900/10 border border-red-700/30 rounded-xl p-8 max-w-sm w-full text-center">
          <p className="text-red-400 mb-5 font-medium">{detailError}</p>
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center gap-2 w-full bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-3 rounded-xl transition-all"
          >
            <FaArrowLeft /> Go Back
          </button>
        </div>
      </div>
    );
  }

  const playerTitle =
    type === "tv" && currentEpisodeName
      ? `${detail?.title || ""} S${season}E${episode} · ${currentEpisodeName}`
      : detail?.title || "";

  return (
    <div className="min-h-screen bg-[#141414] text-gray-200">
      {detail && (
        <SEO
          title={`Watch ${detail.title}${year ? ` (${year})` : ""} — WeFlix`}
          image={coverUrl}
        />
      )}

      <div className="sticky top-0 z-30 bg-[#141414]/95 backdrop-blur-sm border-b border-white/5">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            onClick={() => navigate(-1)}
            className="group flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 text-white transition-all shrink-0"
          >
            <FaArrowLeft className="text-sm group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <div className="flex-1 min-w-0">
            {detail ? (
              <p className="text-white font-semibold text-sm truncate">
                {detail.title}
              </p>
            ) : (
              <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
            )}
            {type === "tv" && currentEpisodeName && (
              <p className="text-gray-500 text-xs truncate">
                S{String(season).padStart(2, "0")}·E{String(episode).padStart(2, "0")}·{currentEpisodeName}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="w-full aspect-video bg-black relative overflow-hidden">
        {streamLoading && !streamData && (
          <div className="absolute inset-0">
            {/* Slim red progress bar at very top */}
            <div className="absolute top-0 left-0 right-0 h-0.5 z-20 overflow-hidden bg-white/5">
              <div className="h-full bg-red-600 animate-[loading-bar_1.8s_ease-in-out_infinite]" />
            </div>

            {coverUrl ? (
              <>
                <img
                  src={coverUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* cinematic gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/50" />
              </>
            ) : (
              <div className="absolute inset-0 bg-[#0a0a0a]" />
            )}

            {/* Pulsing play button */}
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="relative flex items-center justify-center w-16 h-16">
                <div className="absolute inset-0 rounded-full bg-red-600/30 animate-ping" />
                <div className="relative w-14 h-14 rounded-full bg-black/60 border-2 border-white/20 backdrop-blur-sm flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6 ml-1 opacity-80">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Title at bottom if available */}
            {detail && (
              <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 z-10">
                <p className="text-white/70 text-xs font-medium truncate">{playerTitle || detail.title}</p>
              </div>
            )}
          </div>
        )}

        {streamError && !streamLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0a] text-center px-4">
            <p className="text-gray-400 text-sm">{streamError}</p>
            <button
              onClick={() => fetchStream(season, episode, activeDubId)}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all"
            >
              <FaRedo className="text-xs" /> Retry
            </button>
          </div>
        )}

        {streamData && (streamData.hlsUrl || videoSources.length > 0) && (
          <div
            key={`player-${playerKey.current}`}
            className="w-full h-full animate-fadeIn"
          >
            <MediaPlayer
              ref={playerRef}
              title={playerTitle}
              src={
                streamData.hlsUrl
                  ? { src: streamData.hlsUrl, type: "application/x-mpegurl" }
                  : videoSources
              }
              startTime={startTime}
              autoPlay
              playsInline
              style={{ width: "100%", height: "100%" }}
            >
              <MediaProvider />
              {subtitles.map((sub, i) => (
                <Track
                  key={sub.subtitleId || sub.url || i}
                  kind="subtitles"
                  src={sub.url || sub.subtitleUrl || ""}
                  label={sub.lanName || sub.language || `Sub ${i + 1}`}
                  lang={sub.lan || sub.langCode || ""}
                />
              ))}
              <DefaultVideoLayout icons={defaultLayoutIcons} />
            </MediaPlayer>
          </div>
        )}
      </div>

      <div className="px-4 pt-4 pb-3">
        {detailLoading ? (
          <div className="space-y-2">
            <div className="h-6 w-52 bg-white/10 rounded-lg animate-pulse" />
            <div className="h-3.5 w-36 bg-white/6 rounded animate-pulse" />
          </div>
        ) : (
          <>
            <h1 className="text-white font-bold text-[18px] leading-tight tracking-tight">
              {detail?.title}
            </h1>
            {type === "tv" && currentEpisodeName && (
              <p className="text-white/40 text-[13px] mt-1 font-medium">
                Season {season} &nbsp;·&nbsp; Ep {episode} &nbsp;—&nbsp; {currentEpisodeName}
              </p>
            )}
          </>
        )}
      </div>

      <div className="px-4 py-4 border-b border-white/5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Playback</span>
          <div className="flex-1 h-px bg-white/5" />
        </div>

        {/* Dub + Season selectors */}
        <div className="flex flex-wrap gap-2 mb-3">
          {streamLoading && !dubs.length ? (
            <div className="h-8 w-28 bg-white/8 rounded-xl animate-pulse" />
          ) : (
            dubs.length > 0 && (
              <button
                onClick={() => setDubSheetOpen(true)}
                className="flex items-center gap-2 bg-white/5 border border-white/10 hover:border-white/25 hover:bg-white/8 text-white text-xs font-medium px-3 py-2 rounded-xl transition-all"
              >
                <span className="text-white/90">
                  {dubLabel(dubs.find((d) => d.subjectId === activeDubId) || dubs[0])}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-white/40 text-[10px]">{dubs.length}</span>
                  <FaChevronDown className="text-[9px] text-white/40" />
                </div>
              </button>
            )
          )}

          {type === "tv" && seasons.length > 0 && (
            <button
              onClick={() => setSeasonSheetOpen(true)}
              className="flex items-center gap-2 bg-white/5 border border-white/10 hover:border-white/25 hover:bg-white/8 text-white text-xs font-medium px-3 py-2 rounded-xl transition-all"
            >
              <span className="text-white/90">Season {String(season).padStart(2, "0")}</span>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-white/40 text-[10px]">
                  {seasons.find((s) => s.season_number === season)?.episode_count ?? 0}ep
                </span>
                <FaChevronDown className="text-[9px] text-white/40" />
              </div>
            </button>
          )}
        </div>

        {/* Quality selector */}
        {streamData?.qualities?.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest mr-0.5">
              Quality
            </span>
            {/* Auto = lowest quality, fast load */}
            <button
              onClick={() => setSelectedQuality(null)}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all ${
                !selectedQuality
                  ? "bg-red-600 border-red-500 text-white shadow-sm shadow-red-900/50"
                  : "bg-transparent border-white/12 text-white/50 hover:text-white hover:border-white/25"
              }`}
            >
              Auto
            </button>
            {streamData.qualities.map((q) => (
              <button
                key={q}
                onClick={() => setSelectedQuality(q)}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all ${
                  selectedQuality === q
                    ? "bg-red-600 border-red-500 text-white shadow-sm shadow-red-900/50"
                    : "bg-transparent border-white/12 text-white/50 hover:text-white hover:border-white/25"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {type === "tv" && currentSeasonData?.episodes?.length > 0 && (
        <div className="px-4 py-4 border-b border-white/5">
          <EpisodeGrid
            episodes={currentSeasonData.episodes}
            activeEpisode={episode}
            onSelect={handleEpisodeSelect}
          />
        </div>
      )}

      {overview && (
        <div className="px-4 py-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Synopsis</span>
            <div className="flex-1 h-px bg-white/5" />
          </div>
          <p className="text-white/50 text-[13px] leading-relaxed">{overview}</p>
        </div>
      )}

      <div className="h-16" />

      <BottomSheet
        open={dubSheetOpen}
        onClose={() => setDubSheetOpen(false)}
        title="Audio Language"
        count={dubs.length}
      >
        {dubs.map((dub) => {
          const isActive =
            dub.subjectId === activeDubId || (!activeDubId && dub === dubs[0]);
          return (
            <button
              key={dub.subjectId}
              onClick={() => {
                handleDubSelect(dub);
                setDubSheetOpen(false);
              }}
              className={`w-full flex items-center justify-between px-5 py-4 text-sm transition-colors border-b border-white/5 ${
                isActive
                  ? "text-red-400 font-semibold bg-red-600/5"
                  : "text-gray-200 hover:bg-white/5"
              }`}
            >
              <span>{dubLabel(dub)}</span>
              {isActive && (
                <svg className="w-4 h-4 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                </svg>
              )}
            </button>
          );
        })}
      </BottomSheet>

      {type === "tv" && (
        <BottomSheet
          open={seasonSheetOpen}
          onClose={() => setSeasonSheetOpen(false)}
          title="Season"
          count={seasons.length}
        >
          {seasons.map((s) => {
            const isActive = s.season_number === season;
            return (
              <button
                key={s.season_number}
                onClick={() => {
                  handleSeasonSelect(s.season_number);
                  setSeasonSheetOpen(false);
                }}
                className={`w-full flex items-center justify-between px-5 py-4 text-sm transition-colors border-b border-white/5 ${
                  isActive
                    ? "text-red-400 font-semibold bg-red-600/5"
                    : "text-gray-200 hover:bg-white/5"
                }`}
              >
                <span>
                  Season {String(s.season_number).padStart(2, "0")}
                  <span className="text-gray-500 ml-2 text-xs font-normal">
                    ({s.episode_count} ep{s.episode_count !== 1 ? "s" : ""})
                  </span>
                </span>
                {isActive && (
                  <svg className="w-4 h-4 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                  </svg>
                )}
              </button>
            );
          })}
        </BottomSheet>
      )}
    </div>
  );
};

export default memo(WatchPage);
