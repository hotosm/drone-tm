/* eslint-disable jsx-a11y/media-has-caption */
import { FlexColumn } from '@Components/common/Layouts';
import React, { useEffect, useRef } from 'react';

interface VideoPlayerProps {
  src: string;
  title: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ src, title }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play();
    }
  }, [src]);

  return (
    <FlexColumn className="naxatw-gap-6 naxatw-overflow-hidden">
      <div className="naxatw-overflow-hidden naxatw-rounded-lg naxatw-border naxatw-bg-white naxatw-px-8 naxatw-py-3 naxatw-shadow-sm">
        <FlexColumn className="naxatw-gap-4">
          <p className="naxatw-text-primary-700 naxatw-text-[1.5rem] naxatw-font-bold">
            {title}
          </p>
        </FlexColumn>
      </div>
      <video
        ref={videoRef}
        src={src}
        title={title}
        className="naxatw-aspect-video naxatw-h-auto naxatw-max-h-[78vh] naxatw-min-h-[22rem] naxatw-w-full naxatw-rounded-lg naxatw-border-2 naxatw-bg-[#2625253b] naxatw-object-contain naxatw-shadow-sm"
        controls
      />
    </FlexColumn>
  );
};

export default VideoPlayer;
