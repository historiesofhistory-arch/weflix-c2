import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isMobile;
}

/**
 * Reusable iOS-style bottom-sheet on mobile, centered modal on desktop.
 *
 * - Drag-to-dismiss (mobile, unless prefers-reduced-motion)
 * - Backdrop click closes
 * - Safe-area aware
 * - Escape key support
 */
export default function BottomSheet({
  isOpen,
  onClose,
  children,
  className = '',
  maxWidth = 440,
  ariaLabel,
}) {
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <React.Fragment>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          />

          <div
            className={`fixed inset-0 z-50 flex pointer-events-none ${
              isMobile ? 'items-end justify-center' : 'items-center justify-center p-4'
            }`}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
          >
            <motion.div
              initial={reduceMotion
                ? { opacity: 0 }
                : isMobile
                  ? { y: '100%', opacity: 1 }
                  : { scale: 0.95, opacity: 0, y: 30 }}
              animate={reduceMotion
                ? { opacity: 1 }
                : isMobile
                  ? { y: 0, opacity: 1 }
                  : { scale: 1, opacity: 1, y: 0 }}
              exit={reduceMotion
                ? { opacity: 0 }
                : isMobile
                  ? { y: '100%', opacity: 1 }
                  : { scale: 0.95, opacity: 0, y: 20 }}
              transition={reduceMotion
                ? { duration: 0.12 }
                : isMobile
                  ? { type: 'spring', damping: 32, stiffness: 320, mass: 0.6 }
                  : { type: 'spring', damping: 25, stiffness: 300 }}
              drag={isMobile && !reduceMotion ? 'y' : false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.4 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 120 || info.velocity.y > 600) onClose?.();
              }}
              style={{ maxWidth }}
              className={`w-full bg-[#0b0f19]/95 backdrop-blur-2xl border-white/10 shadow-2xl shadow-black overflow-hidden pointer-events-auto ${
                isMobile
                  ? 'rounded-t-3xl border-t border-x pb-[max(env(safe-area-inset-bottom,0px),0.5rem)]'
                  : 'rounded-3xl border'
              } ${className}`}
            >
              {isMobile && <div className="bottom-sheet-handle" />}
              {children}
            </motion.div>
          </div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}

BottomSheet.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  children: PropTypes.node,
  className: PropTypes.string,
  maxWidth: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  ariaLabel: PropTypes.string,
};
