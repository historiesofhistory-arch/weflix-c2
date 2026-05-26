import React, { useRef, useCallback, useState, useEffect } from 'react';
import { FaUser } from 'react-icons/fa';
import { mbCoverUrl } from '../Fetcher';

export default function CastRow({ cast }) {
  const listRef = useRef(null);
  const dragStateRef = useRef({ active: false, startX: 0, startScrollLeft: 0, moved: false });
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const el = listRef.current;
    if (!el) return;
    dragStateRef.current = { active: true, startX: e.pageX, startScrollLeft: el.scrollLeft, moved: false };
    setIsDragging(true);
  }, []);

  const onMouseMove = useCallback((e) => {
    const el = listRef.current;
    const drag = dragStateRef.current;
    if (!el || !drag.active) return;
    const delta = e.pageX - drag.startX;
    if (Math.abs(delta) > 4) drag.moved = true;
    el.scrollLeft = drag.startScrollLeft - delta;
  }, []);

  const endDrag = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag.active) return;
    drag.active = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [endDrag]);

  if (!cast || cast.length === 0) return null;

  const topCast = cast.slice(0, 20);

  return (
    <section className="px-4 sm:px-6 md:px-12 pb-16">
      <div className="max-w-7xl mx-auto">
        <h3 className="text-xl md:text-2xl font-bold text-white mb-6 tracking-tight flex items-center gap-3">
          <span className="w-1.5 h-6 bg-red-500 rounded-full inline-block" />
          Top Cast
        </h3>

        <div
          ref={listRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseLeave={endDrag}
          className={`flex gap-4 md:gap-5 overflow-x-auto hide-scrollbar px-4 pt-6 pb-6 -mx-4 -mt-6 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        >
          {topCast.map((person, i) => {
            const avatarUrl = mbCoverUrl(person.avatar?.url || person.profile_path || '', 140);
            const name = person.name || 'Unknown';
            const character = person.character || person.role || '';
            return (
              <div key={person.id || person.credit_id || i} className="shrink-0 w-[120px] md:w-[140px] group">
                <div className="w-full aspect-[2/3] bg-[#111827] rounded-xl overflow-hidden ring-1 ring-white/5 group-hover:ring-white/20 transition-all duration-300 relative mb-3">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={name} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#0d1117] text-gray-700">
                      <FaUser className="text-4xl opacity-50" />
                    </div>
                  )}
                </div>
                <h4 className="text-white text-[13px] font-bold leading-tight line-clamp-1">{name}</h4>
                {character && <p className="text-gray-500 text-[11px] mt-1 leading-snug line-clamp-2">{character}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
