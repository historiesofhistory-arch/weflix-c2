import { useState, useEffect, useRef, useCallback } from 'react';
import { BiChevronLeft, BiChevronRight } from 'react-icons/bi';
import { FiArrowRight } from 'react-icons/fi';
import ContentCard from './ContentCard';
import Skeleton from '../../components/Skeleton';
import { mbCoverUrl } from './Fetcher';

function useRow(items) {
  const [loading, setLoading] = useState(!items || items.length === 0);

  useEffect(() => {
    setLoading(!items || items.length === 0);
  }, [items]);

  return { items: items || [], loading };
}

export default function TrendingRow({
  title,
  items: propItems = [],
  showRank = false,
  onSelect,
  onSeeAll,
  accent,
  priorityRow = false,
}) {
  const { items, loading } = useRow(propItems);
  const rowRef = useRef(null);
  const dragStateRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const suppressClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const scroll = (dir) => {
    const el = rowRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 580, behavior: 'smooth' });
  };

  const onRowMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const el = rowRef.current;
    if (!el) return;
    dragStateRef.current = {
      active: true,
      startX: e.pageX,
      startScrollLeft: el.scrollLeft,
      moved: false,
    };
    setIsDragging(true);
  }, []);

  const onRowMouseMove = useCallback((e) => {
    const el = rowRef.current;
    const drag = dragStateRef.current;
    if (!el || !drag.active) return;
    const delta = e.pageX - drag.startX;
    if (Math.abs(delta) > 4) drag.moved = true;
    el.scrollLeft = drag.startScrollLeft - delta;
  }, []);

  const endRowDrag = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag.active) return;
    drag.active = false;
    suppressClickRef.current = drag.moved;
    setIsDragging(false);
    setTimeout(() => { suppressClickRef.current = false; }, 0);
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', endRowDrag);
    return () => window.removeEventListener('mouseup', endRowDrag);
  }, [endRowDrag]);

  if (loading) {
    return (
      <section className="mb-10">
        <div className="flex items-center gap-3 px-4 sm:px-6 mb-5">
          <Skeleton width={96} height={20} />
        </div>
        <div className="flex gap-2 px-4 sm:px-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton
              key={i}
              className="shrink-0 w-[130px] md:w-[150px] h-[195px] md:h-[225px]"
              rounded="rounded-xl"
            />
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section
      className={`mb-10 group/row ${priorityRow ? '' : 'row-deferred'}`}
      style={{ overflow: 'visible' }}
    >
      <div className="flex items-center justify-between px-4 sm:px-6 mb-4">
        <div className="flex items-center gap-3">
          {accent && (
            <div className="w-1 h-5 rounded-full" style={{ background: accent }} />
          )}
          <h2 className="text-white font-bold text-[15px] md:text-lg tracking-tight">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {onSeeAll && (
            <button
              onClick={onSeeAll}
              className="flex items-center gap-1 text-gray-500 hover:text-red-400 text-xs font-semibold uppercase tracking-wider transition-colors duration-200 mr-1"
            >
              See All <FiArrowRight className="text-sm" />
            </button>
          )}
          <div className="flex items-center gap-1 opacity-40 group-hover/row:opacity-100 transition-opacity duration-200">
            <button
              onClick={() => scroll(-1)}
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            >
              <BiChevronLeft className="text-xl" />
            </button>
            <button
              onClick={() => scroll(1)}
              className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/20 flex items-center justify-center text-white transition-colors"
            >
              <BiChevronRight className="text-xl" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={rowRef}
        onMouseDown={onRowMouseDown}
        onMouseMove={onRowMouseMove}
        onMouseLeave={endRowDrag}
        className={`flex gap-2 overflow-x-auto hide-scrollbar px-4 sm:px-6 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ paddingTop: 20, paddingBottom: 20, marginTop: -12, marginBottom: -12 }}
      >
        {items.map((item, index) => {
          const mediaType = item.subjectType !== 1 ? 'tv' : 'movie';
          return (
            <div
              key={item.subjectId}
              className={`shrink-0 relative self-start ${showRank ? 'pt-6 pl-2' : ''}`}
              style={{ width: showRank ? 165 : 135, minHeight: showRank ? 285 : 250 }}
            >
              {showRank && (
                <span
                  className="absolute top-0 left-0 z-20 font-black select-none pointer-events-none"
                  style={{
                    fontSize: 64,
                    lineHeight: 1,
                    color: 'rgba(255,255,255,0.08)',
                    WebkitTextStroke: '2px rgba(255,255,255,0.70)',
                    textShadow: '0 4px 18px rgba(0,0,0,0.9), 0 1px 0 rgba(0,0,0,0.6)',
                    letterSpacing: '-2px',
                  }}
                >
                  {index + 1}
                </span>
              )}
              <ContentCard
                title={item.title}
                poster={mbCoverUrl(item.cover, 300)}
                rating={item.rating ? parseFloat(item.rating) : null}
                releaseDate={(item.releaseDate || '').slice(0, 4)}
                mediaId={item.subjectId}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  onSelect(item, mediaType);
                }}
                mediaType={mediaType}
                priority={priorityRow && index < 5}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
