import React, { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FaCheckCircle, FaExclamationCircle, FaInfoCircle, FaTimes } from 'react-icons/fa';

const ToastContext = createContext(null);

const ICONS = {
  success: <FaCheckCircle className="text-green-400" />,
  error: <FaExclamationCircle className="text-red-400" />,
  info: <FaInfoCircle className="text-sky-400" />,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const reduceMotion = useReducedMotion();

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, opts = {}) => {
    const id = ++idRef.current;
    const toast = {
      id,
      message,
      type: opts.type || 'info',
      duration: opts.duration ?? 2600,
    };
    setToasts((prev) => [...prev, toast]);
    if (toast.duration > 0) {
      setTimeout(() => dismiss(id), toast.duration);
    }
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    show,
    success: (msg, opts) => show(msg, { ...opts, type: 'success' }),
    error: (msg, opts) => show(msg, { ...opts, type: 'error' }),
    info: (msg, opts) => show(msg, { ...opts, type: 'info' }),
    dismiss,
  }), [show, dismiss]);

  // Make toast available to non-React modules (e.g. fetch helpers, contexts)
  useEffect(() => {
    window.__toast = api;
    return () => { if (window.__toast === api) delete window.__toast; };
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed left-1/2 -translate-x-1/2 top-[max(env(safe-area-inset-top,0px),0.75rem)] z-[200] flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,420px)]"
        aria-live="polite"
        aria-atomic="true"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
              transition={reduceMotion ? { duration: 0.12 } : { type: 'spring', damping: 24, stiffness: 360 }}
              className="pointer-events-auto w-full bg-[#0b0f19]/95 backdrop-blur-xl border border-white/10 shadow-xl shadow-black/50 rounded-2xl px-4 py-3 flex items-center gap-3 text-sm text-white"
              role="status"
            >
              <span className="text-lg shrink-0">{ICONS[t.type] || ICONS.info}</span>
              <span className="flex-1 leading-snug">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 p-1 -m-1 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
              >
                <FaTimes className="text-xs" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

ToastProvider.propTypes = { children: PropTypes.node };

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
