import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  memo,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import PropTypes from "prop-types";
import { fetchMbDetail, fetchMbSeasons, mbCoverUrl } from "../Fetcher";
import { getIdFromDetailSlug, getTitleFromDetailSlug } from "../urlUtils";
import { saveToContinueWatching } from "../../../utils/continueWatching";
import {
  FaRedo,
  FaStar,
  FaArrowLeft,
  FaStepBackward,
  FaStepForward,
  FaInfoCircle,
  FaBookmark,
  FaPlay,
  FaShareAlt,
  FaChevronDown,
  FaThumbsUp,
} from "react-icons/fa";
import { BiCalendar, BiTv, BiSearch } from "react-icons/bi";
import DetailPageSkeleton from "../reused/DetailPageSkeleton";
import CastRow from "../reused/CastRow";
import SmartPlayer, { enterFullscreenLandscape, preResolveStream } from "../SmartPlayer";
import SEO from "../SEO";
import AuthModal from "../../../components/AuthModal";
import { useWatchlist } from "../../../context/WatchlistContext";
import { useProgressWhile } from "../../../context/ProgressContext";
// View-transition wiring (Task #115) was reverted — see ContentCard for context.

const getValidParamNumber = (params, key) => {
  const raw = params.get(key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
};

const TvDetails = ({ tvId: tvIdProp }) => {
  const { slug } = useParams();
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const tvId = tvIdProp ?? getIdFromDetailSlug(slug);
  const titleHint = slug ? getTitleFromDetailSlug(slug) : '';
  const navigate = useNavigate();
  const [tv, setTv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [allSeasons, setAllSeasons] = useState([]);
  const [viewingSeason, setViewingSeason] = useState(null);
  const [playingSeason, setPlayingSeason] = useState(null);
  const [playingEpisode, setPlayingEpisode] = useState(null);
  const [showOverview, setShowOverview] = useState(false);
  const [episodeQuery, setEpisodeQuery] = useState('');
  const [showPlayer, setShowPlayer] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(null);
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false);

  useProgressWhile(loading);
  const [seasonFading, setSeasonFading] = useState(false);
  const { user, watchlistIds, toggleWatchlist: ctxToggleWatchlist } = useWatchlist();
  const inWatchlist = tv?.subjectId ? watchlistIds.has(String(tv.subjectId)) : false;

  const seasonDropdownRef = useRef(null);
  const seasonFadeTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (seasonFadeTimerRef.current) clearTimeout(seasonFadeTimerRef.current);
    };
  }, []);

  const handleBack = () => {
    const go = () => {
      if (location.state?.from) {
        navigate(location.state.from);
        return;
      }
      navigate(-1);
    };
    go();
  };

  useLayoutEffect(() => {
    setLoading(true);
    setError(null);
    setTv(null);
    setAllSeasons([]);
    setViewingSeason(null);
    setPlayingSeason(null);
    setPlayingEpisode(null);
    setShowOverview(false);
    setEpisodeQuery('');
    setShowPlayer(false);
    setIsAuthModalOpen(false);
    setActiveTab(null);
    setSeasonDropdownOpen(false);
  }, [tvId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRetrying(true);
    try {
      const [detailData, seasonsData] = await Promise.all([
        fetchMbDetail(tvId, titleHint || undefined),
        fetchMbSeasons(tvId).catch(() => ({ seasons: [] })),
      ]);
      setTv(detailData);

      const mbSeasons = (seasonsData?.seasons || []).map((s) => {
        const epCount = s.maxEp || s.episodeCount || s.episodes?.length || 0;
        const epList = s.episodes?.length > 0
          ? s.episodes.map((e, i) => ({
              episode_number: e.episodeNumber ?? e.episode_number ?? (i + 1),
              name: e.name || e.title || `Episode ${e.episodeNumber ?? e.episode_number ?? (i + 1)}`,
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
      }).filter(s => s.season_number != null && s.episode_count > 0)
        .sort((a, b) => a.season_number - b.season_number);

      setAllSeasons(mbSeasons);
      setActiveTab(mbSeasons.length > 0 ? 'episodes' : 'details');

      if (mbSeasons.length > 0) {
        const urlParams = new URLSearchParams(window.location.search);
        let urlSeason = getValidParamNumber(urlParams, 'season');
        let urlEpisode = getValidParamNumber(urlParams, 'episode');

        const selectedSeason = (urlSeason && mbSeasons.find(s => s.season_number === urlSeason)) ?? mbSeasons[0];
        const selectedEpisode = urlEpisode && urlEpisode <= selectedSeason.episode_count ? urlEpisode : 1;

        setViewingSeason(selectedSeason.season_number);
        setPlayingSeason(selectedSeason.season_number);
        setPlayingEpisode(selectedEpisode);
      }
    } catch {
      setError("Failed to load TV show details. Please try again.");
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [tvId, titleHint]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [tvId]);

  useEffect(() => {
    if (!allSeasons.length || playingSeason === null || playingEpisode === null) return;
    if (loading) return;
    const params = new URLSearchParams(location.search);
    const currentSeason = getValidParamNumber(params, 'season');
    const currentEpisode = getValidParamNumber(params, 'episode');
    if (currentSeason === playingSeason && currentEpisode === playingEpisode) return;
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('season', String(playingSeason));
    nextParams.set('episode', String(playingEpisode));
    setSearchParams(nextParams, { replace: true });
  }, [allSeasons.length, playingSeason, playingEpisode, location.search, setSearchParams, loading]);

  useEffect(() => {
    if (!tv?.subjectId || playingSeason === null || playingEpisode === null) return;
    preResolveStream(tv.subjectId, "tv", playingSeason, playingEpisode);
  }, [tv, playingSeason, playingEpisode]);

  useEffect(() => {
    if (!tv || playingSeason === null || playingEpisode === null) return;
    saveToContinueWatching(user?.uid, {
      id: tv.subjectId,
      mediaType: 'tv',
      title: `${tv.title} - S${playingSeason}E${playingEpisode}`,
      poster_path: tv.cover?.url || '',
      vote_average: parseFloat(tv.imdbRatingValue) || 0,
      release_date: tv.releaseDate,
      season: playingSeason,
      episode: playingEpisode,
    });
  }, [tv, playingSeason, playingEpisode, user]);

  useEffect(() => {
    if (!seasonDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (seasonDropdownRef.current && !seasonDropdownRef.current.contains(e.target)) {
        setSeasonDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [seasonDropdownOpen]);

  const toggleWatchlist = () => {
    if (!tv?.subjectId) return;
    ctxToggleWatchlist(
      {
        mediaId: tv.subjectId,
        type: 'tv',
        title: tv.title,
        poster_path: tv.cover?.url || '',
        vote_average: parseFloat(tv.imdbRatingValue) || 0,
        release_date: tv.releaseDate,
      },
      () => setIsAuthModalOpen(true)
    );
  };

  const currentSeasonData = allSeasons.find(s => s.season_number === viewingSeason);
  const sortedEpisodes = currentSeasonData?.episodes || [];
  const filteredEpisodes = sortedEpisodes.filter((ep) => {
    const q = episodeQuery.trim().toLowerCase();
    if (!q) return true;
    const title = (ep.name || '').toLowerCase();
    return title.includes(q) || String(ep.episode_number).includes(q);
  });

  const activeEpisodeIndex = sortedEpisodes.findIndex((ep) =>
    ep.episode_number === playingEpisode && currentSeasonData?.season_number === playingSeason
  );

  const jumpEpisode = (direction) => {
    if (!sortedEpisodes.length || activeEpisodeIndex < 0) return;
    const nextIndex = activeEpisodeIndex + direction;
    if (nextIndex < 0 || nextIndex >= sortedEpisodes.length) return;
    const nextEp = sortedEpisodes[nextIndex];
    setPlayingSeason(currentSeasonData.season_number);
    setPlayingEpisode(nextEp.episode_number);
  };

  const playEpisode = (seasonNum, epNum) => {
    // Mount the SmartPlayer overlay synchronously BEFORE requesting fullscreen.
    // Otherwise Chrome fullscreens the scrolled documentElement (no overlay
    // present yet) which renders the page content as a "cut" sliver.
    flushSync(() => {
      setPlayingSeason(seasonNum);
      setPlayingEpisode(epNum);
      setShowPlayer(true);
    });
    enterFullscreenLandscape();
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: tv?.title, url: window.location.href });
    } catch {}
  };

  if (loading) return <DetailPageSkeleton type="tv" />;

  if (error) return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-red-900/20 border border-red-700/50 rounded-2xl p-8 max-w-sm w-full text-center">
        <p className="text-red-300 mb-6">{error}</p>
        <button
          onClick={load}
          disabled={retrying}
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          <FaRedo className={retrying ? "animate-spin" : ""} />
          {retrying ? "Retrying..." : "Retry"}
        </button>
      </div>
    </div>
  );

  if (!tv) return null;

  const rating = tv.imdbRatingValue || null;
  const year = (tv.releaseDate || '').slice(0, 4);
  const genres = tv.genre ? tv.genre.split(',').map(g => g.trim()).filter(Boolean).slice(0, 3) : [];
  const overview = tv.description || "";
  const truncated = overview.length > 240 && !showOverview
    ? overview.slice(0, 240) + "..."
    : overview;
  const coverUrl = mbCoverUrl(tv.cover, 1280) || '';
  const staffList = tv.staffList || [];
  const cast = staffList.filter(s => s.staffType === 2 || s.type === 'cast' || s.type === 'actor' || !s.type).slice(0, 20).map(s => ({
    name: s.name,
    character: s.character || '',
    avatar: s.avatarUrl ? { url: s.avatarUrl } : (s.avatar || null),
  }));

  return (
    <div className="min-h-screen bg-[#141414] text-gray-200 selection:bg-red-500/30">
      <SEO
        title={`${tv.title}${year ? ` (${year})` : ''} — Watch Free on PopCorn TV`}
        description={overview ? `${overview.slice(0, 150).trim()}... Stream ${tv.title} free on PopCorn TV.` : `Stream ${tv.title} free on PopCorn TV.`}
        image={coverUrl}
        type="video.episode"
      />

      <div className="relative w-full" style={{ minHeight: 'min(80vh, 600px)' }}>
        <div className="absolute inset-0 z-0 select-none overflow-hidden">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt=""
              className="w-full h-full object-cover object-top"
              style={{
                filter: "brightness(0.45) contrast(1.1) saturate(1.1)",
              }}
            />
          ) : (
            <div className="w-full h-full bg-[#141414]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#141414] to-transparent" />
        </div>

        <div className="absolute top-0 left-0 right-0 z-20 p-4 md:p-8 flex">
          <button
            onClick={handleBack}
            className="group flex items-center gap-2 bg-black/40 hover:bg-black/60 backdrop-blur-sm border border-white/10 text-gray-200 hover:text-white text-sm font-medium px-4 py-2 rounded-full transition-all"
          >
            <FaArrowLeft className="group-hover:-translate-x-0.5 transition-transform" />
            <span>Back</span>
          </button>
        </div>

        <div className="relative z-10 flex flex-col justify-end h-full px-4 md:px-8 lg:px-12 pb-8" style={{ minHeight: 'min(80vh, 600px)' }}>
          <div className="max-w-3xl">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.1] mb-4 drop-shadow-lg">
              {tv.title}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300 mb-4">
              {rating && (
                <span className="flex items-center gap-1 text-green-400 font-bold">
                  <FaStar className="text-xs" /> {rating}
                </span>
              )}
              {year && <span>{year}</span>}
              {allSeasons.length > 0 && (
                <span>{allSeasons.length} Season{allSeasons.length !== 1 ? 's' : ''}</span>
              )}
              {genres.length > 0 && (
                <span className="text-gray-400">{genres.join(' · ')}</span>
              )}
            </div>

            {overview && (
              <div className="mb-5">
                <p className="text-gray-300 text-sm md:text-base leading-relaxed max-w-2xl">{truncated}</p>
                {overview.length > 240 && (
                  <button onClick={() => setShowOverview(p => !p)} className="mt-2 text-white/70 hover:text-white text-xs font-medium transition-colors">
                    {showOverview ? "Show Less" : "More"}
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 mb-2">
              <button
                onClick={() => {
                  flushSync(() => { setShowPlayer(true); });
                  enterFullscreenLandscape();
                }}
                className="flex items-center gap-2.5 bg-white hover:bg-gray-200 text-black font-bold px-6 md:px-8 py-2.5 md:py-3 rounded-md transition-all active:scale-[0.97] text-sm md:text-base"
              >
                <FaPlay className="text-xs md:text-sm" />
                Play
              </button>

              <button
                onClick={toggleWatchlist}
                className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full border-2 border-gray-400 hover:border-white bg-black/40 hover:bg-black/60 text-white transition-all"
                title={inWatchlist ? "Remove from My List" : "Add to My List"}
              >
                {inWatchlist ? (
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14"/></svg>
                )}
              </button>

              <button
                className="flex flex-col items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full border-2 border-gray-400 hover:border-white bg-black/40 hover:bg-black/60 text-white transition-all"
                title="Rate"
              >
                <FaThumbsUp className="text-sm" />
              </button>

              <button
                onClick={handleShare}
                className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full border-2 border-gray-400 hover:border-white bg-black/40 hover:bg-black/60 text-white transition-all"
                title="Share"
              >
                <FaShareAlt className="text-sm" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8 lg:px-12 max-w-5xl">
        <div className="flex gap-6 border-b border-white/10 mb-5">
          {allSeasons.length > 0 && (
            <button
              onClick={() => setActiveTab('episodes')}
              className={`py-3 text-sm font-semibold transition-colors relative ${activeTab === 'episodes' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              EPISODES
              {activeTab === 'episodes' && <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-red-600 rounded-full" />}
            </button>
          )}
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 text-sm font-semibold transition-colors relative ${activeTab === 'details' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            DETAILS
            {activeTab === 'details' && <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-red-600 rounded-full" />}
          </button>
          {cast.length > 0 && (
            <button
              onClick={() => setActiveTab('cast')}
              className={`py-3 text-sm font-semibold transition-colors relative ${activeTab === 'cast' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              CAST
              {activeTab === 'cast' && <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-red-600 rounded-full" />}
            </button>
          )}
          <button
            onClick={() => setActiveTab('more')}
            className={`py-3 text-sm font-semibold transition-colors relative ${activeTab === 'more' ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            MORE LIKE THIS
            {activeTab === 'more' && <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-red-600 rounded-full" />}
          </button>
        </div>

        {activeTab === 'episodes' && allSeasons.length > 0 && (
          <div className="pb-12">
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              {allSeasons.length > 1 ? (
                <div ref={seasonDropdownRef} className="relative">
                  <button
                    onClick={() => setSeasonDropdownOpen(v => !v)}
                    className="flex items-center gap-2 bg-[#242424] hover:bg-[#333] text-white text-sm font-semibold px-4 py-2.5 rounded-md border border-white/10 transition-all min-w-[160px] justify-between"
                  >
                    <span>{tv.title} — Season {viewingSeason}</span>
                    <FaChevronDown className={`text-xs transition-transform ${seasonDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {seasonDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 min-w-[200px] bg-[#242424] border border-white/10 rounded-md shadow-2xl z-30 overflow-hidden max-h-64 overflow-y-auto">
                      {allSeasons.map(season => (
                        <button
                          key={season.season_number}
                          onClick={() => {
                            if (viewingSeason === season.season_number) {
                              setSeasonDropdownOpen(false);
                              return;
                            }
                            if (seasonFadeTimerRef.current) clearTimeout(seasonFadeTimerRef.current);
                            setSeasonFading(true);
                            setSeasonDropdownOpen(false);
                            seasonFadeTimerRef.current = setTimeout(() => {
                              setViewingSeason(season.season_number);
                              setPlayingSeason(season.season_number);
                              setPlayingEpisode(1);
                              setEpisodeQuery('');
                              seasonFadeTimerRef.current = setTimeout(() => setSeasonFading(false), 30);
                            }, 200);
                          }}
                          className={`w-full text-left px-4 py-3 text-sm transition-colors ${viewingSeason === season.season_number ? 'bg-white/10 text-white font-semibold' : 'text-gray-300 hover:bg-white/5'}`}
                        >
                          Season {season.season_number}
                          <span className="text-gray-500 ml-2 text-xs">({season.episode_count} ep{season.episode_count !== 1 ? 's' : ''})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <h3 className="text-white font-semibold text-base">
                  Season {viewingSeason}
                  <span className="text-gray-500 text-sm font-normal ml-2">({currentSeasonData?.episode_count ?? 0} episodes)</span>
                </h3>
              )}

              <div className="relative">
                <BiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                <input
                  type="text"
                  value={episodeQuery}
                  onChange={e => setEpisodeQuery(e.target.value)}
                  placeholder="Search episodes…"
                  className="w-full sm:w-56 pl-9 pr-4 py-2 rounded-md bg-[#242424] border border-white/10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/30 transition-all"
                />
              </div>
            </div>

            <div className={`flex flex-col divide-y divide-white/5 transition-all duration-200 ${seasonFading ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}>
              {filteredEpisodes.length > 0 ? filteredEpisodes.map(ep => {
                const isPlaying = playingSeason === viewingSeason && playingEpisode === ep.episode_number;
                return (
                  <button
                    key={ep.episode_number}
                    onClick={() => playEpisode(currentSeasonData.season_number, ep.episode_number)}
                    className={`flex items-center gap-4 py-4 hover:bg-white/5 transition-colors text-left w-full group ${isPlaying ? 'bg-white/[0.03]' : ''}`}
                  >
                    <span className={`text-lg font-medium w-8 text-center shrink-0 ${isPlaying ? 'text-white' : 'text-gray-500'}`}>
                      {ep.episode_number}
                    </span>

                    <div className="relative shrink-0 w-28 sm:w-36 aspect-video rounded-md overflow-hidden bg-[#1a1a1a]">
                      {coverUrl ? (
                        <img
                          src={coverUrl}
                          alt=""
                          className="w-full h-full object-cover opacity-60"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-700">
                          <BiTv className="text-2xl" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full border-2 border-white flex items-center justify-center">
                          <FaPlay className="text-white text-xs ml-0.5" />
                        </div>
                      </div>
                      {isPlaying && (
                        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          NOW
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <p className={`font-medium text-sm leading-snug ${isPlaying ? 'text-white' : 'text-gray-200 group-hover:text-white'} truncate`}>
                          {ep.name || `Episode ${ep.episode_number}`}
                        </p>
                        {ep.runtime && (
                          <span className="text-xs text-gray-500 shrink-0">{ep.runtime}m</span>
                        )}
                      </div>
                      {ep.overview && (
                        <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{ep.overview}</p>
                      )}
                    </div>
                  </button>
                );
              }) : (
                <div className="py-10 text-center text-gray-500 text-sm">
                  {episodeQuery.trim() ? 'No episodes found.' : 'No episodes available for this season.'}
                </div>
              )}
            </div>

            {playingSeason !== null && playingEpisode !== null && sortedEpisodes.length > 1 && (
              <div className="flex items-center justify-between pt-6 gap-3">
                <button
                  onClick={() => jumpEpisode(-1)}
                  disabled={activeEpisodeIndex <= 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#242424] border border-white/10 text-gray-300 hover:text-white hover:bg-[#333] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm font-medium"
                >
                  <FaStepBackward className="text-xs" /> Previous
                </button>
                <span className="text-xs text-gray-500 font-medium hidden sm:block">
                  S{String(playingSeason).padStart(2, '0')}E{String(playingEpisode).padStart(2, '0')}
                </span>
                <button
                  onClick={() => jumpEpisode(1)}
                  disabled={activeEpisodeIndex < 0 || activeEpisodeIndex >= sortedEpisodes.length - 1}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-[#242424] border border-white/10 text-gray-300 hover:text-white hover:bg-[#333] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm font-medium"
                >
                  Next <FaStepForward className="text-xs" />
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'details' && (
          <div className="pb-12 space-y-4">
            {cast.length > 0 && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Cast:</span>{' '}
                <span className="text-white">{cast.slice(0, 5).map(c => c.name).join(', ')}</span>
              </p>
            )}
            {genres.length > 0 && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Genres:</span>{' '}
                <span className="text-white">{genres.join(', ')}</span>
              </p>
            )}
            {tv.countryName && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Country:</span>{' '}
                <span className="text-white">{tv.countryName}</span>
              </p>
            )}
            {tv.language && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Language:</span>{' '}
                <span className="text-white">{tv.language}</span>
              </p>
            )}
            {year && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Release:</span>{' '}
                <span className="text-white">{tv.releaseDate || year}</span>
              </p>
            )}
          </div>
        )}

        {activeTab === 'cast' && cast.length > 0 && (
          <div className="pb-12">
            <CastRow cast={cast} />
          </div>
        )}

        {activeTab === 'more' && (
          <div className="pb-12">
            <div className="py-10 text-center">
              <p className="text-gray-500 text-sm">Similar titles will appear here as you browse more content.</p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 md:px-8 lg:px-12 mb-12 max-w-5xl">
        <div className="flex items-start gap-3 bg-[#242424] rounded-md p-4">
          <FaInfoCircle className="text-gray-400 text-base shrink-0 mt-0.5" />
          <p className="text-gray-400 text-xs leading-relaxed">
            Select a season and episode, then click <strong className="text-gray-300">Play</strong> to start. For the best experience, use{" "}
            <a href="https://ublockorigin.com" target="_blank" rel="noopener noreferrer" className="text-white font-medium underline underline-offset-2 hover:text-gray-300 transition-colors">
              uBlock Origin
            </a>.
          </p>
        </div>
      </div>

      <footer className="border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <span className="text-white font-black text-base">We<span className="text-red-500">Flix</span></span>
            <span className="mx-2 opacity-50">|</span>
            <span>Developed by <span className="text-gray-300 font-medium">kaif</span></span>
          </div>
          <span>&copy; {new Date().getFullYear()} PopCorn TV</span>
        </div>
      </footer>

      {showPlayer && (
        <SmartPlayer
          subjectId={tv.subjectId}
          type="tv"
          season={playingSeason ?? 1}
          episode={playingEpisode ?? 1}
          title={playingSeason !== null ? `${tv.title} S${playingSeason}E${playingEpisode}` : tv.title}
          year={year}
          onClose={() => setShowPlayer(false)}
          onNextEpisode={() => jumpEpisode(1)}
        />
      )}

      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  );
};

TvDetails.propTypes = {
  tvId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default memo(TvDetails);
