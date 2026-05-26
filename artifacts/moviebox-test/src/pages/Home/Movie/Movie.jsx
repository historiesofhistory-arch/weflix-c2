import { useLocation, useNavigate } from 'react-router-dom';
import { toDetailPath } from '../urlUtils';
import ContentGrid from '../ContentGrid';
import { BiMoviePlay } from 'react-icons/bi';
import SEO from '../SEO';

function Movie() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleSelect = (item) => {
    const mediaType = item.subjectType !== 1 ? 'tv' : 'movie';
    navigate(toDetailPath(mediaType, item.subjectId, item.title), {
      state: { from: location.pathname + location.search },
    });
  };

  return (
    <div className="flex flex-col min-h-screen">
      <SEO
        title="Movies — PopCorn TV"
        description="Browse and stream movies free on PopCorn TV."
      />
      <div className="sticky top-0 z-40 backdrop-blur-md bg-[#0b0f18]/80 border-b border-white/[0.06]">
        <div className="px-4 sm:px-6 pt-4 pb-3">
          <div className="flex items-center gap-3.5">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.08] shadow-sm">
              <BiMoviePlay className="text-red-500 text-xl" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-none">
                Movies
              </h1>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="px-2 py-0.5 rounded shadow-sm bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] font-bold tracking-wider uppercase leading-none">
                  Trending
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-grow px-4 sm:px-6 pt-4">
        <ContentGrid
          type="movie"
          onSelect={handleSelect}
          onReset={() => navigate('/movies')}
        />
      </main>
    </div>
  );
}

export default Movie;
