import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db, firebaseEnabled } from '../firebase';

const STORAGE_KEY = (uid) => `wf_watchlist_${uid}`;
const GUEST_STORAGE_KEY = 'wf_watchlist_guest';

const WatchlistContext = createContext(null);

const getCachedAuthUser = () => {
  try { return JSON.parse(localStorage.getItem('weflix_user')) ?? null; } catch { return null; }
};

const loadGuestWatchlist = () => {
  try {
    const stored = localStorage.getItem(GUEST_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return { ids: [], items: [] };
};

const saveGuestWatchlist = (ids, items) => {
  try {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ ids: [...ids], items }));
  } catch { /* quota exceeded */ }
};

export function WatchlistProvider({ children }) {
  const [user, setUser] = useState(() => firebaseEnabled ? getCachedAuthUser() : null);
  const [watchlistIds, setWatchlistIds] = useState(() => {
    if (!firebaseEnabled) {
      return new Set(loadGuestWatchlist().ids);
    }
    const cached = getCachedAuthUser();
    if (!cached) return new Set();
    try {
      const stored = localStorage.getItem(STORAGE_KEY(cached.uid));
      if (stored) return new Set(JSON.parse(stored).ids || []);
    } catch { /* ignore */ }
    return new Set();
  });
  const [watchlistItems, setWatchlistItems] = useState(() => {
    if (!firebaseEnabled) {
      return loadGuestWatchlist().items;
    }
    const cached = getCachedAuthUser();
    if (!cached) return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY(cached.uid));
      if (stored) return JSON.parse(stored).items || [];
    } catch { /* ignore */ }
    return [];
  });
  const [ready, setReady] = useState(() => {
    if (!firebaseEnabled) return true;
    const cached = getCachedAuthUser();
    if (!cached) return false;
    try {
      return !!localStorage.getItem(STORAGE_KEY(cached.uid));
    } catch { return false; }
  });

  useEffect(() => {
    if (!firebaseEnabled || !auth) {
      setReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setWatchlistIds(new Set());
        setWatchlistItems([]);
        setReady(true);
        return;
      }

      try {
        const cached = localStorage.getItem(STORAGE_KEY(u.uid));
        if (cached) {
          const { ids, items } = JSON.parse(cached);
          setWatchlistIds(new Set(ids));
          setWatchlistItems(items || []);
          setReady(true);
        }
      } catch { /* ignore malformed cache */ }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !db || !user) return;

    const ref = collection(db, 'users', user.uid, 'watchlist');
    const unsub = onSnapshot(ref, (snapshot) => {
      const ids = new Set();
      const items = [];
      snapshot.forEach((d) => {
        ids.add(String(d.data().mediaId));
        items.push({ id: d.id, ...d.data() });
      });

      const sorted = items.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
      setWatchlistIds(ids);
      setWatchlistItems(sorted);
      setReady(true);

      try {
        localStorage.setItem(STORAGE_KEY(user.uid), JSON.stringify({ ids: [...ids], items: sorted }));
      } catch { /* quota exceeded — ignore */ }
    });

    return () => unsub();
  }, [user]);

  const toggleWatchlist = useCallback(async (item, onNeedAuth) => {
    if (firebaseEnabled && !user) {
      onNeedAuth?.();
      return;
    }

    const id = String(item.mediaId);
    const wasIn = watchlistIds.has(id);
    const toast = (typeof window !== 'undefined' && window.__toast) || null;

    if (!firebaseEnabled || !db) {
      const newIds = new Set(watchlistIds);
      let newItems = [...watchlistItems];
      if (newIds.has(id)) {
        newIds.delete(id);
        newItems = newItems.filter((i) => String(i.mediaId) !== id);
      } else {
        newIds.add(id);
        newItems.unshift({ ...item, addedAt: new Date().toISOString() });
      }
      setWatchlistIds(newIds);
      setWatchlistItems(newItems);
      saveGuestWatchlist(newIds, newItems);
      toast?.success(wasIn ? `Removed "${item.title}" from your list` : `Added "${item.title}" to your list`);
      return;
    }

    try {
      const ref = doc(db, 'users', user.uid, 'watchlist', id);
      if (wasIn) {
        await deleteDoc(ref);
        toast?.success(`Removed "${item.title}" from your list`);
      } else {
        await setDoc(ref, { ...item, addedAt: new Date().toISOString() });
        toast?.success(`Added "${item.title}" to your list`);
      }
    } catch (err) {
      console.error('Watchlist update failed', err);
      toast?.error('Could not update your list. Please try again.');
    }
  }, [user, watchlistIds, watchlistItems]);

  return (
    <WatchlistContext.Provider value={{ watchlistIds, watchlistItems, toggleWatchlist, ready, user, isGuestMode: !firebaseEnabled }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlist must be used inside WatchlistProvider');
  return ctx;
}
