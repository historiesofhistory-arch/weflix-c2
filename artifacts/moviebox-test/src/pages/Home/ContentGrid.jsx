import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import ContentCard from './ContentCard';
import { fetchMbSearch, mbCoverUrl } from './Fetcher';
import { BiWifi } from 'react-icons/bi';
import Skeleton from '../../components/Skeleton';

const ErrorWarning = () => (
  <div className="flex flex-col items-center justify-center gap-3 py-16">
    <BiWifi className="text-red-400 w-10 h-10" />
    <p className="text-gray-400 text-sm font-medium">Connection error — check your network</p>
  </div>
);

const EmptyState = ({ onReset }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
    <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.1] flex items-center justify-center text-xl">
      <span className="text-gray-300">?</span>
    </div>
    <h3 className="text-white font-bold text-lg">No results found</h3>
    <p className="text-gray-500 text-sm max-w-md">Try a different search term.</p>
    {onReset && (
      <button
        onClick={onReset}
        className="mt-1 inline-flex items-center rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors"
      >
        Reset
      </button>
    )}
  </div>
);

EmptyState.propTypes = {
  onReset: PropTypes.func,
};

const ContentGrid = ({ type, onSelect, onReset }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const query = type === 'tv' ? 'series' : 'movie';
    fetchMbSearch(query, 1)
      .then(data => {
        if (cancelled) return;
        setItems((data.items || []).map(item => ({
          subjectId: String(item.subjectId),
          title: item.title || '',
          cover: item.cover?.url || '',
          rating: item.imdbRatingValue || '',
          releaseDate: item.releaseDate || '',
          subjectType: item.subjectType,
        })).filter(item => item.cover));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [type]);

  if (error) return <ErrorWarning />;
  if (!loading && items.length === 0) return <EmptyState onReset={onReset} />;

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-4">
      {loading && items.length === 0
        ? Array.from({ length: 14 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full" rounded="rounded-xl" />
          ))
        : items.map((item) => {
            const mediaType = item.subjectType !== 1 ? 'tv' : 'movie';
            return (
              <ContentCard
                key={item.subjectId}
                title={item.title}
                poster={mbCoverUrl(item.cover, 300)}
                rating={item.rating ? parseFloat(item.rating) : null}
                releaseDate={item.releaseDate}
                onClick={() => onSelect(item, mediaType)}
                mediaId={item.subjectId}
                mediaType={mediaType}
              />
            );
          })}
    </div>
  );
};

ContentGrid.propTypes = {
  type: PropTypes.string,
  onSelect: PropTypes.func,
  onReset: PropTypes.func,
};

export default ContentGrid;
