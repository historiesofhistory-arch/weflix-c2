import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BiHomeAlt, BiMoviePlay, BiTv, BiSearch, BiBookmark } from 'react-icons/bi';
import { FaUserCircle, FaSignOutAlt } from 'react-icons/fa';
import { motion, LayoutGroup } from 'framer-motion';
import Sidebar from './Sidebar';
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, firebaseEnabled } from "../../firebase";
import AuthModal from "../../components/AuthModal";
import ScrollToTopButton from "../../components/ScrollToTopButton";
// View-transitions wiring (Task #115) was reverted — see ContentCard for context.


function ParentComponent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleOpenAuthModal = () => setIsAuthModalOpen(true);
    window.addEventListener('openAuthModal', handleOpenAuthModal);
    return () => window.removeEventListener('openAuthModal', handleOpenAuthModal);
  }, []);

  const handleLogout = async () => {
    if (!firebaseEnabled || !auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const activePage =
    location.pathname === '/'                  ? 'home'
    : location.pathname.startsWith('/movies')  ? 'movies'
    : location.pathname.startsWith('/series')  ? 'series'
    : location.pathname.startsWith('/search')  ? 'search'
    : location.pathname.startsWith('/watchlist') ? 'watchlist'
    : location.pathname.startsWith('/movie/')  ? 'movies'
    : location.pathname.startsWith('/tv/')     ? 'series'
    : 'home';

  const selectedGenreId = null;

  const handleNavigation = (page) => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    const go = () => {
      if (page === 'home')        navigate('/');
      else if (page === 'movies') navigate('/movies');
      else if (page === 'series') navigate('/series');
      else                        navigate(`/${page}`);
    };
    go();
  };

  const handleGenreSelect = () => {};

  return (
    <div className="min-h-screen relative text-white">
      <Sidebar
        activePage={activePage}
        onNavigate={handleNavigation}
        selectedGenreId={selectedGenreId}
        onGenreSelect={handleGenreSelect}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <ScrollToTopButton showAfter={300} />

      {/* Page content. Note: AnimatePresence + motion.div was previously
          wrapped here for cross-route fade transitions, but it interfered
          with touch on mobile (the wrapper applied transient styles during
          its 180ms exit phase that could swallow swipes if the user
          touched right after a route change). Reverted to plain Outlet. */}
      <div className="md:pl-[84px] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />

        {/* Footer — home page only */}
        {location.pathname === '/' && <footer className="bg-[#0a0c12]">
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-gray-600">
            <div className="flex items-center gap-3">
              <span className="text-white font-black text-sm">PopCorn <span className="text-red-500">TV</span></span>
              <span>·</span>
              <span>Developed by <span className="text-gray-400 font-semibold">kaif</span></span>
            </div>
            <div className="flex items-center gap-3">
              <span>© {new Date().getFullYear()} PopCorn TV</span>
              <span>·</span>
              <span>by kaif</span>
            </div>
          </div>
        </footer>}
      </div>

      {/* Mobile bottom navigation — translucent frosted-glass like iOS tab bar.
          backdrop-blur is GPU-cheap because the nav is a small fixed element. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#070b14]/80 backdrop-blur-xl backdrop-saturate-150 border-t border-white/[0.06] flex items-center justify-around px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.45rem)]">
        <LayoutGroup id="bottom-nav">
        {[
          { id: 'home',   icon: BiHomeAlt,   label: 'Home'    },
          { id: 'movies', icon: BiMoviePlay, label: 'Movies'  },
          { id: 'series', icon: BiTv,        label: 'TV'      },
          { id: 'search', icon: BiSearch,    label: 'Search'  },
          { id: 'watchlist', icon: BiBookmark, label: 'Watchlist' },
        ].map(({ id, icon: Icon, label }) => {
          const isActive = activePage === id;
          return (
            <motion.button
              key={id}
              onClick={() => handleNavigation(id)}
              whileTap={{ scale: 0.85 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-red-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-pill"
                  className="absolute inset-0 rounded-xl bg-red-500/10"
                  transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                />
              )}
              <motion.span
                animate={isActive ? { scale: [1, 1.18, 1] } : { scale: 1 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
                className="relative"
              >
                <Icon className="text-2xl" />
              </motion.span>
              <span className="relative text-[10px] font-medium">{label}</span>
            </motion.button>
          );
        })}
        </LayoutGroup>
        {firebaseEnabled && (
          user ? (
            <button
              onClick={handleLogout}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors text-red-500/80 hover:text-red-400"
            >
              <FaSignOutAlt className="text-2xl" />
              <span className="text-[10px] font-medium font-bold uppercase tracking-wider">Log Out</span>
            </button>
          ) : (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors text-gray-500 hover:text-gray-300"
            >
              <FaUserCircle className="text-2xl" />
              <span className="text-[10px] font-medium">Log In</span>
            </button>
          )
        )}
      </nav>

      {firebaseEnabled && (
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
      )}
    </div>
  );
}

export default ParentComponent;
