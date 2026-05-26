import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useLocation } from 'react-router-dom';

const ProgressContext = createContext(null);

/**
 * Drives the top route-progress bar based on:
 *   1. Location pathname change (auto start)
 *   2. Pending async data loads (call start()/finish() from data-fetch hooks)
 *
 * The bar visually advances 0→90% while loads are pending and snaps to 100%
 * once the in-flight count drops to zero.
 */
export function ProgressProvider({ children }) {
  const location = useLocation();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(false);
  const pendingRef = useRef(0);
  const tickRef = useRef(null);
  const finishTimerRef = useRef(null);
  const isFirstRender = useRef(true);

  const stop = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const tick = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      setWidth((w) => {
        if (w >= 90) return w;
        const remaining = 90 - w;
        return w + Math.max(0.4, remaining * 0.08);
      });
    }, 80);
  }, []);

  const begin = useCallback(() => {
    if (finishTimerRef.current) { clearTimeout(finishTimerRef.current); finishTimerRef.current = null; }
    setActive(true);
    setWidth((w) => (w === 0 ? 8 : w));
    tick();
  }, [tick]);

  const complete = useCallback(() => {
    stop();
    setWidth(100);
    finishTimerRef.current = setTimeout(() => {
      setActive(false);
      setWidth(0);
    }, 240);
  }, [stop]);

  const start = useCallback(() => {
    pendingRef.current += 1;
    begin();
  }, [begin]);

  const finish = useCallback(() => {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current === 0) complete();
  }, [complete]);

  // Path change → kick off a short-lived progress cycle even if pages don't
  // explicitly call start()/finish(); the data loads then keep it active.
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    begin();
    const t = setTimeout(() => {
      if (pendingRef.current === 0) complete();
    }, 520);
    return () => clearTimeout(t);
  }, [location.pathname, begin, complete]);

  useEffect(() => () => {
    stop();
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
  }, [stop]);

  return (
    <ProgressContext.Provider value={{ start, finish }}>
      {active && (
        <div
          className="route-progress"
          style={{ width: `${width}%`, transition: 'width 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease' }}
          aria-hidden
        />
      )}
      {children}
    </ProgressContext.Provider>
  );
}

ProgressProvider.propTypes = { children: PropTypes.node };

export function useProgress() {
  return useContext(ProgressContext) || { start: () => {}, finish: () => {} };
}

/** Hook helpers: call start() on mount, finish() once `done` flips true. */
export function useProgressWhile(loading) {
  const { start, finish } = useProgress();
  const startedRef = useRef(false);
  useEffect(() => {
    if (loading && !startedRef.current) {
      startedRef.current = true;
      start();
    } else if (!loading && startedRef.current) {
      startedRef.current = false;
      finish();
    }
  }, [loading, start, finish]);
  useEffect(() => () => { if (startedRef.current) finish(); }, [finish]);
}
