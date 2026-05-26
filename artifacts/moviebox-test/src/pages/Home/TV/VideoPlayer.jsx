import SmartPlayer from '../SmartPlayer';

const VideoPlayer = ({ tvId, season = 1, episode = 1, title, onNextEpisode }) => {
  if (!tvId) return null;
  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <SmartPlayer
        subjectId={tvId}
        type="tv"
        season={season}
        episode={episode}
        title={title || ''}
        onClose={() => {}}
        onNextEpisode={onNextEpisode}
      />
    </div>
  );
};

export default VideoPlayer;
