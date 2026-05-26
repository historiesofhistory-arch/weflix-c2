import { doc, setDoc, deleteDoc, getDocs, collection, query, orderBy, limit } from 'firebase/firestore';
import { db, firebaseEnabled } from '../firebase';

const CW_CACHE_KEY = 'wf_cw_cache_items';
const CW_MAX_ITEMS = 20;

const getLocalCwItems = () => {
  try {
    return JSON.parse(localStorage.getItem(CW_CACHE_KEY) || '[]');
  } catch {
    return [];
  }
};

const setLocalCwItems = (items) => {
  try {
    localStorage.setItem(CW_CACHE_KEY, JSON.stringify(items));
  } catch { /* quota exceeded */ }
};

export const saveToContinueWatching = async (userUid, item) => {
  if (!item || !item.id) return;

  const entry = { ...item, updatedAt: Date.now() };

  if (!firebaseEnabled || !db) {
    const items = getLocalCwItems();
    const filtered = items.filter((i) => String(i.id) !== String(item.id));
    filtered.unshift(entry);
    setLocalCwItems(filtered.slice(0, CW_MAX_ITEMS));
    return;
  }

  if (!userUid) return;

  try {
    const ref = doc(db, 'users', userUid, 'continue_watching', String(item.id));
    await setDoc(ref, entry);

    const q = query(collection(db, 'users', userUid, 'continue_watching'), orderBy('updatedAt', 'desc'));
    const snaps = await getDocs(q);
    if (snaps.docs.length > CW_MAX_ITEMS) {
      const toDelete = snaps.docs.slice(CW_MAX_ITEMS);
      for (const d of toDelete) {
        await deleteDoc(d.ref);
      }
    }
  } catch (err) {
    console.error('Failed to save to continue watching in Firestore', err);
  }
};

export const removeFromContinueWatching = async (userUid, id) => {
  if (!id) return;

  if (!firebaseEnabled || !db) {
    const items = getLocalCwItems();
    setLocalCwItems(items.filter((i) => String(i.id) !== String(id)));
    return;
  }

  if (!userUid) return;
  try {
    const ref = doc(db, 'users', userUid, 'continue_watching', String(id));
    await deleteDoc(ref);
  } catch (err) {
    console.error('Failed to remove from continue watching', err);
  }
};
