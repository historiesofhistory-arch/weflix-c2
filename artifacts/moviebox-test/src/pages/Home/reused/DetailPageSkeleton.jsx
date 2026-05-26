import React from "react";
import PropTypes from "prop-types";
import Skeleton from "../../../components/Skeleton";

const DetailPageSkeleton = ({ type = "movie" }) => {
  const isTv = type === "tv";

  return (
    <div className="min-h-screen bg-[#07080a] overflow-hidden">
      {/* ── HERO SECTION ── */}
      <div className="relative w-full min-h-[70vh] flex flex-col justify-end pt-32 pb-20 bg-[#0f1117]">
        {/* Back Button Skeleton */}
        <div className="absolute top-0 left-0 right-0 z-20 p-6 md:p-10 flex">
          <Skeleton width={96} height={40} rounded="rounded-full" />
        </div>

        {/* Hero Content */}
        <div className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-12 flex flex-col md:flex-row items-end gap-8 lg:gap-14">

          {/* Poster (Desktop) */}
          <div className="hidden md:block shrink-0 z-10">
            <Skeleton className="w-48 lg:w-64 aspect-[2/3]" rounded="rounded-2xl" />
          </div>

          {/* Info */}
          <div className="flex-1 max-w-3xl pb-2 w-full">
            {/* Tagline */}
            <Skeleton className="w-1/3 mb-4" height={16} rounded="rounded-full" />

            {/* Title */}
            <Skeleton className="h-12 md:h-16 w-3/4 md:w-2/3 mb-5" rounded="rounded-xl" />

            {/* Meta */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
              <Skeleton width={64} height={20} />
              <Skeleton width={80} height={20} />
              <Skeleton width={64} height={20} />
            </div>

            {/* Genres */}
            <div className="flex flex-wrap gap-2 mb-6">
              {[1, 2, 3].map(n => (
                <Skeleton key={n} width={64} height={24} rounded="rounded-full" />
              ))}
            </div>

            {/* Overview */}
            <div className="space-y-3">
              <Skeleton className="w-full" height={16} />
              <Skeleton className="w-[90%]" height={16} />
              <Skeleton className="w-[80%]" height={16} />
              <Skeleton className="w-[85%]" height={16} />
            </div>
          </div>
        </div>
      </div>

      {/* ── PLAYER SECTION ── */}
      <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 md:px-12 -mt-4 md:-mt-10 mb-12">
        <div className="bg-[#0f1117]/80 rounded-2xl md:rounded-[2rem] p-2 md:p-5 border border-white/5">
          <Skeleton className="w-full aspect-video" rounded="rounded-xl md:rounded-2xl" />
        </div>
      </div>

      {/* ── EPISODES (TV ONLY) ── */}
      {isTv && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 pb-16">
          <div className="bg-[#111319]/50 rounded-[2rem] border border-white/5 overflow-hidden p-5 md:px-8 pt-6">
            <div className="flex flex-col sm:flex-row gap-4 mb-6 justify-between items-start sm:items-center">
              <div className="flex items-center gap-4">
                <Skeleton width={40} height={40} rounded="rounded-2xl" />
                <div>
                  <Skeleton width={96} height={20} className="mb-2" />
                  <Skeleton width={128} height={12} rounded="rounded-sm" />
                </div>
              </div>
              <Skeleton className="h-10 w-full sm:w-64" rounded="rounded-xl" />
            </div>

            <div className="flex gap-3 mb-6">
              {[1, 2, 3].map(n => (
                <Skeleton key={n} width={96} height={40} rounded="rounded-full" />
              ))}
            </div>

            <div className="grid grid-flow-col auto-cols-[180px] sm:auto-cols-[220px] gap-4 overflow-hidden">
              {[1, 2, 3, 4, 5].map(n => (
                <Skeleton key={n} className="h-[180px]" rounded="rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

DetailPageSkeleton.propTypes = {
  type: PropTypes.oneOf(["movie", "tv"]),
};

export default DetailPageSkeleton;
