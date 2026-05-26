import React, { useState, memo, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { FaPlay, FaStar, FaPlus, FaCheck, FaTrash } from 'react-icons/fa';
import { useWatchlist } from '../../context/WatchlistContext';
import Skeleton from '../../components/Skeleton';

const ContentCard = memo(({
  title,
  poster,
  rating,
  onClick = () => {},
  className = '',
  placeholderImage = '/placeholder.svg',
  releaseDate,
  mediaId,
  mediaType,
  posterPath,
  voteAverage,
  onNeedAuth,
  isWatchlistPage = false,
  priority = false,
}) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [wlLoading, setWlLoading] = useState(false);
  const imgRef = useRef(null);

  // The shared-element view-transition that morphed the poster into the
  // detail-page hero (Task #115) was reverted because it appeared to
  // interfere with vertical scroll on the carousel rows on touch devices
  // (the always-on `view-transition-name` style + claim/subscribe state
  // created a stacking context per card that swallowed touches). Card
  // taps now do a plain navigation.
  const handleCardClick = useCallback(() => {
    if (onClick) onClick();
  }, [onClick]);

  const { watchlistIds, toggleWatchlist, ready, user, isGuestMode } = useWatchlist();
  const inWatchlist = ready && !!mediaId && watchlistIds.has(String(mediaId));

  const handleWatchlist = useCallback(async (e) => {
    e.stopPropagation();
    if (!user && !isGuestMode) {
      if (onNeedAuth) onNeedAuth();
      else window.dispatchEvent(new Event('openAuthModal'));
      return;
    }
    if (!mediaId) return;
    setWlLoading(true);
    try {
      await toggleWatchlist({
        mediaId,
        type: mediaType || 'movie',
        title,
        poster_path: posterPath || poster || null,
        vote_average: voteAverage || rating || 0,
        release_date: releaseDate || null,
      }, onNeedAuth);
    } finally {
      setWlLoading(false);
    }
  }, [user, isGuestMode, mediaId, mediaType, title, posterPath, poster, voteAverage, rating, releaseDate, onNeedAuth, toggleWatchlist]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  }, [handleCardClick]);

  const src = imageError ? placeholderImage : poster;
  const year = releaseDate ? (typeof releaseDate === 'string' && releaseDate.length >= 4 ? releaseDate.slice(0, 4) : new Date(releaseDate).getFullYear()) : null;
  const ratingNum = rating ? Math.round(rating * 10) : null;
  const ratingColor = rating >= 7 ? 'text-green-400' : rating >= 5 ? 'text-yellow-400' : 'text-red-400';
  const showWatchlistBtn = !!mediaId;

  return (
    <div
      className={`pcw-card group relative w-full cursor-pointer z-10 ${className}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyPress={handleKeyPress}
      aria-label={`${title}${year ? ` (${year})` : ''}`}
    >
      <div className="w-full rounded-xl overflow-hidden ring-1 ring-white/5 group-hover:ring-white/20 group-hover:shadow-2xl group-hover:shadow-black/60 relative flex flex-col z-20 bg-[#0d1117] transition-shadow duration-200">
        <div className="relative w-full aspect-[2/3] bg-[#1a1f2b] overflow-hidden">
          {!imageLoaded && (
            <Skeleton className="absolute inset-0" rounded="rounded-none" />
          )}
          <img
            ref={imgRef}
            src={src}
            alt={title}
            width={300}
            height={450}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            draggable={false}
            className={`w-full h-full object-cover ${imageLoaded ? 'poster-fade-in' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => { setImageError(true); setImageLoaded(true); }}
          />

          <div className="absolute bottom-0 inset-x-0 h-1/2 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

          {ratingNum && (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm text-[11px] font-bold px-1.5 py-0.5 rounded-md">
              <FaStar className={`text-[9px] ${ratingColor}`} />
              <span className={ratingColor}>{ratingNum}%</span>
            </div>
          )}

          {mediaType && (
            <div className="absolute top-2 left-2 bg-red-600 text-white text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm pointer-events-none">
              {mediaType === 'tv' ? 'SERIES' : 'MOVIE'}
            </div>
          )}

          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-red-600 shadow-lg shadow-red-700/50 flex items-center justify-center transform scale-75 group-hover:scale-100 transition-transform duration-200">
              <FaPlay className="text-white text-sm ml-0.5" />
            </div>
            {showWatchlistBtn && (
              <button
                onClick={handleWatchlist}
                title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transform scale-75 group-hover:scale-100 transition-all duration-200 shadow-lg ${
                  inWatchlist
                    ? (isWatchlistPage ? 'bg-black/60 hover:bg-red-600/90 border border-white/20 hover:border-red-500' : 'bg-red-600 shadow-red-700/50')
                    : 'bg-white/25 backdrop-blur-sm border border-white/30 hover:bg-white/35'
                }`}
              >
                {inWatchlist
                  ? (isWatchlistPage ? <FaTrash className="text-white text-sm" /> : <FaCheck className="text-white text-sm" />)
                  : <FaPlus className="text-white text-sm" />
                }
              </button>
            )}
          </div>
        </div>

        <div className="px-2.5 pt-2 pb-2.5 shrink-0 bg-[#0d1117] relative z-20">
          <p className="text-white text-[13px] font-semibold leading-tight line-clamp-1">{title}</p>
          {(year || mediaType) && (
            <p className="text-gray-500 text-[11px] mt-0.5">
              {year}{year && mediaType && ' \u00b7 '}{mediaType === 'tv' ? 'TV Show' : mediaType === 'movie' ? 'Movie' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

ContentCard.propTypes = {
  title: PropTypes.string.isRequired,
  poster: PropTypes.string,
  rating: PropTypes.number,
  onClick: PropTypes.func,
  className: PropTypes.string,
  placeholderImage: PropTypes.string,
  releaseDate: PropTypes.string,
  mediaId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  mediaType: PropTypes.oneOf(['movie', 'tv']),
  posterPath: PropTypes.string,
  voteAverage: PropTypes.number,
  onNeedAuth: PropTypes.func,
  isWatchlistPage: PropTypes.bool,
  priority: PropTypes.bool,
};

ContentCard.displayName = 'ContentCard';
export default ContentCard;
