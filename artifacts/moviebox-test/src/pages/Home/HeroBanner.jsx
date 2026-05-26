import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toDetailPath } from './urlUtils';
import { FaPlay, FaInfoCircle, FaStar } from 'react-icons/fa';
import { BiCalendar } from 'react-icons/bi';
import { fetchHome, normalizeHomeSection, mbCoverUrl } from './Fetcher';
import SharedSkeleton from '../../components/Skeleton';

const INTERVAL = 7000;

const useTrending = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchHome();
        if (cancelled) return;
        const sections = data?.data?.operatingList || data?.data?.items || data?.data?.sections || data?.data?.list || data?.items || data?.sections || [];
        let heroItems = [];
        for (const sec of sections) {
          const bannerList = sec.banner?.banners || sec.banner?.items || [];
          if (sec.type === 'BANNER' && bannerList.length) {
            for (const b of bannerList) {
              const s = b.subject;
              if (s && s.title && (s.cover?.url || b.image?.url) && heroItems.length < 8) {
                heroItems.push({
                  subjectId: String(s.subjectId || ''),
                  title: s.title,
                  description: '',
                  cover: s.cover?.url || b.image?.url || '',
                  backdrop: b.image?.url || s.cover?.url || '',
                  releaseDate: s.releaseDate || '',
                  subjectType: s.subjectType ?? 1,
                  rating: '',
                  genre: s.genre || '',
                  hasResource: s.hasResource !== false,
                });
              }
            }
            continue;
          }
          const normalized = normalizeHomeSection(sec);
          for (const item of normalized) {
            if (item.cover && item.title && heroItems.length < 8) {
              heroItems.push(item);
            }
          }
          if (heroItems.length >= 8) break;
        }
        setItems(heroItems);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return { items, loading };
};

function useImagePreloader(src) {
  const [ready, setReady] = useState(false);
  const prevSrc = useRef(null);

  useEffect(() => {
    if (!src) { setReady(false); return; }
    if (src === prevSrc.current) return;
    prevSrc.current = src;
    setReady(false);
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setReady(true); };
    img.onerror = () => { if (!cancelled) setReady(true); };
    img.src = src;
    if (img.complete) { if (!cancelled) setReady(true); }
    return () => { cancelled = true; };
  }, [src]);

  return ready;
}

// Single-shimmer hero skeleton. Previously each placeholder ran its own
// `animate-pulse` — six concurrent timers and six paint regions on a
// full-bleed hero. Now one Skeleton block backs the whole hero and the
// foreground placeholders are static dim shapes (no animation).
const Skeleton = () => (
  <div className="relative w-full h-[80vh] md:h-[90vh] lg:h-screen overflow-hidden bg-[#0a0c12]">
    <SharedSkeleton className="absolute inset-0" rounded="rounded-none" />
    <div className="absolute inset-0 bg-gradient-to-t from-[#0a0c12] via-transparent to-black/35" />
    <div className="relative z-10 h-full flex flex-col justify-end md:justify-center px-6 md:px-14 pb-24 md:pb-20 max-w-2xl">
      <div className="w-24 h-7 rounded-full bg-white/[0.08] mb-4" />
      <div className="space-y-3 mb-5">
        <div className="h-12 md:h-14 w-[85%] rounded-lg bg-white/[0.09]" />
        <div className="h-12 md:h-14 w-[65%] rounded-lg bg-white/[0.08]" />
      </div>
      <div className="flex gap-2 mb-6">
        <div className="h-4 w-20 rounded-full bg-white/[0.08]" />
        <div className="h-4 w-16 rounded-full bg-white/[0.07]" />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-12 w-40 rounded-full bg-white/[0.12]" />
        <div className="h-12 w-36 rounded-full bg-white/[0.09]" />
      </div>
    </div>
  </div>
);

export default function HeroBanner() {
  const { items, loading } = useTrending();
  const [active, setActive] = useState(0);
  const [fade, setFade] = useState(true);
  const [barKey, setBarKey] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const navigate = useNavigate();
  const ioRef = useRef(null);
  const [inView, setInView] = useState(true);
  const [docVisible, setDocVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );

  const firstSrc = items.length ? mbCoverUrl(items[0].backdrop || items[0].cover, 1280) : null;
  const firstImgReady = useImagePreloader(firstSrc);

  // Callback ref: the hero root only mounts after the skeleton is replaced
  // (showSkeleton flips to false). A regular useRef + useEffect would miss
  // that mount because its deps wouldn't change. Attach/detach the
  // IntersectionObserver as the node itself mounts/unmounts.
  const setHeroEl = useCallback((node) => {
    if (ioRef.current) {
      ioRef.current.disconnect();
      ioRef.current = null;
    }
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '0px', threshold: 0 }
    );
    io.observe(node);
    ioRef.current = io;
  }, []);

  useEffect(() => {
    return () => {
      if (ioRef.current) {
        ioRef.current.disconnect();
        ioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setDocVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (firstImgReady && items.length && !revealed) {
      let rafId1, rafId2;
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(() => setRevealed(true));
      });
      return () => { cancelAnimationFrame(rafId1); cancelAnimationFrame(rafId2); };
    }
  }, [firstImgReady, items.length, revealed]);

  const goTo = useCallback((next) => {
    setFade(false);
    setTimeout(() => {
      setActive(typeof next === 'function' ? next : () => next);
      setFade(true);
      setBarKey(k => k + 1);
    }, 300);
  }, []);

  useEffect(() => {
    if (items.length < 2) return;
    // Don't run the rotation when the hero is offscreen (user has scrolled
    // past it) or when the tab is hidden — saves background paint cost.
    if (!inView || !docVisible) return;
    const id = setInterval(() => goTo(prev => (prev + 1) % items.length), INTERVAL);
    return () => clearInterval(id);
  }, [items.length, goTo, barKey, inView, docVisible]);

  const showSkeleton = loading || !items.length || !firstImgReady;

  if (!loading && !items.length) return null;
  if (showSkeleton) return <Skeleton />;

  const item = items[active];
  const isTV = item.subjectType !== 1;
  const title = item.title;
  const year = (item.releaseDate || '').slice(0, 4);
  const rating = item.rating || null;
  const overview = (item.description || '').slice(0, 220) + ((item.description || '').length > 220 ? '...' : '');
  const genres = item.genre ? item.genre.split(',').map(g => g.trim()).filter(Boolean).slice(0, 3) : [];
  const bgSrc = mbCoverUrl(item.backdrop || item.cover, 1280);

  const handlePlay = () => navigate(toDetailPath(isTV ? 'tv' : 'movie', item.subjectId, title));

  return (
    <div
      ref={setHeroEl}
      className="relative w-full h-[80vh] md:h-[90vh] lg:h-screen overflow-hidden bg-black select-none"
      style={{ opacity: revealed ? 1 : 0, transition: 'opacity 0.6s ease-out' }}
    >
      <div className={`absolute inset-0 transition-opacity duration-500 ${fade ? 'opacity-100' : 'opacity-0'}`}>
        <div
          className="absolute inset-0 scale-105"
          style={{
            backgroundImage: `url(${bgSrc})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0c12] via-[#0a0c12]/30 to-black/20" />
        <div className="absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-black/50 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#0a0c12] to-transparent" />
      </div>

      <div className={`relative z-10 h-full flex flex-col justify-end md:justify-center px-6 md:px-14 lg:px-20 pb-24 md:pb-20 max-w-3xl transition-all duration-500 ${fade ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
        <div className="flex items-center gap-3 mb-5">
          <span className="inline-flex items-center gap-1.5 bg-red-600/20 border border-red-500/40 text-red-400 text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            Trending
          </span>
          <span className="text-gray-400 text-[11px] font-semibold uppercase tracking-widest">
            {isTV ? 'TV Series' : 'Movie'}
          </span>
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-white leading-[1.02] tracking-tight mb-4 drop-shadow-[0_2px_24px_rgba(0,0,0,0.9)]">
          {title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
          {rating && (
            <span className="flex items-center gap-1.5 text-yellow-400 font-bold text-sm">
              <FaStar className="text-yellow-400 text-xs" />
              {rating}
            </span>
          )}
          {year && (
            <span className="flex items-center gap-1.5 text-gray-400 text-sm">
              <BiCalendar className="text-gray-500 text-xs" />
              {year}
            </span>
          )}
          {genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {genres.map(g => (
                <span key={g} className="text-[11px] font-semibold text-gray-300 bg-white/[0.09] border border-white/[0.12] px-2.5 py-0.5 rounded-full">
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>

        {overview && (
          <p className="text-gray-300/85 text-[15px] leading-relaxed mb-8 max-w-xl hidden sm:block line-clamp-3">
            {overview}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handlePlay}
            className="flex items-center gap-2.5 bg-red-600 hover:bg-red-500 text-white font-bold px-8 py-3.5 rounded-full transition-all duration-200 hover:scale-105 shadow-lg shadow-red-700/40 text-[15px]"
          >
            <FaPlay className="text-xs" />
            Play Now
          </button>
          <button
            onClick={handlePlay}
            className="flex items-center gap-2 bg-white/[0.1] hover:bg-white/[0.18] backdrop-blur border border-white/[0.15] text-white font-semibold px-7 py-3.5 rounded-full transition-all duration-200 text-[15px]"
          >
            <FaInfoCircle className="text-sm" />
            <span className="hidden sm:inline">More Info</span>
            <span className="sm:hidden">Details</span>
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => { if (i !== active) goTo(i); }}
              aria-label={`Slide ${i + 1}`}
              className="relative overflow-hidden rounded-full transition-all duration-300"
              style={{ width: i === active ? 28 : 8, height: 8 }}
            >
              <span className="absolute inset-0 rounded-full bg-gray-600/50" />
              {i === active ? (
                <span
                  key={barKey}
                  className="absolute inset-y-0 left-0 rounded-full bg-red-500"
                  style={{ animation: `fillBar ${INTERVAL}ms linear forwards` }}
                />
              ) : (
                <span className="absolute inset-0 rounded-full bg-gray-500/50 hover:bg-gray-400/60 transition-colors" />
              )}
            </button>
          ))}
        </div>
      )}

      {items.length > 1 && (
        <div className="absolute bottom-8 right-6 z-20 hidden lg:flex gap-2">
          {items.map((it, i) => (
            <button
              key={it.subjectId}
              onClick={() => { if (i !== active) goTo(i); }}
              className={`relative w-[80px] h-[50px] rounded-lg overflow-hidden ring-1 transition-all duration-200 ${
                i === active
                  ? 'ring-red-500 scale-105 opacity-100'
                  : 'ring-white/10 opacity-45 hover:opacity-75'
              }`}
            >
              <img src={mbCoverUrl(it.cover, 80)} loading="lazy" alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <style>{`@keyframes fillBar { from { width:0% } to { width:100% } }`}</style>
    </div>
  );
}
