import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toDetailPath } from './urlUtils';
import HeroBanner from './HeroBanner';
import TrendingRow from './TrendingRow';
import ContinueWatchingRow from './ContinueWatchingRow';
import SEO from './SEO';
import { fetchHome, normalizeHomeSection } from './Fetcher';
import Skeleton from '../../components/Skeleton';
import { useProgressWhile } from '../../context/ProgressContext';

// Home page is intentionally short — top trending + a couple of featured
// rows. The previous long genre browse list was removed per user feedback
// (too much scrolling, hurt smoothness on low-end devices). Genre browse
// still lives on the dedicated /search and /genre pages.
const MAX_HOME_ROWS = 3;

const RowSkeleton = () => (
  <section className="mb-10">
    <div className="flex items-center gap-3 px-4 sm:px-6 mb-5">
      <Skeleton width={96} height={20} />
    </div>
    <div className="flex gap-2.5 px-4 sm:px-6 overflow-hidden">
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

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sections, setSections] = useState([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);

  useProgressWhile(sectionsLoading);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchHome();
        if (cancelled) return;
        const rawSections = data?.data?.operatingList || data?.data?.items || data?.data?.sections || data?.data?.list || data?.items || data?.sections || [];
        const parsed = rawSections
          .filter((sec) => {
            const items = sec.subjects || sec.items || sec.list || [];
            return items.length > 0;
          })
          .map((sec) => ({
            title: sec.title || sec.name || 'Featured',
            items: normalizeHomeSection(sec),
          }))
          .filter((s) => s.items.length > 0)
          .slice(0, MAX_HOME_ROWS);
        setSections(parsed);
      } catch { /* ignore */ }
      finally { if (!cancelled) setSectionsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = (item) => {
    const mediaType = item.subjectType !== 1 ? 'tv' : 'movie';
    const pathname = toDetailPath(mediaType, item.subjectId, item.title);
    navigate(
      { pathname },
      { state: { from: location.pathname + location.search } }
    );
  };

  const handleContinueSelect = useCallback((item, mediaType) => {
    const pathname = toDetailPath(mediaType, item.id, item.title);
    navigate(
      { pathname, search: item.season ? `?season=${item.season}&episode=${item.episode || 1}` : '' },
      { state: { from: location.pathname + location.search } }
    );
  }, [navigate, location]);

  const goSearch = () => navigate('/search');

  const ACCENT_COLORS = ['#ef4444', '#8b5cf6', '#f59e0b', '#10b981', '#3b82f6', '#f97316', '#ec4899', '#14b8a6', '#a855f7', '#f43f5e'];

  return (
    <div className="bg-[#0a0c12] min-h-screen">
      <SEO
        title="PopCorn TV — Stream Movies & TV Shows"
        description="Watch trending movies and TV shows for free. Browse by genre, discover new releases, and stream instantly on PopCorn TV."
        noSuffix
      />
      <HeroBanner />

      <div className="pt-10 pb-8">
        <ContinueWatchingRow onSelect={handleContinueSelect} />

        {sections.map((sec, idx) => (
          <TrendingRow
            key={`home-${idx}`}
            title={sec.title}
            items={sec.items}
            showRank={idx === 0}
            accent={ACCENT_COLORS[idx % ACCENT_COLORS.length]}
            onSelect={handleSelect}
            onSeeAll={goSearch}
            priorityRow={idx === 0}
          />
        ))}

        {sectionsLoading && sections.length === 0 && (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}
      </div>
    </div>
  );
}
