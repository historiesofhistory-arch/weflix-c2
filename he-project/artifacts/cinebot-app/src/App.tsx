import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { MediaPlayer, MediaProvider, useMediaStore, isVideoProvider, type MediaPlayerInstance, Menu } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons, DefaultMenuButton, DefaultMenuRadioGroup } from '@vidstack/react/player/layouts/default';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';

const API_BASE = `${import.meta.env.BASE_URL}api`;

async function resolveMovieBoxStream(p: {
  subjectId: string; detailPath?: string; season?: number; episode?: number;
}): Promise<{ streams: { url: string; quality: string }[]; proxyBase?: string } | null> {
  const qs = new URLSearchParams({ subjectId: p.subjectId });
  if (p.detailPath) qs.set('detailPath', p.detailPath);
  if (p.season != null) qs.set('season', String(p.season));
  if (p.episode != null) qs.set('episode', String(p.episode));
  try {
    const res = await fetch(`${API_BASE}/stream/mb-play?${qs}`, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (d?.streams?.length > 0) return d;
    return null;
  } catch { return null; }
}

function buildProxiedMp4Url(streamUrl: string, _proxyBase?: string): string {
  if (streamUrl.includes('hakunaymatata.com')) {
    return `${API_BASE}/stream/proxy?url=${encodeURIComponent(streamUrl)}`;
  }
  return streamUrl;
}

interface SeasonInfo {
  seasonNumber?: number;
  season?: number;
  id?: string;
  name: string;
  episodes?: EpisodeInfo[];
}

interface EpisodeInfo {
  episodeNumber?: number;
  episode?: number;
  ep?: number;
  name?: string;
  title?: string;
}

async function fetchMbSeasons(subjectId: string): Promise<SeasonInfo[]> {
  try {
    const r = await fetch(`${API_BASE}/stream/mb-seasons?subjectId=${subjectId}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const d = await r.json();
    return d.seasons || d.list || [];
  } catch { return []; }
}

interface DubEntry {
  subjectId: string;
  lanName: string;
  lanCode: string;
  original: boolean;
}

async function fetchDubs(subjectId: string, season?: number, episode?: number, signal?: AbortSignal): Promise<DubEntry[]> {
  try {
    const qs = new URLSearchParams({ subjectId });
    if (season != null) qs.set('season', String(season));
    if (episode != null) qs.set('episode', String(episode));
    const r = await fetch(`${API_BASE}/stream/mb-languages?${qs}`, { signal: signal ?? AbortSignal.timeout(20000) });
    if (!r.ok) return [];
    const d = await r.json();
    return d?.dubs || [];
  } catch { return []; }
}

function Spinner({ size = 40, color = '#e50914' }: { size?: number; color?: string }) {
  return (
    <div style={{
      width: size, height: size,
      border: '3px solid rgba(255,255,255,0.08)',
      borderTopColor: color, borderRadius: '50%',
      animation: 'spin 0.75s linear infinite', flexShrink: 0,
    }} />
  );
}

function FullBg({ poster }: { poster: string }) {
  return poster ? (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: `url(${poster})`,
      backgroundSize: 'cover', backgroundPosition: 'center',
      filter: 'blur(28px) brightness(0.1)',
    }} />
  ) : null;
}

function LoadingScreen({ poster, title }: { poster: string; title: string }) {
  return (
    <div className="cine-fullscreen">
      <FullBg poster={poster} />
      <div className="cine-vignette" />
      <div className="cine-loading-content" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, padding: '0 24px' }}>
        {poster ? (
          <div className="cine-loading-poster">
            <img src={poster} alt="" />
          </div>
        ) : (
          <div className="cine-loading-poster cine-skeleton" />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="cine-spinner" />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', letterSpacing: 0.2 }}>Loading stream</div>
            {title && (
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ poster, title, onRetry }: { poster: string; title: string; onRetry: () => void }) {
  return (
    <div className="cine-fullscreen">
      <FullBg poster={poster} />
      <div className="cine-vignette" />
      <div className="cine-loading-content" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '0 36px', textAlign: 'center', maxWidth: 340 }}>
        <div className="cine-error-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e50914" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, color: '#fff', marginBottom: 6 }}>Stream unavailable</div>
          {title && (
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {title}
            </div>
          )}
        </div>
        <button onClick={onRetry} style={{ marginTop: 4, padding: '11px 32px', background: '#e50914', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3, boxShadow: '0 4px 20px rgba(229,9,20,0.4)' }}>
          Try Again
        </button>
      </div>
    </div>
  );
}

interface EpisodePanelProps {
  subjectId: string;
  currentSeason: number;
  currentEpisode: number;
  onSelect: (season: number, episode: number) => void;
  onClose: () => void;
}

function EpisodePanel({ subjectId, currentSeason, currentEpisode, onSelect, onClose }: EpisodePanelProps) {
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [viewSeason, setViewSeason] = useState<number | null>(null);
  const [loadingSeasons, setLoadingSeasons] = useState(true);

  useEffect(() => {
    setLoadingSeasons(true);
    fetchMbSeasons(subjectId).then(s => {
      setSeasons(s);
      setLoadingSeasons(false);
    });
  }, [subjectId]);

  const getSeasonNum = (s: SeasonInfo) => s.seasonNumber || s.season || 1;
  const getEpNum = (ep: EpisodeInfo) => ep.episodeNumber || ep.episode || ep.ep || 1;
  const currentSeasonData = viewSeason !== null ? seasons.find(s => getSeasonNum(s) === viewSeason) : null;
  const episodes = currentSeasonData?.episodes || [];

  return (
    <div
      onClick={onClose}
      className="cine-ep-overlay"
      style={{
        position: 'absolute', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="cine-ep-panel"
        style={{
          width: 'min(360px, 94vw)',
          background: 'rgba(8,8,10,0.98)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'hidden',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '-12px 0 48px rgba(0,0,0,0.7)',
        }}
      >
        <div className="cine-ep-header">
          {viewSeason !== null && (
            <button onClick={() => setViewSeason(null)} className="cine-ep-header-btn cine-top-btn">‹</button>
          )}
          <span className="cine-ep-header-title">
            {viewSeason !== null
              ? (currentSeasonData?.name ?? `Season ${viewSeason}`)
              : 'Seasons'}
          </span>
          <button onClick={onClose} className="cine-ep-header-btn cine-top-btn" style={{ color: 'rgba(255,255,255,0.6)' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {viewSeason === null ? (
            loadingSeasons ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 36 }}>
                <div className="cine-spinner-sm" />
              </div>
            ) : seasons.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '36px 24px', fontSize: 13 }}>
                No season data available
              </div>
            ) : (
              seasons.map(s => {
                const sn = getSeasonNum(s);
                const epCount = s.episodes?.length || 0;
                return (
                  <button
                    key={sn}
                    onClick={() => setViewSeason(sn)}
                    className="cine-season-item"
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                      padding: '12px 16px',
                      background: sn === currentSeason ? 'rgba(229,9,20,0.1)' : 'transparent',
                      border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 700, fontSize: 14,
                        color: sn === currentSeason ? '#e50914' : '#f0f0f0',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{s.name || `Season ${sn}`}</div>
                      {epCount > 0 && (
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
                          {epCount} {epCount === 1 ? 'episode' : 'episodes'}
                        </div>
                      )}
                    </div>
                    {sn === currentSeason && (
                      <div style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: 0.8,
                        color: '#e50914', flexShrink: 0, textTransform: 'uppercase',
                      }}>Now</div>
                    )}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                );
              })
            )
          ) : (
            episodes.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '36px 24px', fontSize: 13 }}>
                No episode data available
              </div>
            ) : (
              episodes.map(ep => {
                const epNum = getEpNum(ep);
                const isActive = viewSeason === currentSeason && epNum === currentEpisode;
                return (
                  <button
                    key={epNum}
                    onClick={() => { onSelect(viewSeason!, epNum); onClose(); }}
                    className="cine-ep-item"
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      background: isActive ? 'rgba(229,9,20,0.12)' : 'transparent',
                      border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: 32, flexShrink: 0,
                      fontWeight: 800, fontSize: 13, fontVariantNumeric: 'tabular-nums',
                      color: isActive ? '#e50914' : 'rgba(255,255,255,0.25)',
                    }}>
                      {String(epNum).padStart(2, '0')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: isActive ? 700 : 500, fontSize: 13,
                        color: isActive ? '#fff' : 'rgba(255,255,255,0.75)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{ep.name || ep.title || `Episode ${epNum}`}</div>
                    </div>
                    {isActive && (
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'rgba(229,9,20,0.85)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <svg width="8" height="10" viewBox="0 0 10 12" fill="#fff">
                          <polygon points="0,0 10,6 0,12"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })
            )
          )}
        </div>
      </div>
    </div>
  );
}

interface StreamOption {
  url: string;
  quality: string;
}

interface VidstackSrc {
  src: string;
  type: 'video/mp4';
}

function pickBestQuality(streams: StreamOption[]): string {
  if (!streams.length) return '';
  const sorted = [...streams].sort((a, b) =>
    (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0)
  );
  return sorted[0].quality;
}

function streamToSource(stream: StreamOption, proxyBase?: string): VidstackSrc {
  return {
    src: buildProxiedMp4Url(stream.url, proxyBase),
    type: 'video/mp4' as const,
  };
}

interface PlayerProps {
  sources: VidstackSrc[];
  poster: string;
  title: string;
  isTV: boolean;
  currentSeason: number;
  currentEpisode: number;
  hasNextEpisode: boolean;
  onNextEpisode?: () => void;
  onOpenEpisodes?: () => void;
  showEpisodePanel: boolean;
  subjectId: string;
  onSelectEpisode: (s: number, e: number) => void;
  onCloseEpisodePanel: () => void;
  autoFullscreen?: boolean;
  onAutoFsDone?: () => void;
  dubs: DubEntry[];
  activeLang: string | null;
  onDubSelect: (dub: DubEntry | null) => void;
  availableQualities: string[];
  activeQuality: string;
  onQualityChange: (quality: string) => void;
  playerTimeRef: React.MutableRefObject<number>;
  resumeTimeRef: React.MutableRefObject<number>;
}

function CinePlayer(props: PlayerProps) {
  const {
    sources, poster, title,
    isTV, currentSeason, currentEpisode, hasNextEpisode, onNextEpisode, onOpenEpisodes,
    showEpisodePanel, subjectId, onSelectEpisode, onCloseEpisodePanel,
    autoFullscreen, onAutoFsDone,
    dubs, activeLang, onDubSelect,
    availableQualities, activeQuality, onQualityChange,
    playerTimeRef, resumeTimeRef,
  } = props;

  const playerRef = useRef<MediaPlayerInstance>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const autoFsRef = useRef(autoFullscreen ?? false);
  autoFsRef.current = autoFullscreen ?? false;

  const { controlsVisible } = useMediaStore(playerRef);

  useEffect(() => {
    const el = topBarRef.current;
    if (!el) return;
    el.style.opacity = controlsVisible ? '1' : '0';
    el.style.pointerEvents = controlsVisible ? 'auto' : 'none';
  }, [controlsVisible]);

  const sourceVersionRef = useRef(0);

  useEffect(() => {
    sourceVersionRef.current += 1;
    const thisVersion = sourceVersionRef.current;
    const seekTo = resumeTimeRef.current;
    resumeTimeRef.current = 0;

    let fsTimer: ReturnType<typeof setTimeout> | null = null;
    if (autoFsRef.current) {
      autoFsRef.current = false;
      fsTimer = setTimeout(() => {
        if (sourceVersionRef.current !== thisVersion) return;
        try { playerRef.current?.el?.requestFullscreen(); } catch (_) {}
        onAutoFsDone?.();
      }, 300);
    }

    let seekCleanup: (() => void) | null = null;
    if (seekTo > 0) {
      const p = playerRef.current;
      const video = p && isVideoProvider(p.provider) ? p.provider.video : null;
      if (video) {
        const handler = () => {
          if (sourceVersionRef.current !== thisVersion) return;
          if (p) {
            const clamped = video.duration ? Math.min(seekTo, video.duration - 0.5) : seekTo;
            p.currentTime = Math.max(0, clamped);
          }
          video.removeEventListener('loadedmetadata', handler);
        };
        video.addEventListener('loadedmetadata', handler);
        seekCleanup = () => video.removeEventListener('loadedmetadata', handler);
      } else {
        const fallback = setTimeout(() => {
          if (sourceVersionRef.current !== thisVersion) return;
          if (p) p.currentTime = seekTo;
        }, 800);
        seekCleanup = () => clearTimeout(fallback);
      }
    }

    return () => {
      if (fsTimer) clearTimeout(fsTimer);
      if (seekCleanup) seekCleanup();
    };
  }, [sources]);

  const unmutedRef = useRef(false);
  useEffect(() => { unmutedRef.current = false; }, [sources]);

  const onPlay = useCallback(() => {
    if (unmutedRef.current) return;
    unmutedRef.current = true;
    const p = playerRef.current;
    const video = p && isVideoProvider(p.provider) ? p.provider.video : null;
    if (!video || !video.muted) return;
    try { video.muted = false; } catch (_) {}
    try { if (p?.muted) p.muted = false; } catch (_) {}
  }, []);

  const onAutoPlayFail = useCallback(() => {
    unmutedRef.current = true;
    const p = playerRef.current;
    const video = p && isVideoProvider(p.provider) ? p.provider.video : null;
    if (!video) return;
    video.muted = true;
    video.play()
      .then(() => {
        setTimeout(() => {
          try { video.muted = false; } catch (_) {}
        }, 500);
      })
      .catch(() => {});
  }, []);

  if (!sources.length) return null;

  return (
    <MediaPlayer
      ref={playerRef}
      className="cine-media-player"
      src={sources}
      autoPlay
      playsInline
      title={title}
      onPlay={onPlay}
      onAutoPlayFail={onAutoPlayFail}
      onTimeUpdate={(detail: { currentTime: number }) => { playerTimeRef.current = detail.currentTime; }}
    >
      {poster && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
          backgroundImage: `url(${poster})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          filter: 'blur(24px) brightness(0.15)',
        }} />
      )}

      <MediaProvider />
      <DefaultVideoLayout
        icons={defaultLayoutIcons}
        noAudioGain
        slots={{
          settingsMenuItemsEnd: (
            <>
              {availableQualities.length > 1 && (
                <Menu.Root className="vds-quality-menu vds-menu">
                  <DefaultMenuButton
                    label="Quality"
                    hint={activeQuality ? `${activeQuality}p` : ''}
                  />
                  <Menu.Items className="vds-menu-items">
                    <DefaultMenuRadioGroup
                      value={activeQuality}
                      options={availableQualities.map(q => ({
                        label: `${q}p`,
                        value: q,
                      }))}
                      onChange={onQualityChange}
                    />
                  </Menu.Items>
                </Menu.Root>
              )}
              {dubs.length > 1 && (
                <Menu.Root className="vds-audio-menu vds-menu">
                  <DefaultMenuButton
                    label="Audio Language"
                    hint={activeLang || ''}
                  />
                  <Menu.Items className="vds-menu-items">
                    <DefaultMenuRadioGroup
                      value={dubs.find(d => d.lanName === activeLang)?.subjectId || dubs.find(d => d.original)?.subjectId || ''}
                      options={dubs.map(dub => ({
                        label: dub.lanName,
                        value: dub.subjectId,
                      }))}
                      onChange={(newValue) => {
                        const dub = dubs.find(d => d.subjectId === newValue);
                        if (dub) onDubSelect(dub);
                      }}
                    />
                  </Menu.Items>
                </Menu.Root>
              )}
            </>
          ),
        }}
      />

      <div ref={topBarRef} className="cine-top-bar" style={{ opacity: 0, pointerEvents: 'none', zIndex: 50 }}>
        {poster && (
          <div className="cine-mini-poster">
            <img src={poster} alt="" />
          </div>
        )}
        <div className="cine-title-block">
          <div className="cine-title-main">{title}</div>
          {isTV && (
            <div className="cine-title-sub">
              {`S${String(currentSeason).padStart(2,'0')} · E${String(currentEpisode).padStart(2,'0')}`}
            </div>
          )}
        </div>

        {isTV && hasNextEpisode && onNextEpisode && (
          <button
            onClick={onNextEpisode}
            title="Next Episode"
            className="cine-top-btn-red"
            style={{
              flexShrink: 0,
              height: 32, padding: '0 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: 'rgba(229,9,20,0.88)', color: '#fff',
              border: '1px solid rgba(229,9,20,0.5)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#fff">
              <polygon points="5,3 19,12 5,21"/>
              <line x1="19" y1="3" x2="19" y2="21" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
            </svg>
            Next
          </button>
        )}

        {isTV && onOpenEpisodes && (
          <button
            onClick={onOpenEpisodes}
            title="Episodes"
            className="cine-top-btn"
            style={{
              flexShrink: 0,
              height: 32, padding: '0 11px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: 'rgba(255,255,255,0.1)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.14)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <svg width="13" height="11" viewBox="0 0 16 12" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
              <line x1="0" y1="1" x2="16" y2="1"/><line x1="0" y1="6" x2="16" y2="6"/><line x1="0" y1="11" x2="16" y2="11"/>
            </svg>
            Episodes
          </button>
        )}
      </div>

      {showEpisodePanel && (
        <EpisodePanel
          subjectId={subjectId}
          currentSeason={currentSeason}
          currentEpisode={currentEpisode}
          onSelect={onSelectEpisode}
          onClose={onCloseEpisodePanel}
        />
      )}
    </MediaPlayer>
  );
}

function useIsPortrait() {
  const [portrait, setPortrait] = useState(
    () => window.matchMedia('(orientation: portrait)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = (e: MediaQueryListEvent) => setPortrait(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return portrait;
}

function PortraitOverlay({
  poster, title, onLandscape,
}: { poster: string; title: string; onLandscape: () => void }) {
  return (
    <div className="cine-portrait-overlay">
      {poster && (
        <div
          className="cine-portrait-bg"
          style={{ backgroundImage: `url(${poster})` }}
        />
      )}
      <div className="cine-portrait-content">
        {poster && (
          <img
            className="cine-portrait-poster"
            src={poster}
            alt={title}
          />
        )}
        <div className="cine-portrait-phone">📱</div>
        {title ? <p className="cine-portrait-title">{title}</p> : null}
        <p className="cine-portrait-hint">Rotate your phone to watch</p>
        <button className="cine-portrait-btn" onClick={onLandscape}>
          Go Fullscreen
        </button>
        <p className="cine-portrait-note">Open it in Chrome browser if the button doesn't work</p>
      </div>
    </div>
  );
}

type AppMode = 'loading' | 'playing' | 'error';

export default function App() {
  const p = new URLSearchParams(window.location.search);
  const type = p.get('type') || 'movie';
  const subjectId = p.get('subjectId') || p.get('id') || '';
  const detailPath = p.get('detailPath') || '';
  const title = p.get('title') || '';
  const poster = p.get('poster') || '';
  const initSeason = parseInt(p.get('season') || '1', 10);
  const initEpisode = parseInt(p.get('episode') || '1', 10);

  const isTV = type === 'tv' || type === 'anime';
  const isPortrait = useIsPortrait();

  const tryLandscape = useCallback(async () => {
    const tg = (window as any).Telegram?.WebApp;
    try { tg?.requestFullscreen?.(); } catch (_) {}
    try { tg?.lockOrientation?.(); } catch (_) {}
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      }
    } catch (_) {}
    try { await (screen.orientation as any).lock?.('landscape'); } catch (_) {}
  }, []);

  const [appMode, setAppMode] = useState<AppMode>(subjectId ? 'loading' : 'error');
  const [availableStreams, setAvailableStreams] = useState<StreamOption[]>([]);
  const [activeQuality, setActiveQuality] = useState('');
  const proxyBaseRef = useRef('');
  const [autoFs, setAutoFs] = useState(false);
  const playerTimeRef = useRef(0);
  const resumeTimeRef = useRef(0);

  const [currentSeason, setCurrentSeason] = useState(initSeason);
  const [currentEpisode, setCurrentEpisode] = useState(initEpisode);
  const [totalEpisodes, setTotalEpisodes] = useState<number>(0);
  const [totalSeasons, setTotalSeasons] = useState<number>(0);
  const [showEpisodePanel, setShowEpisodePanel] = useState(false);

  const [allDubs, setAllDubs] = useState<DubEntry[]>([]);
  const [dubsLoading, setDubsLoading] = useState(false);
  const [activeLang, setActiveLang] = useState<string | null>(null);
  const [dubSwitching, setDubSwitching] = useState(false);
  const dubSwitchVersionRef = useRef(0);


  useEffect(() => {
    if (subjectId) tryLandscape();
  }, [subjectId, tryLandscape]);

  useEffect(() => {
    if (!isTV || !subjectId) return;
    fetchMbSeasons(subjectId).then(seasons => {
      if (!seasons.length) return;
      setTotalSeasons(seasons.length);
      const getNum = (s: SeasonInfo) => s.seasonNumber || s.season || 1;
      const cur = seasons.find(s => getNum(s) === currentSeason);
      if (cur?.episodes) setTotalEpisodes(cur.episodes.length);
    });
  }, [isTV, subjectId, currentSeason]);

  useEffect(() => {
    if (!subjectId) return;
    setDubsLoading(true);
    const controller = new AbortController();
    fetchDubs(subjectId, isTV ? currentSeason : undefined, isTV ? currentEpisode : undefined, controller.signal)
      .then(dubs => {
        if (controller.signal.aborted) return;
        setAllDubs(dubs);
        if (!activeLang) {
          const orig = dubs.find(d => d.original);
          if (orig) setActiveLang(orig.lanName);
        }
        setDubsLoading(false);
      });
    return () => controller.abort();
  }, [subjectId, isTV, currentSeason, currentEpisode]);

  const applyStreams = useCallback((streams: StreamOption[], proxyBase?: string, preferQuality?: string) => {
    proxyBaseRef.current = proxyBase || '';
    setAvailableStreams(streams);
    const best = preferQuality && streams.find(s => s.quality === preferQuality)
      ? preferQuality
      : pickBestQuality(streams);
    setActiveQuality(best);
  }, []);

  const handleQualityChange = useCallback((quality: string) => {
    if (quality === activeQuality) return;
    resumeTimeRef.current = playerTimeRef.current;
    const wasFullscreen = !!document.fullscreenElement;
    if (wasFullscreen) setAutoFs(true);
    setActiveQuality(quality);
  }, [activeQuality]);

  const handleDubSelect = useCallback(async (dub: DubEntry | null) => {
    if (!subjectId) return;
    if (dub && dub.lanName === activeLang) return;
    dubSwitchVersionRef.current += 1;
    const thisVersion = dubSwitchVersionRef.current;
    resumeTimeRef.current = playerTimeRef.current;

    const wasFullscreen = !!document.fullscreenElement;

    if (!dub) {
      if (activeLang) {
        setDubSwitching(true);
        if (wasFullscreen) setAutoFs(true);
        const result = await resolveMovieBoxStream({
          subjectId,
          detailPath: detailPath || undefined,
          season: isTV ? currentSeason : undefined,
          episode: isTV ? currentEpisode : undefined,
        });
        if (thisVersion !== dubSwitchVersionRef.current) return;
        if (result && result.streams.length > 0) {
          const streams: StreamOption[] = result.streams.map((s: { url: string; quality: string }) => ({
            url: s.url, quality: String(s.quality),
          }));
          applyStreams(streams, result.proxyBase);
          setActiveLang(null);
        }
        setDubSwitching(false);
      }
      return;
    }
    setDubSwitching(true);
    if (wasFullscreen) setAutoFs(true);
    try {
      const result = await resolveMovieBoxStream({
        subjectId: dub.subjectId,
        season: isTV ? currentSeason : undefined,
        episode: isTV ? currentEpisode : undefined,
      });
      if (thisVersion !== dubSwitchVersionRef.current) return;
      if (result && result.streams.length > 0) {
        const streams: StreamOption[] = result.streams.map((s: { url: string; quality: string }) => ({
          url: s.url, quality: String(s.quality),
        }));
        applyStreams(streams, result.proxyBase);
        setActiveLang(dub.lanName);
      } else {
        setAllDubs(prev => prev.filter(d => d.subjectId !== dub.subjectId));
      }
    } catch {
      if (thisVersion !== dubSwitchVersionRef.current) return;
      setAllDubs(prev => prev.filter(d => d.subjectId !== dub.subjectId));
    }
    if (thisVersion === dubSwitchVersionRef.current) setDubSwitching(false);
  }, [subjectId, detailPath, isTV, currentSeason, currentEpisode, activeLang, applyStreams]);

  const load = useCallback(async (season: number, episode: number) => {
    if (!subjectId) return;
    setAppMode('loading');
    setAvailableStreams([]);
    setActiveQuality('');
    setActiveLang(null);

    const result = await resolveMovieBoxStream({
      subjectId,
      detailPath: detailPath || undefined,
      season: isTV ? season : undefined,
      episode: isTV ? episode : undefined,
    });

    if (!result || result.streams.length === 0) {
      setAppMode('error');
      return;
    }

    const streams: StreamOption[] = result.streams.map((s: { url: string; quality: string }) => ({
      url: s.url,
      quality: String(s.quality),
    }));
    applyStreams(streams, result.proxyBase);
    setAppMode('playing');
  }, [subjectId, detailPath, isTV, applyStreams]);

  useEffect(() => {
    if (subjectId) load(initSeason, initEpisode);
  }, []);

  const selectEpisode = useCallback((season: number, episode: number) => {
    playerTimeRef.current = 0;
    resumeTimeRef.current = 0;
    setCurrentSeason(season);
    setCurrentEpisode(episode);
    setShowEpisodePanel(false);
    setAutoFs(!!document.fullscreenElement);
    load(season, episode);

    fetchMbSeasons(subjectId).then(seasons => {
      const getNum = (s: SeasonInfo) => s.seasonNumber || s.season || 1;
      const s = seasons.find(x => getNum(x) === season);
      if (s?.episodes) setTotalEpisodes(s.episodes.length);
      setTotalSeasons(seasons.length);
    });
  }, [load, subjectId]);

  const goNextEpisode = useCallback(() => {
    if (currentEpisode < totalEpisodes) {
      selectEpisode(currentSeason, currentEpisode + 1);
    } else if (currentSeason < totalSeasons) {
      selectEpisode(currentSeason + 1, 1);
    }
  }, [currentEpisode, totalEpisodes, currentSeason, totalSeasons, selectEpisode]);

  const hasNextEpisode = isTV && (currentEpisode < totalEpisodes || currentSeason < totalSeasons);

  const sources = useMemo(() => {
    const currentStream = availableStreams.find(s => s.quality === activeQuality) || availableStreams[0];
    return currentStream ? [streamToSource(currentStream, proxyBaseRef.current)] : [];
  }, [availableStreams, activeQuality]);

  const sortedQualities = useMemo(() =>
    [...new Set(availableStreams.map(s => s.quality))]
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
    [availableStreams]);

  if (!subjectId) {
    return (
      <div className="cine-fullscreen">
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: '0 24px', textAlign: 'center' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(229,9,20,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>CineBot Player</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5, maxWidth: 260 }}>
            Open a movie or show from the Telegram bot to start watching.
          </div>
        </div>
      </div>
    );
  }

  if (appMode === 'loading') return <LoadingScreen poster={poster} title={title} />;
  if (appMode === 'error') return <ErrorScreen poster={poster} title={title} onRetry={() => load(currentSeason, currentEpisode)} />;
  if (isPortrait && !dubSwitching && !autoFs) return <PortraitOverlay poster={poster} title={title} onLandscape={tryLandscape} />;

  return (
    <CinePlayer
      sources={sources}
      poster={poster}
      title={title}
      isTV={isTV}
      currentSeason={currentSeason}
      currentEpisode={currentEpisode}
      hasNextEpisode={hasNextEpisode}
      onNextEpisode={isTV ? goNextEpisode : undefined}
      onOpenEpisodes={isTV ? () => setShowEpisodePanel(true) : undefined}
      showEpisodePanel={showEpisodePanel}
      subjectId={subjectId}
      onSelectEpisode={selectEpisode}
      onCloseEpisodePanel={() => setShowEpisodePanel(false)}
      autoFullscreen={autoFs}
      onAutoFsDone={() => setAutoFs(false)}
      dubs={allDubs}
      activeLang={activeLang}
      onDubSelect={handleDubSelect}
      availableQualities={sortedQualities}
      activeQuality={activeQuality}
      onQualityChange={handleQualityChange}
      playerTimeRef={playerTimeRef}
      resumeTimeRef={resumeTimeRef}
    />
  );
}
