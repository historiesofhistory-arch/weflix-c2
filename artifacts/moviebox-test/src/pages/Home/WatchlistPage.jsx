import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useWatchlist } from '../../context/WatchlistContext';
import ContentCard from './ContentCard';
import SEO from './SEO';
import { toDetailPath } from './urlUtils';
import { FaBookmark } from 'react-icons/fa';
import { BiMoviePlay, BiTv } from 'react-icons/bi';

const GRID_CLASSES = 'grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-4 mt-4';
const IMAGE_BASE_URL = '';

function WatchlistPage() {
  const navigate = useNavigate();
  const { user, watchlistItems: items, ready, isGuestMode } = useWatchlist();
  const loading = !ready;

  return (
    <div className="min-h-screen bg-black text-white px-4 sm:px-8 pt-6 sm:pt-10 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-16">
      <SEO title="My Watchlist - PopCorn TV" description="View your saved movies and TV shows." />

      <div className="flex items-center gap-3 mb-6">
        <span className="w-1.5 h-8 bg-red-600 rounded-full inline-block shadow-[0_0_10px_rgba(220,38,38,0.5)]" />
        <h1 className="text-3xl font-bold tracking-tight">My Watchlist</h1>
      </div>

      {/* Not logged in */}
      {!loading && !user && !isGuestMode && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="max-w-md w-full mx-auto px-6 text-center">
            <div className="flex justify-center mb-8">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-red-600/10 border border-red-500/20 flex items-center justify-center">
                  <FaBookmark className="text-red-500 text-xl" />
                </div>
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-600 border-2 border-black" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-white mb-3 tracking-tight">Sign in to use Watchlist</h2>
            <p className="text-gray-500 text-sm leading-relaxed mb-8">
              Keep track of everything you want to watch. Your list saves across all your devices.
            </p>
            <button
              onClick={() => document.querySelector('[title="Log In"]')?.click()}
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors shadow-lg shadow-red-600/20"
            >
              Sign in
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {(user || isGuestMode) && loading && (
        <div className="flex justify-center items-center min-h-[60vh]">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Empty watchlist */}
      {(user || isGuestMode) && !loading && items.length === 0 && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="max-w-lg w-full mx-auto px-6">
            {/* Horizontal rule with label */}
            <div className="flex items-center gap-4 mb-10">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-red-600/30" />
              <FaBookmark className="text-red-600/60 text-[10px]" />
              <div className="flex-1 h-px bg-gradient-to-l from-transparent to-red-600/30" />
            </div>

            <div className="text-center mb-10">
              <h2 className="text-2xl font-bold text-white mb-3 tracking-tight">Your list is empty</h2>
              <p className="text-gray-500 text-[15px] leading-relaxed max-w-sm mx-auto">
                Browse movies and TV shows, then hit{' '}
                <span className="text-red-400 inline-flex items-center gap-1">
                  <FaBookmark className="text-[11px]" /> Add to Watchlist
                </span>{' '}
                to save them here.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => navigate('/movies')}
                className="group flex items-center justify-center gap-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-200 text-sm shadow-lg shadow-red-600/20"
              >
                <BiMoviePlay className="text-base" />
                Movies
              </button>
              <button
                onClick={() => navigate('/series')}
                className="group flex items-center justify-center gap-2.5 border border-white/10 hover:border-red-500/30 bg-white/[0.03] hover:bg-red-500/5 text-gray-300 hover:text-white font-medium px-6 py-3 rounded-lg transition-all duration-200 text-sm"
              >
                <BiTv className="text-base text-gray-400 group-hover:text-red-400 transition-colors" />
                TV Shows
              </button>
            </div>

            {/* Bottom rule */}
            <div className="mt-10 h-px bg-gradient-to-r from-transparent via-red-600/20 to-transparent" />
          </div>
        </div>
      )}

      {(user || isGuestMode) && items.length > 0 && (
        <div className={GRID_CLASSES}>
          {items.map((item) => (
            <ContentCard
              key={item.id}
              title={item.title}
              poster={item.poster_path || '/placeholder.svg'}
              rating={item.vote_average}
              releaseDate={item.release_date || item.addedAt}
              onClick={() => {
                navigate(toDetailPath(item.type, item.mediaId, item.title), { state: { from: '/watchlist' } });
              }}
              mediaId={item.mediaId}
              mediaType={item.type}
              posterPath={item.poster_path}
              voteAverage={item.vote_average}
              isWatchlistPage={true}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default WatchlistPage;
