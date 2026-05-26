import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  MediaPlayer,
  MediaProvider,
  Track,
  useMediaState,
} from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import { FaTimes, FaSpinner, FaStepForward, FaGlobe, FaExclamationTriangle, FaRedo, FaExpand, FaClosedCaptioning } from "react-icons/fa";
import { API_BASE } from "../../lib/api";
import { fetchMbStream, fetchMbSubtitles } from "./Fetcher";


const streamCache = new Map();
const STREAM_CACHE_TTL = 90000;

function cacheStreamResult(key, data) {
  streamCache.set(key, { data, ts: Date.now() });
}

function getCachedStream(key) {
  const entry = streamCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > STREAM_CACHE_TTL) {
    streamCache.delete(key);
    return null;
  }
  return entry.data;
}

export function preResolveStream(subjectId, type, season, episode) {
  const cacheKey = `mb:${subjectId}:${season || ""}:${episode || ""}`;
  if (getCachedStream(cacheKey)) return;

  fetchMbStream(subjectId, type, type === "tv" ? (season || 0) : undefined, type === "tv" ? (episode || 0) : undefined)
    .then((data) => {
      if (!data) return;
      let parsed = null;
      if (data?.type === "mp4" && data.streams?.length > 0) {
        parsed = {
          kind: "mp4",
          streams: data.streams,
          languages: [],
          dubs: data.dubs || [],
          currentSubjectId: data.currentSubjectId || subjectId,
          proxyBase: data.proxyBase ?? "",
        };
      } else if (data?.type === "hls" && data.streamUrl) {
        parsed = { kind: "hls", streamUrl: data.streamUrl };
      }
      if (parsed) cacheStreamResult(cacheKey, parsed);
    })
    .catch(() => {});
}

async function enterFullscreenLandscape(el) {
  try {
    // Always target the SmartPlayer overlay (fixed inset-0). Falling back to
    // documentElement breaks badly when the page is scrolled — Chrome
    // fullscreens the whole document at the current scroll position, showing
    // the player as a "cut" sliver. The .smart-player-root selector finds the
    // overlay regardless of which details page rendered it.
    const target =
      el ||
      document.querySelector(".smart-player-root") ||
      document.documentElement;
    if (target.requestFullscreen) {
      await target.requestFullscreen();
    } else if (target.webkitRequestFullscreen) {
      await target.webkitRequestFullscreen();
    }
  } catch {}
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape");
    }
  } catch {}
}

async function exitFullscreenLandscape() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      }
    }
  } catch {}
}

function AudioSelector({ languages, activeLanguage, onSelect, disabled, loading }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [open]);

  if ((!languages || languages.length === 0) && !loading) return null;

  const hasDubs = languages?.some((l) => l.isDub);
  const allOptions = hasDubs ? languages : [{ name: "Original", detailPath: null }, ...(languages || [])];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-black/60 hover:bg-black/90 text-white text-xs font-medium transition-all disabled:opacity-50"
        aria-label="Audio language"
      >
        <FaGlobe className="text-sm" />
        <span className="hidden sm:inline">{activeLanguage || "Audio"}</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 min-w-[140px] bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-sm">
          <div className="py-1 max-h-48 overflow-y-auto">
            {allOptions.map((lang) => {
              const isActive = hasDubs
                ? activeLanguage === lang.name || (!activeLanguage && lang.original)
                : lang.detailPath === null ? !activeLanguage : activeLanguage === lang.name;
              return (
                <button
                  key={lang.name + (lang.subjectId || "")}
                  onClick={() => {
                    if (hasDubs) {
                      onSelect(lang);
                    } else {
                      onSelect(lang.detailPath === null ? null : lang);
                    }
                    setOpen(false);
                  }}
                  disabled={disabled}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? "text-red-500 bg-red-500/10 font-medium"
                      : "text-gray-200 hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                    {lang.name}
                  </span>
                </button>
              );
            })}
            {loading && (
              <div className="px-4 py-2 text-xs text-gray-400 flex items-center gap-2">
                <FaSpinner className="animate-spin text-xs" />
                <span>Finding more languages...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ControlsVisibilityBridge({ onChange }) {
  const visible = useMediaState("controlsVisible");
  useEffect(() => {
    onChange?.(!!visible);
  }, [visible, onChange]);
  return null;
}

function PlayerOverlayControls({ subtitles, allDubs, allLanguages, langProbing, activeLanguage, switchLanguage, langSwitching, playerRef }) {
  const visible = useMediaState("controlsVisible");
  const isFs = useMediaState("fullscreen");
  const hasAudio = allDubs.length > 0 || allLanguages.length > 0 || langProbing;
  // Vidstack's bottom control bar sits at the player bottom with ~2.75rem
  // padding (or ~1.5rem in fullscreen). Place our pills well above it so
  // the scrubber + play button never clip or overlap.
  const bottomOffset = isFs ? '3.25rem' : 'calc(4.5rem + env(safe-area-inset-bottom, 0px))';
  const sideOffset = isFs ? '0.75rem' : 'calc(0.75rem + env(safe-area-inset-left, 0px))';
  const sideOffsetR = isFs ? '0.75rem' : 'calc(0.75rem + env(safe-area-inset-right, 0px))';
  const baseStyle = {
    bottom: bottomOffset,
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
    transition: 'opacity 200ms ease, bottom 200ms ease, left 200ms ease, right 200ms ease',
  };

  return (
    <>
      <div
        className="absolute z-10"
        style={{ ...baseStyle, left: sideOffset }}
      >
        <CaptionsSelector playerRef={playerRef} subtitles={subtitles} />
      </div>
      {hasAudio && (
        <div
          className="absolute z-10"
          style={{ ...baseStyle, right: sideOffsetR }}
        >
          <AudioSelector
            languages={allDubs.length > 0
              ? allDubs.map((d) => ({ name: d.lanName, subjectId: d.subjectId, isDub: true, original: !!d.original }))
              : allLanguages}
            activeLanguage={activeLanguage}
            onSelect={(lang) => switchLanguage(lang || null)}
            disabled={langSwitching}
            loading={langProbing}
          />
        </div>
      )}
    </>
  );
}

function CaptionsSelector({ playerRef, subtitles }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [open]);

  const validSubs = (subtitles || []).filter((s) => s.url || s.subtitleUrl);

  const selectTrack = (idx) => {
    const player = playerRef?.current;
    if (!player) return;
    const tracks = player.textTracks;
    if (!tracks) return;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.kind === "subtitles" || t.kind === "captions") {
        t.mode = i === idx ? "showing" : "disabled";
      }
    }
    setActiveIdx(idx);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-black/60 hover:bg-black/90 text-white text-xs font-medium transition-all"
        aria-label="Captions"
      >
        <FaClosedCaptioning className="text-sm" />
        <span className="hidden sm:inline">CC</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 min-w-[180px] bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50 backdrop-blur-sm">
          <div className="py-1 max-h-60 overflow-y-auto">
            {validSubs.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-400">
                No captions available
              </div>
            ) : (
              <>
                <button
                  onClick={() => selectTrack(-1)}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                    activeIdx === -1
                      ? "text-red-500 bg-red-500/10 font-medium"
                      : "text-gray-200 hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {activeIdx === -1 && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                    Off
                  </span>
                </button>
                {validSubs.map((sub, idx) => {
                  const label = sub.lanName || sub.language || `Subtitle ${idx + 1}`;
                  const isActive = activeIdx === idx;
                  return (
                    <button
                      key={sub.subtitleId || sub.url || idx}
                      onClick={() => selectTrack(idx)}
                      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                        isActive
                          ? "text-red-500 bg-red-500/10 font-medium"
                          : "text-gray-200 hover:bg-white/10"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                        {label}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const isProduction = import.meta.env.PROD;
let directCdnMode = false;

function buildVideoSources(streamList, proxyBase, forceProxy) {
  if (!streamList || streamList.length === 0) return [];
  const sorted = [...streamList].sort((a, b) => {
    const qa = parseInt(a.quality || a.resolutions || a.resolution || 720, 10);
    const qb = parseInt(b.quality || b.resolutions || b.resolution || 720, 10);
    return qa - qb;
  });
  const useProxy = forceProxy || false;
  const built = sorted.map((s) => {
    const q = parseInt(s.quality || s.resolutions || s.resolution || 720, 10);
    let src;
    if (useProxy && proxyBase) {
      src = `${proxyBase}?url=${encodeURIComponent(s.url)}`;
    } else {
      src = s.url;
    }
    return {
      src,
      type: "video/mp4",
      width: Math.round(q * 16 / 9),
      height: q,
    };
  }).filter((s) => s.src);
  // Vidstack's DefaultLayout hides the Quality submenu when only a single
  // quality is registered. Duplicate the lone source so the user can still see
  // the current quality (e.g. "720p") in the built-in settings menu.
  if (built.length === 1) {
    built.push({ ...built[0] });
  }
  return built;
}

function Mp4VidstackPlayer({ streams, proxyBase, languages, dubs, currentSubjectId, season, episode, onError, onLanguageLoading, onReady, onLanguageChange, preferredLang, title, year, type, subtitles, onControlsVisibilityChange }) {
  const playerRef = useRef(null);
  const originalStreamsRef = useRef(streams);
  const currentStreamsRef = useRef(streams);
  const [activeLanguage, setActiveLanguage] = useState(null);
  const [langSwitching, setLangSwitching] = useState(false);
  const [langError, setLangError] = useState(null);
  const [allLanguages, setAllLanguages] = useState(languages || []);
  const [langProbing, setLangProbing] = useState(false);
  const mountedRef = useRef(true);
  const langProbeControllerRef = useRef(null);
  const langSwitchControllerRef = useRef(null);
  const [currentSources, setCurrentSources] = useState([]);
  const savedTimeRef = useRef(0);
  const isLangSwitchRef = useRef(false);
  const readyFiredRef = useRef(false);
  const pendingLangRef = useRef(null);
  const switchVersionRef = useRef(0);
  const activeSwitchVersionRef = useRef(0);
  const langSwitchTimeoutRef = useRef(null);
  const [usingProxy, setUsingProxy] = useState(directCdnMode === false);
  const directFailedRef = useRef(false);
  const autoLangAppliedRef = useRef(false);
  // Tracks decode-error recovery attempts. Some episodes (e.g. Classroom of
  // the Elite S4) ship with a corrupt first ~2s of video — the official
  // MovieBox app silently seeks past it, so we do the same instead of
  // surfacing "Stream not available".
  const decodeRecoveryRef = useRef({ attempts: 0, lastErrorAt: 0 });
  // Decoder-stall watchdog. Some browsers freeze (without firing `error`)
  // when they hit a corrupt frame the decoder can't recover from. We poll
  // every 1s and only intervene when:
  //   - playback is active (not paused, seeking, or ended)
  //   - the decoder has buffered data well past currentTime (proves it's
  //     not a network problem — bytes are downloaded but won't decode)
  //   - currentTime hasn't advanced for >=2.5s
  // When all three hold, we jump 4s forward to skip past the corrupt frames.
  const stallRef = useRef({ lastTime: 0, stuckSince: 0, attempts: 0, lastResetTime: 0 });

  const activeProxyBase = proxyBase || "";

  useEffect(() => {
    const findVideoEl = () => {
      const p = playerRef.current;
      if (!p) return null;
      // Vidstack player exposes the underlying <video> via .el (the host
      // <media-player> element). We query for the rendered <video>.
      const host = p.el || p.$el || null;
      if (host && typeof host.querySelector === "function") {
        const v = host.querySelector("video");
        if (v) return v;
      }
      return null;
    };
    const interval = setInterval(() => {
      const v = findVideoEl();
      if (!v) return;
      // Don't intervene unless we're in active playback
      if (v.paused || v.seeking || v.ended) {
        stallRef.current.lastTime = v.currentTime || 0;
        stallRef.current.stuckSince = 0;
        return;
      }
      const ct = v.currentTime || 0;
      const moved = Math.abs(ct - stallRef.current.lastTime) >= 0.05;
      if (!moved) {
        // Compute how much data is buffered past the current position. If
        // we have ANY data ahead and we're not advancing, the decoder is
        // choking on a corrupt frame (network would refill, decode stuck
        // is invisible to the `error` handler).
        let ahead = 0;
        try {
          const b = v.buffered;
          for (let i = 0; i < b.length; i++) {
            const start = b.start(i);
            const end = b.end(i);
            if (start <= ct + 0.5 && end > ct) {
              ahead = end - ct;
              break;
            }
          }
        } catch {}
        // Even with no ahead-buffer, browsers sometimes just deadlock on a
        // corrupt frame. Try recovery after a longer wait in that case.
        const threshold = ahead >= 1 ? 2000 : 4000;
        if (!stallRef.current.stuckSince) stallRef.current.stuckSince = Date.now();
        else if (Date.now() - stallRef.current.stuckSince >= threshold && stallRef.current.attempts < 4) {
          stallRef.current.attempts += 1;
          const target = ct + 4;
          // eslint-disable-next-line no-console
          console.warn(`[SmartPlayer] decoder stalled at ${ct.toFixed(2)}s (ahead=${ahead.toFixed(2)}s, attempt ${stallRef.current.attempts}) → seeking to ${target.toFixed(2)}s`);
          try {
            v.currentTime = target;
            const pp = v.play?.();
            if (pp && typeof pp.catch === "function") pp.catch(() => {});
          } catch {}
          stallRef.current.stuckSince = 0;
          stallRef.current.lastTime = target;
        }
      } else {
        stallRef.current.lastTime = ct;
        stallRef.current.stuckSince = 0;
        if (ct - stallRef.current.lastResetTime > 10) {
          stallRef.current.attempts = 0;
          stallRef.current.lastResetTime = ct;
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (langSwitchControllerRef.current) langSwitchControllerRef.current.abort();
      if (langProbeControllerRef.current) langProbeControllerRef.current.abort();
      if (langSwitchTimeoutRef.current) clearTimeout(langSwitchTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    originalStreamsRef.current = streams;
    readyFiredRef.current = false;
    directFailedRef.current = false;
    savedTimeRef.current = 0;
    isLangSwitchRef.current = false;
    decodeRecoveryRef.current = { attempts: 0, lastErrorAt: 0 };
    stallRef.current = { lastTime: 0, stuckSince: 0, attempts: 0, lastResetTime: 0 };
    const shouldProxy = directCdnMode === false;
    setUsingProxy(shouldProxy);
    const sources = buildVideoSources(streams, proxyBase || "", shouldProxy);
    if (sources.length > 0) {
      setCurrentSources(sources);
    } else {
      onError?.();
    }
  }, [streams, proxyBase, onError]);

  const finishSwitch = useCallback((version) => {
    if (version !== activeSwitchVersionRef.current) return;
    activeSwitchVersionRef.current = 0;
    if (langSwitchTimeoutRef.current) {
      clearTimeout(langSwitchTimeoutRef.current);
      langSwitchTimeoutRef.current = null;
    }
    if (mountedRef.current) {
      setLangSwitching(false);
      onLanguageLoading?.(false);
    }
  }, [onLanguageLoading]);

  const removeBrokenDub = useCallback((langName) => {
    if (!langName || langName === "Original") return;
    setAllDubs(prev => prev.filter(d => d.original || d.lanName !== langName));
    setAllLanguages(prev => prev.filter(l => l.name !== langName));
  }, []);

  const startSwitchTimeout = useCallback((version, langName) => {
    if (langSwitchTimeoutRef.current) clearTimeout(langSwitchTimeoutRef.current);
    langSwitchTimeoutRef.current = setTimeout(() => {
      if (version === activeSwitchVersionRef.current && mountedRef.current) {
        setLangError(`${langName || "Audio"} not available`);
        removeBrokenDub(langName);
        finishSwitch(version);
      }
    }, 10000);
  }, [finishSwitch, removeBrokenDub]);

  const switchLanguage = useCallback(async (lang) => {
    setLangError(null);
    if (langSwitchControllerRef.current) langSwitchControllerRef.current.abort();
    autoLangAppliedRef.current = true;

    switchVersionRef.current += 1;
    const thisVersion = switchVersionRef.current;
    activeSwitchVersionRef.current = thisVersion;

    if (!lang) {
      if (activeLanguage) {
        setLangSwitching(true);
        onLanguageLoading?.(true);
        currentStreamsRef.current = originalStreamsRef.current;
        const sources = buildVideoSources(originalStreamsRef.current, activeProxyBase, usingProxy);
        if (sources.length > 0) {
          const player = playerRef.current;
          if (player) savedTimeRef.current = player.currentTime || 0;
          isLangSwitchRef.current = true;
          pendingLangRef.current = { version: thisVersion, name: null, subjectId: null };
          setCurrentSources(sources);
          startSwitchTimeout(thisVersion, "Original");
          setActiveLanguage(null);
          onLanguageChange?.(null);
        } else {
          finishSwitch(thisVersion);
        }
      }
      return;
    }

    setLangSwitching(true);
    onLanguageLoading?.(true);

    try {
      const qs = new URLSearchParams();
      if (lang.detailPath) qs.set("detailPath", lang.detailPath);
      if (lang.subjectId) qs.set("subjectId", lang.subjectId);
      if (season) qs.set("season", String(season));
      if (episode) qs.set("episode", String(episode));

      const controller = new AbortController();
      langSwitchControllerRef.current = controller;
      const res = await fetch(`${API_BASE}/stream/mb-play?${qs}`, {
        signal: controller.signal,
      });
      if (thisVersion !== activeSwitchVersionRef.current) return;
      if (!res.ok) throw new Error("Not available");
      const data = await res.json();
      if (thisVersion !== activeSwitchVersionRef.current) return;
      if (data?.streams?.length > 0) {
        currentStreamsRef.current = data.streams;
        const sources = buildVideoSources(data.streams, activeProxyBase, usingProxy);
        if (sources.length > 0) {
          const player = playerRef.current;
          if (player) savedTimeRef.current = player.currentTime || 0;
          isLangSwitchRef.current = true;
          pendingLangRef.current = { version: thisVersion, name: lang.original ? null : lang.name, subjectId: lang.subjectId };
          setCurrentSources(sources);
          startSwitchTimeout(thisVersion, lang.name);
          onLanguageChange?.(lang.original ? null : lang.name);
        } else {
          setLangError(`${lang.name} audio not available`);
          removeBrokenDub(lang.name);
          finishSwitch(thisVersion);
        }
      } else {
        setLangError(`${lang.name} audio not available`);
        removeBrokenDub(lang.name);
        finishSwitch(thisVersion);
      }
    } catch (err) {
      if (thisVersion !== activeSwitchVersionRef.current) return;
      if (err?.name !== "AbortError") {
        setLangError(`${lang.name} audio not available`);
        removeBrokenDub(lang.name);
      }
      finishSwitch(thisVersion);
    }
  }, [activeLanguage, activeProxyBase, season, episode, onLanguageLoading, onLanguageChange, finishSwitch, startSwitchTimeout, removeBrokenDub]);

  useEffect(() => {
    if (!langError) return;
    const t = setTimeout(() => setLangError(null), 3000);
    return () => clearTimeout(t);
  }, [langError]);

  const [allDubs, setAllDubs] = useState(dubs || []);
  const currentSubjectIdRef = useRef(currentSubjectId || "");

  useEffect(() => {
    setAllDubs(dubs || []);
    currentSubjectIdRef.current = currentSubjectId || "";
    if (currentSubjectId && dubs && dubs.length > 0) {
      const activeDub = dubs.find((d) => d.subjectId === currentSubjectId);
      if (activeDub) setActiveLanguage(activeDub.original ? null : activeDub.lanName);
      else setActiveLanguage(null);
    } else {
      setActiveLanguage(null);
    }
  }, [dubs, currentSubjectId]);

  useEffect(() => {
    if (!title || !type) return;
    if (langProbeControllerRef.current) langProbeControllerRef.current.abort();
    setAllLanguages(languages || []);
    const controller = new AbortController();
    langProbeControllerRef.current = controller;
    setLangProbing(true);

    const qs = new URLSearchParams();
    qs.set("title", title);
    qs.set("type", type);
    if (year) qs.set("year", String(year));
    if (season) qs.set("season", String(season));
    if (episode) qs.set("episode", String(episode));
    if (currentSubjectIdRef.current) qs.set("subjectId", currentSubjectIdRef.current);

    fetch(`${API_BASE}/stream/mb-languages?${qs}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (data?.dubs?.length > 0) {
          setAllDubs((prev) => {
            const seenIds = new Set(prev.map((d) => d.subjectId));
            const merged = [...prev];
            for (const dub of data.dubs) {
              if (!seenIds.has(dub.subjectId)) {
                merged.push(dub);
                seenIds.add(dub.subjectId);
              }
            }
            return merged;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current && !controller.signal.aborted) setLangProbing(false);
      });

    return () => controller.abort();
  }, [title, year, type, season, episode, languages]);

  useEffect(() => {
    if (autoLangAppliedRef.current || !preferredLang || langSwitching) return;
    if (allDubs.length === 0 && langProbing) return;
    const matchingDub = allDubs.find((d) => d.lanName === preferredLang && !d.original);
    if (matchingDub) {
      autoLangAppliedRef.current = true;
      switchLanguage({ name: matchingDub.lanName, subjectId: matchingDub.subjectId, isDub: true, original: false });
    }
  }, [preferredLang, allDubs, langProbing, langSwitching, switchLanguage]);

  const handleCanPlay = useCallback(() => {
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      onReady?.();
    }
    const player = playerRef.current;
    if (savedTimeRef.current > 0) {
      if (player) {
        player.currentTime = savedTimeRef.current;
        savedTimeRef.current = 0;
      }
    } else if (!isLangSwitchRef.current && player && player.currentTime > 1) {
      player.currentTime = 0;
    }
    const pending = pendingLangRef.current;
    if (pending && pending.version !== undefined) {
      if (pending.version === activeSwitchVersionRef.current) {
        if (pending.name !== undefined) setActiveLanguage(pending.name);
        if (pending.subjectId) currentSubjectIdRef.current = pending.subjectId;
        finishSwitch(pending.version);
      }
      pendingLangRef.current = null;
    }
  }, [onReady, finishSwitch, usingProxy]);

  const handleError = useCallback((detail) => {
    // Vidstack passes a MediaErrorDetail with { code, message, mediaError? }.
    // code maps to HTMLMediaElement MediaError codes:
    //   1 ABORTED, 2 NETWORK, 3 DECODE, 4 SRC_NOT_SUPPORTED.
    const code = detail?.code ?? detail?.mediaError?.code;
    const player = playerRef.current;

    // Recovery path 1: bad video frames in the source file (DECODE error or
    // generic media error while we ALREADY have buffered data). The official
    // MovieBox app handles this by seeking 1-2s forward and resuming. We do
    // the same — up to 4 attempts, jumping a little further each time.
    if (player && (code === 3 || code === undefined) && !langSwitching) {
      const now = Date.now();
      const rec = decodeRecoveryRef.current;
      // Reset attempt counter if last error was >30s ago (different glitch).
      if (now - rec.lastErrorAt > 30_000) rec.attempts = 0;
      rec.lastErrorAt = now;
      if (rec.attempts < 4) {
        rec.attempts += 1;
        const cur = Number(player.currentTime) || 0;
        const jumpTo = cur + (1.5 * rec.attempts); // 1.5s, 3s, 4.5s, 6s
        try {
          player.currentTime = jumpTo;
          // Best-effort resume; some browsers require an explicit play().
          const playPromise = player.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
          return;
        } catch {
          // fall through to direct/proxy fallback
        }
      }
    }

    // Recovery path 2: direct-CDN attempt failed → flip to proxy and retry
    // (this covers the geo/IP-block 403 case).
    if (!usingProxy && !directFailedRef.current && activeProxyBase) {
      directFailedRef.current = true;
      directCdnMode = false;
      setUsingProxy(true);
      const sources = buildVideoSources(currentStreamsRef.current, activeProxyBase, true);
      if (sources.length > 0) {
        readyFiredRef.current = false;
        setCurrentSources(sources);
        return;
      }
    }
    onError?.();
  }, [onError, usingProxy, activeProxyBase, langSwitching]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black smart-player-fill">
      {currentSources.length > 0 && (
        <MediaPlayer
          ref={playerRef}
          src={currentSources}
          autoPlay
          playsInline
          crossOrigin={usingProxy ? "" : undefined}
          onCanPlay={handleCanPlay}
          onError={handleError}
          className="w-full h-full"
        >
          <MediaProvider>
            {!usingProxy && <video referrerPolicy="no-referrer" />}
            {subtitles && subtitles.filter(s => s.url || s.subtitleUrl).map((sub, idx) => {
              const src = sub.url || sub.subtitleUrl;
              const lang = sub.lan || sub.language || sub.languageCode || "en";
              const label = sub.lanName || sub.language || `Subtitle ${idx + 1}`;
              const isVtt = /\.vtt(\?|$)/i.test(src);
              return (
                <Track
                  key={sub.subtitleId || src || idx}
                  src={src}
                  kind="subtitles"
                  label={label}
                  language={lang}
                  type={isVtt ? 'vtt' : 'srt'}
                />
              );
            })}
          </MediaProvider>
          <DefaultVideoLayout icons={defaultLayoutIcons} />
          <ControlsVisibilityBridge onChange={onControlsVisibilityChange} />
          <PlayerOverlayControls
            subtitles={subtitles}
            allDubs={allDubs}
            allLanguages={allLanguages}
            langProbing={langProbing}
            activeLanguage={activeLanguage}
            switchLanguage={switchLanguage}
            langSwitching={langSwitching}
            playerRef={playerRef}
          />
        </MediaPlayer>
      )}
      {langSwitching && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-3">
            <FaSpinner className="text-red-500 text-3xl animate-spin" />
            <span className="text-gray-300 text-sm">Switching audio...</span>
          </div>
        </div>
      )}
      {langError && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-red-900/90 text-white text-xs shadow-lg">
          {langError}
        </div>
      )}
    </div>
  );
}

function HlsVidstackPlayer({ streamUrl, onError, onReady, onControlsVisibilityChange }) {
  const playerRef = useRef(null);
  const readyFiredRef = useRef(false);

  const handleCanPlay = useCallback(() => {
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      onReady?.();
    }
  }, [onReady]);

  useEffect(() => {
    readyFiredRef.current = false;
    const stallTimer = setTimeout(() => {
      if (!readyFiredRef.current) onError?.();
    }, 15000);
    return () => clearTimeout(stallTimer);
  }, [streamUrl, onError]);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black smart-player-fill">
      <MediaPlayer
        ref={playerRef}
        src={streamUrl}
        autoPlay
        playsInline
        crossOrigin=""
        onCanPlay={handleCanPlay}
        onError={onError}
        className="w-full h-full"
      >
        <MediaProvider />
        <DefaultVideoLayout icons={defaultLayoutIcons} />
        <ControlsVisibilityBridge onChange={onControlsVisibilityChange} />
      </MediaPlayer>
    </div>
  );
}

const LANG_PREF_KEY = 'weflix-lang-pref';

const SmartPlayer = ({ subjectId, type, season, episode, title, year, onClose, onNextEpisode }) => {
  const [streamData, setStreamData] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [swapping, setSwapping] = useState(false);
  const [hlsFailed, setHlsFailed] = useState(false);
  const [mp4Failed, setMp4Failed] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const mp4RetryRef = useRef(0);
  const mp4RecoveryInFlight = useRef(false);
  const [langLoading, setLangLoading] = useState(false);
  const [subtitles, setSubtitles] = useState([]);
  const [preferredLang, setPreferredLang] = useState(() => {
    try { return localStorage.getItem(LANG_PREF_KEY) || null; } catch { return null; }
  });

  const handleLanguageChange = useCallback((langName) => {
    setPreferredLang(langName);
    try {
      if (langName) localStorage.setItem(LANG_PREF_KEY, langName);
      else localStorage.removeItem(LANG_PREF_KEY);
    } catch {}
  }, []);
  const [controlsVisible, setControlsVisible] = useState(true);
  const fetchControllerRef = useRef(null);
  const retryCountRef = useRef(0);
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFsPrompt, setShowFsPrompt] = useState(false);

  const isVideoPlaying = !initialLoading && !swapping && !langLoading && !streamError && (
    (streamData?.kind === "mp4" && !mp4Failed) || (streamData?.kind === "hls" && !hlsFailed)
  );

  const showControls = useCallback(() => {
    setControlsVisible(true);
  }, []);

  const checkFullscreen = useCallback(() => {
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    setIsFullscreen(fs);
    return fs;
  }, []);

  const doFullscreen = useCallback(async () => {
    if (checkFullscreen()) return;
    try {
      await enterFullscreenLandscape(containerRef.current);
      const nowFs = checkFullscreen();
      if (!nowFs) setShowFsPrompt(true);
    } catch {
      setShowFsPrompt(true);
    }
  }, [checkFullscreen]);

  useEffect(() => {
    const handleFsChange = () => checkFullscreen();
    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, [checkFullscreen]);

  useEffect(() => {
    if (isFullscreen) setShowFsPrompt(false);
  }, [isFullscreen]);

  const parseStreamResponse = useCallback((data, sid) => {
    const subs = Array.isArray(data?.subtitles) ? data.subtitles : [];
    if (subs.length > 0) setSubtitles(subs);
    if (data?.type === "mp4" && data.streams?.length > 0) {
      return {
        kind: "mp4",
        streams: data.streams,
        languages: [],
        dubs: data.dubs || [],
        currentSubjectId: data.currentSubjectId || sid,
        proxyBase: data.proxyBase ?? "",
        // Include subtitles so cache hits (below) can rehydrate the CC menu
        // without needing a second network call to the stream endpoint.
        subtitles: subs,
      };
    } else if (data?.type === "hls" && data.streamUrl) {
      return {
        kind: "hls",
        streamUrl: data.streamUrl,
        subtitles: subs,
      };
    }
    return null;
  }, []);

  useEffect(() => {
    if (fetchControllerRef.current) fetchControllerRef.current.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    const cacheKey = `mb:${subjectId}:${season || ""}:${episode || ""}`;
    const cached = getCachedStream(cacheKey);

    const isFirstLoad = streamData === null;
    setHlsFailed(false);
    setMp4Failed(false);
    setStreamError(false);
    mp4RetryRef.current = 0;
    mp4RecoveryInFlight.current = false;

    if (cached) {
      // Restore captions from cache so reopening a title preserves the rich
      // stream-captions list (otherwise the legacy fallback would replace it
      // with whatever the subject-search endpoint returns — usually nothing).
      if (cached.subtitles?.length > 0) setSubtitles(cached.subtitles);
      setStreamData(cached);
      setInitialLoading(false);
      setSwapping(false);
      return;
    }

    if (isFirstLoad) setInitialLoading(true);
    else setSwapping(true);

    fetchMbStream(subjectId, type, type === "tv" ? (season || 0) : undefined, type === "tv" ? (episode || 0) : undefined, title)
      .then((data) => {
        if (controller.signal.aborted) return;
        const next = parseStreamResponse(data, subjectId);
        if (!next) {
          setStreamData(null);
          setInitialLoading(false);
          setSwapping(false);
          setStreamError(true);
          return;
        }
        cacheStreamResult(cacheKey, next);
        setStreamData(next);
        setInitialLoading(false);
        setSwapping(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setStreamData(null);
        setInitialLoading(false);
        setSwapping(false);
        setStreamError(true);
      });

    return () => controller.abort();
  }, [subjectId, type, season, episode, parseStreamResponse]);

  // Reset captions when the playing item changes so we don't show the previous
  // title's CC list while the new stream resolves.
  useEffect(() => {
    setSubtitles([]);
  }, [subjectId, season, episode]);

  // Legacy fallback: only fire if mb-stream did NOT return captions. The
  // primary source is now /stream/mb-stream which calls the decompiled
  // get-stream-captions endpoint and returns rich, signed CDN .srt URLs;
  // this legacy subject-level search is almost always empty for our account
  // and would otherwise overwrite the rich list with nothing.
  useEffect(() => {
    if (!subjectId) return;
    if (!streamData) return; // wait for stream to resolve first
    if (subtitles.length > 0) return; // stream gave us captions, don't override
    let cancelled = false;
    fetchMbSubtitles(subjectId, title)
      .then((subs) => { if (!cancelled && subs?.length > 0) setSubtitles(subs); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, title, season, episode, streamData]);

  const handleMp4Error = useCallback(() => {
    if (mp4RecoveryInFlight.current) return;
    mp4RecoveryInFlight.current = true;
    setMp4Failed(true);
    setStreamError(true);
    mp4RecoveryInFlight.current = false;
  }, []);

  const handleHlsError = useCallback(() => {
    setHlsFailed(true);
    setStreamError(true);
  }, []);

  const handleRetry = useCallback(() => {
    retryCountRef.current += 1;
    const cacheKey = `mb:${subjectId}:${season || ""}:${episode || ""}`;
    streamCache.delete(cacheKey);
    setStreamData(null);
    setStreamError(false);
    setMp4Failed(false);
    setHlsFailed(false);
    setInitialLoading(true);
    mp4RetryRef.current = 0;
    mp4RecoveryInFlight.current = false;

    if (fetchControllerRef.current) fetchControllerRef.current.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    fetchMbStream(subjectId, type, type === "tv" ? (season || 0) : undefined, type === "tv" ? (episode || 0) : undefined, title)
      .then((data) => {
        if (controller.signal.aborted) return;
        const next = parseStreamResponse(data, subjectId);
        if (!next) {
          setInitialLoading(false);
          setStreamError(true);
          return;
        }
        cacheStreamResult(cacheKey, next);
        setStreamData(next);
        setInitialLoading(false);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setInitialLoading(false);
        setStreamError(true);
      });
  }, [subjectId, type, season, episode, parseStreamResponse]);

  const handleClose = useCallback(async () => {
    try {
      await exitFullscreenLandscape();
    } catch {}
    onClose();
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [handleClose]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-black flex flex-col smart-player-root"
      style={{
        width: "100dvw",
        height: "100dvh",
        // Extend behind any system bottom bar so no dark "cut" strip appears.
        paddingBottom: 0,
        overflow: "hidden",
      }}
      onMouseMove={showControls}
      onPointerDown={() => { showControls(); }}
    >
      <div
        className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-2 bg-gradient-to-b from-black/80 via-black/30 to-transparent transition-opacity duration-300 ${(!isVideoPlaying || controlsVisible) ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))', paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))', paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))' }}
      >
        <span className="text-white text-xs font-medium opacity-70 truncate max-w-[60%] select-none">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {type === "tv" && onNextEpisode && (
            <button
              onClick={onNextEpisode}
              className="pointer-events-auto flex items-center justify-center gap-1.5 h-8 px-3 rounded-full bg-black/60 hover:bg-black/90 text-white text-xs font-medium transition-all"
            >
              <span className="hidden sm:inline">Next</span>
              <FaStepForward className="text-xs" />
            </button>
          )}
          <button
            onClick={handleClose}
            className="pointer-events-auto flex items-center justify-center w-8 h-8 rounded-full bg-black/60 hover:bg-black/90 text-white transition-all"
          >
            <FaTimes className="text-sm" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative bg-black overflow-visible" onPointerDown={(e) => {
        if (e.target.closest('.vds-controls, .vds-menu, [data-media-menu], button')) return;
        doFullscreen();
      }}>
        {(initialLoading || swapping) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-3">
              <FaSpinner className="text-red-500 text-3xl animate-spin" />
              <span className="text-gray-400 text-sm">Loading stream...</span>
            </div>
          </div>
        )}

        {streamData?.kind === "mp4" && !mp4Failed && (
          <Mp4VidstackPlayer
            key={`mp4-${season}-${episode}`}
            streams={streamData.streams}
            proxyBase={streamData.proxyBase}
            languages={streamData.languages}
            dubs={streamData.dubs}
            currentSubjectId={streamData.currentSubjectId}
            season={season}
            episode={episode}
            title={title}
            year={year}
            type={type}
            onError={handleMp4Error}
            onLanguageLoading={setLangLoading}
            onReady={() => {}}
            onLanguageChange={handleLanguageChange}
            preferredLang={preferredLang}
            subtitles={subtitles}
            onControlsVisibilityChange={setControlsVisible}
          />
        )}

        {streamData?.kind === "hls" && !hlsFailed && (
          <HlsVidstackPlayer
            key={`hls-${season}-${episode}`}
            streamUrl={streamData.streamUrl}
            onError={handleHlsError}
            onReady={() => {}}
            onControlsVisibilityChange={setControlsVisible}
          />
        )}

        {streamError && !initialLoading && !swapping && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
            <div className="flex flex-col items-center gap-4 text-center px-6">
              <FaExclamationTriangle className="text-red-500 text-4xl" />
              <p className="text-white text-lg font-medium">Stream unavailable</p>
              <p className="text-gray-400 text-sm max-w-xs">
                This content isn't available for streaming right now. Please try again later.
              </p>
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
              >
                <FaRedo className="text-xs" />
                Retry
              </button>
            </div>
          </div>
        )}

        {showFsPrompt && !isFullscreen && isVideoPlaying && (
          <button
            onClick={doFullscreen}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-xs font-medium transition-all animate-pulse"
          >
            <FaExpand className="text-sm" />
            Tap for fullscreen
          </button>
        )}
      </div>
    </div>
  );
};

export { enterFullscreenLandscape };
export default SmartPlayer;
