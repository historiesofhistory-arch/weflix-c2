import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ParentComponent from './pages/Home/ParentComponent';
import HomePage from './pages/Home/HomePage';
import { ProgressProvider, useProgress } from './context/ProgressContext';

const Movie = lazy(() => import('./pages/Home/Movie/Movie'));
const Series = lazy(() => import('./pages/Home/TV/Series'));
const SearchPage = lazy(() => import('./pages/Home/SearchPage'));
const MovieDetails = lazy(() => import('./pages/Home/Movie/MovieDetails'));
const TvDetails = lazy(() => import('./pages/Home/TV/TvDetails'));
const WatchlistPage = lazy(() => import('./pages/Home/WatchlistPage'));
const ResetPasswordPage = lazy(() => import('./pages/Home/ResetPasswordPage'));
const EmailVerificationPage = lazy(() => import('./pages/Home/EmailVerificationPage'));
const PersonPage = lazy(() => import('./pages/Home/Person/PersonPage'));
const AuthActionPage = lazy(() => import('./pages/Home/AuthActionPage'));

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

function ProgressLazyFallback() {
  const { start, finish } = useProgress();
  useEffect(() => {
    start();
    return () => finish();
  }, [start, finish]);
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<ProgressLazyFallback />}>
      <Routes>
        <Route element={<ParentComponent />}>
          <Route index element={<HomePage />} />
          <Route path="/movies" element={<Movie />} />
          <Route path="/movies/:genreSlug" element={<Movie />} />
          <Route path="/movies/:genreSlug/:sortSlug" element={<Movie />} />
          <Route path="/series" element={<Series />} />
          <Route path="/series/:genreSlug" element={<Series />} />
          <Route path="/series/:genreSlug/:sortSlug" element={<Series />} />
          <Route path="/movies/watch/:slug" element={<MovieDetails />} />
          <Route path="/series/watch/:slug" element={<TvDetails />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/person/:id/:slug" element={<PersonPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<EmailVerificationPage />} />
          <Route path="/auth-action" element={<AuthActionPage />} />
          <Route path="/movie/:slug" element={<MovieDetails />} />
          <Route path="/tv/:slug" element={<TvDetails />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <Router basename={basename}>
      <ProgressProvider>
        <AppRoutes />
      </ProgressProvider>
    </Router>
  );
}

export default App;
