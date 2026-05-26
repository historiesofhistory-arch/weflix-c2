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
import { API_BASE } from "../../lib/api";
import { getIdFromDetailSlug, getTitleFromDetailSlug } from "./urlUtils";
import { saveToContinueWatching } from "../../utils/continueWatching";
import SEO from "./SEO";
import { useProgressWhile } from "../../context/ProgressContext";
import { useWatchlist } from "../../context/WatchlistContext";

const BLOCK_SIZE = 24;

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

function DubDropdown({ dubs, activeDubId, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  const active = dubs.find((d) => d.subjectId === activeDubId) || dubs[0];

  if (!dubs.length) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-[#1e1e1e] border border-white/10 hover:border-white/30 text-white text-xs font-medium px-3 py-2 rounded-lg transition-all min-w-[110px] justify-between"
      >
        <span className="truncate">{active?.lanName || "Original"}</span>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-gray-400">{dubs.length}</span>
          <FaChevronDown
            className={`text-[10px] transition-transform text-gray-400 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-[#1e1e1e] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden max-h-52 overflow-y-auto">
          {dubs.map((dub) => {
            const isActive =
              dub.subjectId === activeDubId ||
              (!activeDubId && dub === dubs[0]);
            return (
              <button
                key={dub.subjectId}
                onClick={() => {
                  onSelect(dub);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-red-600/20 text-red-400 font-medium"
                    : "text-gray-300 hover:bg-white/5"
                }`}
              >
                {dub.lanName}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SeasonDropdown({ seasons, activeSeason, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  const active = seasons.find((s) => s.season_number === activeSeason);
  if (!seasons.length) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-[#1e1e1e] border border-white/10 hover:border-white/30 text-white text-xs font-medium px-3 py-2 rounded-lg transition-all min-w-[110px] justify-between"
      >
        <span>Season {String(activeSeason).padStart(2, "0")}</span>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-gray-400">{active?.episode_count ?? 0}</span>
          <FaChevronDown
            className={`text-[10px] transition-transform text-gray-400 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-[#1e1e1e] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden max-h-52 overflow-y-auto">
          {seasons.map((s) => {
            const isActive = s.season_number === activeSeason;
            return (
              <button
                key={s.season_number}
                onClick={() => {
                  onSelect(s.season_number);
                  setOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "bg-red-600/20 text-red-400 font-medium"
                    : "text-gray-300 hover:bg-white/5"
                }`}
              >
                Season {String(s.season_number).padStart(2, "0")}
                <span className="text-gray-500 ml-2 text-xs">
                  ({s.episode_count} ep{s.episode_count !== 1 ? "s" : ""})
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EpisodeGrid({
  episodes,
  activeEpisode,
  onSelect,
  blockSize = BLOCK_SIZE,
}) {
  const totalEps = episodes.length;
  const blockCount = Math.ceil(totalEps / blockSize);
  const [activeBlock, setActiveBlock] = useState(0);
  const [gotoVal, setGotoVal] = useState("");
  const gotoRef = useRef(null);

  useEffect(() => {
    if (activeEpisode == null) return;
    const idx = episodes.findIndex((e) => e.episode_number === activeEpisode);
    if (idx >= 0) setActiveBlock(Math.floor(idx / blockSize));
  }, [activeEpisode, episodes, blockSize]);

  const blockStart = activeBlock * blockSize;
  const blockEps = episodes.slice(blockStart, blockStart + blockSize);
  const firstEpNum = blockEps[0]?.episode_number;
  const lastEpNum = blockEps[blockEps.length - 1]?.episode_number;

  const handleGoto = () => {
    const n = parseInt(gotoVal, 10);
    if (!n || n < 1) return;
    const ep = episodes.find((e) => e.episode_number === n);
    if (ep) {
      onSelect(ep.episode_number);
      setGotoVal("");
    }
  };

  if (!episodes.length) return null;

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-0.5">
            Episodes
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-white font-bold text-base">
              Episode {activeEpisode}
            </span>
            <span className="text-gray-500 text-sm">/ {totalEps}</span>
          </div>
        </div>
        {blockCount > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {Array.from({ length: blockCount }, (_, i) => {
              const s = episodes[i * blockSize]?.episode_number;
              const e =
                episodes[Math.min((i + 1) * blockSize - 1, totalEps - 1)]
                  ?.episode_number;
              return (
                <button
                  key={i}
                  onClick={() => setActiveBlock(i)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition-all ${
                    activeBlock === i
                      ? "bg-red-600 text-white"
                      : "bg-[#1e1e1e] text-gray-400 hover:text-white border border-white/10"
                  }`}
                >
                  {s}-{e}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setActiveBlock(Math.floor(((firstEpNum || 1) - 1) / blockSize))}
          className={`text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all border ${
            episodes.findIndex(
              (e) => e.episode_number === activeEpisode
            ) >= blockStart &&
            episodes.findIndex((e) => e.episode_number === activeEpisode) <
              blockStart + blockSize
              ? "bg-red-600 text-white border-red-600"
              : "bg-[#1e1e1e] text-gray-300 border-white/10 hover:border-white/30"
          }`}
        >
          {firstEpNum}-{lastEpNum}
        </button>

        <div className="flex items-center gap-1.5 ml-auto">
          <input
            ref={gotoRef}
            type="number"
            min="1"
            max={totalEps}
            value={gotoVal}
            onChange={(e) => setGotoVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGoto()}
            placeholder="Go to #"
            className="w-20 px-2.5 py-1.5 rounded-lg bg-[#1e1e1e] border border-white/10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30 text-center"
          />
          <button
            onClick={handleGoto}
            className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
          >
            Go
          </button>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {blockEps.map((ep) => {
          const isActive = ep.episode_number === activeEpisode;
          return (
            <button
              key={ep.episode_number}
              onClick={() => onSelect(ep.episode_number)}
              className={`aspect-square rounded-lg text-sm font-bold transition-all active:scale-95 flex items-center justify-center ${
                isActive
                  ? "bg-red-600 text-white shadow-lg shadow-red-600/30 scale-105"
                  : "bg-[#1e1e1e] text-gray-300 hover:bg-[#2a2a2a] hover:text-white border border-white/5 hover:border-white/20"
              }`}
            >
              {String(ep.episode_number).padStart(2, "0")}
            </button>
          );
        })}
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

  const playerKey = useRef(0);
  const { user } = useWatchlist();

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

    const proxied = (rawUrl) =>
      `${API_BASE}/stream/proxy?url=${encodeURIComponent(rawUrl)}`;

    const sorted = [...streamData.streams].sort((a, b) => {
      const qa = parseInt(a.quality || a.resolutions || a.resolution || 720, 10);
      const qb = parseInt(b.quality || b.resolutions || b.resolution || 720, 10);
      return qb - qa;
    });

    if (selectedQuality) {
      const match = sorted.find((s) => getQualityLabel(s) === selectedQuality);
      const src = match || sorted[0];
      return [{ src: proxied(src.url), type: "video/mp4" }];
    }

    return [{ src: proxied(sorted[0].url), type: "video/mp4" }];
  }, [streamData, selectedQuality]);

  const handleEpisodeSelect = (epNum) => {
    setEpisode(epNum);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSeasonSelect = (seasonNum) => {
    setSeason(seasonNum);
    setEpisode(1);
  };

  const handleDubSelect = (dub) => {
    setActiveDubId(dub.subjectId);
  };

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
            className="group flex items-center gap-2 text-gray-300 hover:text-white text-sm font-medium transition-colors p-1"
          >
            <FaArrowLeft className="group-hover:-translate-x-0.5 transition-transform" />
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]">
            {coverUrl && (
              <img
                src={coverUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-10"
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full border-2 border-red-600 border-t-transparent animate-spin" />
              <span className="text-gray-400 text-sm">Loading stream…</span>
            </div>
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
            key={`player-${playerKey.current}-${season}-${episode}-${activeDubId}`}
            className="w-full h-full animate-fadeIn"
          >
            <MediaPlayer
              title={playerTitle}
              src={
                streamData.hlsUrl
                  ? { src: streamData.hlsUrl, type: "application/x-mpegurl" }
                  : videoSources
              }
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

      <div className="px-4 pt-4 pb-2">
        {detailLoading ? (
          <div className="space-y-2">
            <div className="h-6 w-48 bg-white/10 rounded animate-pulse" />
            <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
          </div>
        ) : (
          <>
            <h1 className="text-white font-bold text-xl leading-snug">
              {detail?.title}
            </h1>
            {type === "tv" && currentEpisodeName && (
              <p className="text-gray-400 text-sm mt-0.5">
                S{String(season).padStart(2, "0")}·E{String(episode).padStart(2, "0")}·{currentEpisodeName}
              </p>
            )}
          </>
        )}
      </div>

      <div className="px-4 py-4 border-b border-white/5">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-3">
          Resources
        </span>

        <div className="flex flex-wrap gap-2 mb-3">
          {streamLoading && !dubs.length ? (
            <div className="h-8 w-28 bg-white/10 rounded-lg animate-pulse" />
          ) : (
            dubs.length > 0 && (
              <DubDropdown
                dubs={dubs}
                activeDubId={activeDubId}
                onSelect={handleDubSelect}
              />
            )
          )}

          {type === "tv" && seasons.length > 0 && (
            <SeasonDropdown
              seasons={seasons}
              activeSeason={season}
              onSelect={handleSeasonSelect}
            />
          )}
        </div>

        {streamData?.qualities?.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mr-1">
              Quality
            </span>
            {streamData.qualities.map((q) => {
              const isActive =
                selectedQuality === q ||
                (!selectedQuality && q === streamData.qualities[0]);
              return (
                <button
                  key={q}
                  onClick={() => setSelectedQuality(q)}
                  className={`text-xs font-bold px-3 py-1 rounded-lg transition-all ${
                    isActive
                      ? "bg-red-600 text-white"
                      : "bg-[#1e1e1e] text-gray-400 hover:text-white border border-white/10"
                  }`}
                >
                  {q}
                </button>
              );
            })}
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
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">
            Synopsis
          </span>
          <p className="text-gray-400 text-sm leading-relaxed">{overview}</p>
        </div>
      )}

      <div className="h-16" />
    </div>
  );
};

export default memo(WatchPage);
