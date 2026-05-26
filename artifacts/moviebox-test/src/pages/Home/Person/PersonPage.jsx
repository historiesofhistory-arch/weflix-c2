import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft } from 'react-icons/fa';

export default function PersonPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#07080a] text-gray-200 flex flex-col items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Person details are not available</h1>
        <p className="text-gray-400 mb-8">This feature is not supported with the current data source.</p>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 mx-auto bg-white/10 hover:bg-white/20 border border-white/10 text-white font-medium px-6 py-3 rounded-xl transition-all"
        >
          <FaArrowLeft /> Go Back
        </button>
      </div>
    </div>
  );
}
