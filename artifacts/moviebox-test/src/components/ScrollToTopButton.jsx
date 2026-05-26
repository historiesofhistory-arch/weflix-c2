import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BiUpArrowAlt } from 'react-icons/bi';

/**
 * Floating "back to top" button. Appears once the user has scrolled past
 * `showAfter` pixels. iOS-style spring + tap feedback.
 */
export default function ScrollToTopButton({ showAfter = 300, className = '' }) {
  const [visible, setVisible] = useState(false);
  const reduceMotion = useReducedMotion();

  const onScroll = useCallback(() => {
    setVisible(window.scrollY > showAfter);
  }, [showAfter]);

  useEffect(() => {
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [onScroll]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="scroll-top"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 16 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 16 }}
          whileHover={reduceMotion ? undefined : { scale: 1.1 }}
          whileTap={reduceMotion ? undefined : { scale: 0.92 }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 26 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4 right-4 z-50 text-white p-3 rounded-full bg-white/10 hover:bg-white/20 shadow-lg ${className}`}
          aria-label="Scroll to Top"
        >
          <BiUpArrowAlt className="text-2xl" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

ScrollToTopButton.propTypes = {
  showAfter: PropTypes.number,
  className: PropTypes.string,
};
