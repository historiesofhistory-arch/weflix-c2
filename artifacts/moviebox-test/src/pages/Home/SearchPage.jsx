import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toDetailPath } from './urlUtils';
import { FaSearch, FaTimes } from 'react-icons/fa';
import ContentCard from './ContentCard';
import SEO from './SEO';
import { fetchMbSearch, mbCoverUrl } from './Fetcher';
import { useProgressWhile } from '../../context/ProgressContext';

const GRID_CLASSES = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3 sm:gap-4 mt-4';
const DEBOUNCE_DELAY = 400;

const SkeletonGrid = ({ count = 14 }) => (
  <div className={GRID_CLASSES}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="aspect-[2/3] rounded-xl bg-white/5 animate-pulse" />
    ))}
  </div>
);

function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inputRef = useRef(null);
  const sentinelRef = useRef(null);

  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  useProgressWhile(isLoading);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const fetchControllerRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) {
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_DELAY);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const next = debouncedQuery.trim();
    const current = searchParams.get('q') || '';
    if (next === current) return;
    const params = new URLSearchParams(searchParams);
    if (next) params.set('q', next);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  }, [debouncedQuery, searchParams, setSearchParams]);

  const doSearch = useCallback(async (q, pageNum, append = false) => {
    if (!q.trim()) {
      setItems([]);
      setHasMore(false);
      setTotalCount(0);
      return;
    }

    if (fetchControllerRef.current) fetchControllerRef.current.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    setIsLoading(true);
    try {
      const data = await fetchMbSearch(q, pageNum);
      if (controller.signal.aborted) return;
      const newItems = (data.items || []).map(item => ({
        subjectId: String(item.subjectId),
        title: item.title || '',
        cover: item.cover?.url || '',
        rating: item.imdbRatingValue || '',
        releaseDate: item.releaseDate || '',
        subjectType: item.subjectType,
        description: item.description || '',
        genre: item.genre || '',
      })).filter(item => item.cover);
      if (append) {
        setItems(prev => {
          const seen = new Set(prev.map(i => i.subjectId));
          return [...prev, ...newItems.filter(i => !seen.has(i.subjectId))];
        });
      } else {
        setItems(newItems);
      }
      setHasMore(data.hasMore || false);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setItems(append ? prev => prev : []);
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    doSearch(debouncedQuery, 1, false);
  }, [debouncedQuery, doSearch]);

  useEffect(() => {
    if (!hasMore || isLoading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !isLoading) {
        const nextPage = page + 1;
        setPage(nextPage);
        doSearch(debouncedQuery, nextPage, true);
      }
    }, { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoading, page, debouncedQuery, doSearch]);

  const isSearching = debouncedQuery.trim().length > 0;
  const showInitialLoading = isLoading && items.length === 0;
  const showLoadingMore = isLoading && items.length > 0;

  return (
    <div className="min-h-screen bg-[#0a0c12] px-4 sm:px-6 pt-6 pb-20">
      <SEO
        title="Search Movies & TV Shows — PopCorn TV"
        description="Search for movies and TV shows to stream free on PopCorn TV."
      />

      <div className="relative max-w-2xl mx-auto mb-8">
        <FaSearch className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-500 text-lg" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search movies & TV shows..."
          className="w-full pl-14 pr-12 py-4 rounded-2xl bg-white/[0.06] border border-white/10 text-white text-base placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500/40 transition-all"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors p-1"
          >
            <FaTimes />
          </button>
        )}
      </div>

      {totalCount > 0 && isSearching && (
        <p className="text-gray-500 text-xs mb-4 text-center">
          {totalCount} result{totalCount !== 1 ? 's' : ''} for "{debouncedQuery}"
        </p>
      )}

      <section>
        {items.length === 0 && showInitialLoading && <SkeletonGrid />}

        {items.length === 0 && !showInitialLoading && isSearching && (
          <p className="text-gray-500 mt-8 text-sm text-center">No results found for "{debouncedQuery}"</p>
        )}

        {!isSearching && !isLoading && items.length === 0 && (
          <div className="mt-20 text-center">
            <FaSearch className="text-gray-700 text-5xl mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Start typing to search for movies and TV shows</p>
          </div>
        )}

        {items.length > 0 && (
          <div className={GRID_CLASSES}>
            {items.map((item, index) => {
              const mediaType = item.subjectType !== 1 ? 'tv' : 'movie';
              return (
                <ContentCard
                  key={`${item.subjectId}-${index}`}
                  title={item.title}
                  poster={mbCoverUrl(item.cover, 300)}
                  rating={item.rating ? parseFloat(item.rating) : null}
                  releaseDate={item.releaseDate}
                  onClick={() => {
                    const from = debouncedQuery.trim()
                      ? `/search?q=${encodeURIComponent(debouncedQuery.trim())}`
                      : '/search';
                    navigate(toDetailPath(mediaType, item.subjectId, item.title), { state: { from } });
                  }}
                  mediaId={item.subjectId}
                  mediaType={mediaType}
                />
              );
            })}
          </div>
        )}

        <div ref={sentinelRef} />

        {showLoadingMore && (
          <div className="flex justify-center py-8">
            <div className="w-9 h-9 border-[3px] border-red-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </section>
    </div>
  );
}

export default SearchPage;
