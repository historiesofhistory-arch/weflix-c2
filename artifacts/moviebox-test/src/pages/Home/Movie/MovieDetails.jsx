import React, { useEffect, useLayoutEffect, useState, useCallback, memo } from "react";
import { flushSync } from "react-dom";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import PropTypes from "prop-types";
import { fetchMbDetail, mbCoverUrl } from "../Fetcher";
import { getIdFromDetailSlug, getTitleFromDetailSlug } from "../urlUtils";
import { saveToContinueWatching } from "../../../utils/continueWatching";
import {
  FaRedo,
  FaStar,
  FaArrowLeft,
  FaInfoCircle,
  FaBookmark,
  FaPlay,
  FaShareAlt,
  FaThumbsUp,
} from "react-icons/fa";
import { BiCalendar, BiTime } from "react-icons/bi";
import DetailPageSkeleton from "../reused/DetailPageSkeleton";
import CastRow from "../reused/CastRow";
import SmartPlayer, { enterFullscreenLandscape, preResolveStream } from "../SmartPlayer";
import SEO from "../SEO";
import AuthModal from "../../../components/AuthModal";
import { useWatchlist } from "../../../context/WatchlistContext";
import { useProgressWhile } from "../../../context/ProgressContext";
// View-transition wiring (Task #115) was reverted — see ContentCard for context.

const MovieDetails = ({ movieId: movieIdProp }) => {
  const { slug } = useParams();
  const location = useLocation();
  const movieId = movieIdProp ?? getIdFromDetailSlug(slug);
  const titleHint = slug ? getTitleFromDetailSlug(slug) : '';
  const navigate = useNavigate();
  const [movie, setMovie] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('details');

  useProgressWhile(loading);
  const { user, watchlistIds, toggleWatchlist: ctxToggleWatchlist } = useWatchlist();
  const inWatchlist = movie?.subjectId ? watchlistIds.has(String(movie.subjectId)) : false;

  useLayoutEffect(() => {
    setLoading(true);
    setError(null);
    setMovie(null);
    setShowOverview(false);
    setShowPlayer(false);
    setIsAuthModalOpen(false);
    setActiveTab('details');
  }, [movieId]);

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRetrying(true);
    try {
      const data = await fetchMbDetail(movieId, titleHint || undefined);
      setMovie(data);
    } catch {
      setError("Failed to load movie. Please try again.");
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [movieId, titleHint]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [movieId]);

  useEffect(() => {
    if (!movie?.subjectId) return;
    preResolveStream(movie.subjectId, "movie");
  }, [movie]);

  useEffect(() => {
    if (!movie) return;
    saveToContinueWatching(user?.uid, {
      id: movie.subjectId,
      mediaType: 'movie',
      title: movie.title,
      poster_path: movie.cover?.url || '',
      vote_average: parseFloat(movie.imdbRatingValue) || 0,
      release_date: movie.releaseDate,
    });
  }, [movie, user]);

  const toggleWatchlist = () => {
    if (!movie?.subjectId) return;
    ctxToggleWatchlist(
      {
        mediaId: movie.subjectId,
        type: 'movie',
        title: movie.title,
        poster_path: movie.cover?.url || '',
        vote_average: parseFloat(movie.imdbRatingValue) || 0,
        release_date: movie.releaseDate,
      },
      () => setIsAuthModalOpen(true)
    );
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: movie?.title, url: window.location.href });
    } catch {}
  };

  if (loading) return <DetailPageSkeleton type="movie" />;

  if (error) return (
    <div className="min-h-[60vh] flex items-center justify-center p-6 bg-[#141414]">
      <div className="bg-red-900/10 border border-red-700/30 rounded-lg p-8 max-w-sm w-full text-center">
        <p className="text-red-400 mb-6 font-medium">{error}</p>
        <button
          onClick={load}
          disabled={retrying}
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-md transition-all"
        >
          <FaRedo className={retrying ? "animate-spin" : ""} />
          {retrying ? "Retrying..." : "Retry"}
        </button>
      </div>
    </div>
  );

  if (!movie) return null;

  const year = (movie.releaseDate || '').slice(0, 4);
  const rating = movie.imdbRatingValue || null;
  const genres = movie.genre ? movie.genre.split(',').map(g => g.trim()).filter(Boolean).slice(0, 4) : [];
  const overview = movie.description || "";
  const truncated = overview.length > 280 && !showOverview
    ? overview.slice(0, 280) + "..."
    : overview;
  const coverUrl = mbCoverUrl(movie.cover, 1280) || '';
  const duration = movie.duration || '';
  const staffList = movie.staffList || [];
  const cast = staffList.filter(s => s.staffType === 2 || s.type === 'cast' || s.type === 'actor' || !s.type).slice(0, 20).map(s => ({
    name: s.name,
    character: s.character || '',
    avatar: s.avatarUrl ? { url: s.avatarUrl } : (s.avatar || null),
  }));
  const directors = staffList.filter(s => s.staffType === 1 || s.type === 'director').slice(0, 3);

  return (
    <div className="min-h-screen bg-[#141414] text-gray-200 selection:bg-red-500/30">
      <SEO
        title={`${movie.title}${year ? ` (${year})` : ''} — Watch Free on PopCorn TV`}
        description={overview ? `${overview.slice(0, 150).trim()}... Watch ${movie.title} free on PopCorn TV.` : `Watch ${movie.title} free on PopCorn TV.`}
        image={coverUrl}
        type="video.movie"
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
              {movie.title}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300 mb-4">
              {rating && (
                <span className="flex items-center gap-1 text-green-400 font-bold">
                  <FaStar className="text-xs" /> {rating}
                </span>
              )}
              {year && <span>{year}</span>}
              {duration && (
                <span className="flex items-center gap-1">
                  <BiTime className="text-sm" /> {duration}
                </span>
              )}
              {genres.length > 0 && (
                <span className="text-gray-400">{genres.join(' · ')}</span>
              )}
            </div>

            {overview && (
              <div className="mb-5">
                <p className="text-gray-300 text-sm md:text-base leading-relaxed max-w-2xl">{truncated}</p>
                {overview.length > 280 && (
                  <button
                    onClick={() => setShowOverview(p => !p)}
                    className="mt-2 text-white/70 hover:text-white text-xs font-medium transition-colors"
                  >
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
                className="flex items-center justify-center w-10 h-10 md:w-11 md:h-11 rounded-full border-2 border-gray-400 hover:border-white bg-black/40 hover:bg-black/60 text-white transition-all"
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

        {activeTab === 'details' && (
          <div className="pb-12 space-y-4">
            {directors.length > 0 && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Director:</span>{' '}
                <span className="text-white">{directors.map(d => d.name).join(', ')}</span>
              </p>
            )}
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
            {movie.countryName && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Country:</span>{' '}
                <span className="text-white">{movie.countryName}</span>
              </p>
            )}
            {movie.language && (
              <p className="text-sm text-gray-400">
                <span className="text-gray-500">Language:</span>{' '}
                <span className="text-white">{movie.language}</span>
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
            Click <strong className="text-gray-300">Play</strong> to start streaming. For the best experience, use{" "}
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
          subjectId={movie.subjectId}
          type="movie"
          title={movie.title}
          year={year}
          onClose={() => setShowPlayer(false)}
        />
      )}

      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  );
};

MovieDetails.propTypes = {
  movieId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default memo(MovieDetails);
