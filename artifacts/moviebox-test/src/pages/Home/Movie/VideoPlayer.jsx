import SmartPlayer from '../SmartPlayer';

const VideoPlayer = ({ movieId, title }) => {
  if (!movieId) return null;
  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <SmartPlayer
        subjectId={movieId}
        type="movie"
        title={title || ''}
        onClose={() => {}}
      />
    </div>
  );
};

export default VideoPlayer;
