/* eslint-disable no-nested-ternary */
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import { motion } from 'framer-motion';
import { useSpring, animated } from '@react-spring/web';
import { useState } from 'react';
import VideoPlayer from '@Components/Tutorials/VideoTutorials';
import {
  RowVideoCards,
  ColumnVideoCards,
} from '@Components/Tutorials/VideoTutorials/VideoCards';
import { IVideoTutorialItems, videoTutorialData } from '@Constants/tutorials';
import { Link } from 'react-router-dom';
import Icon from '@Components/common/Icon';

const Tutorials = () => {
  const [isVideoBoxVisible, setIsVideoBoxVisible] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<IVideoTutorialItems | null>(
    null,
  );

  const springs = useSpring({
    from: { y: 100 },
    to: { y: 0 },
  });

  const videoCardVariants = {
    show: {
      opacity: 1,
      x: 0,
      transition: {
        duration: 1, // Slower animation
        staggerChildren: 0.2, // Delay for each child to create row-to-column effect
        delayChildren: 0.1, // Adds a slight delay before the first child animates
      },
    },
    hidden: {
      opacity: 0,
      x: '-100%',
      transition: { duration: 1 },
    },
  };

  const childVariants = {
    show: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: { duration: 0.25 },
    },
    hidden: {
      opacity: 0,
      x: '-50%',
      y: '50%',
      transition: { duration: 0.25 },
    },
  };
  const videoColumnCardVariants = {
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 1, // Slower animation
        staggerChildren: 0.2, // Delay for each child to create row-to-column effect
        delayChildren: 0.1, // Adds a slight delay before the first child animates
      },
    },
    hidden: {
      opacity: 0,
      y: '-100%',
      transition: { duration: 1 },
    },
  };

  const columnChildVariants = {
    show: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: { duration: 0.25 },
    },
    hidden: {
      opacity: 0,
      x: '50%',
      y: '-50%',
      transition: { duration: 0.25 },
    },
  };

  const videoBoxVariants = {
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.75, ease: 'easeOut' }, // Slowed down to 1.5 seconds
    },
    hidden: {
      opacity: 0,
      y: '100%',
      transition: { duration: 0.75, ease: 'easeIn' }, // Matching duration for hiding
    },
  };

  return (
    <animated.div style={{ ...springs }}>
      {isVideoBoxVisible ? (
        <div className="naxatw-m-auto naxatw-w-full naxatw-py-7">
          <div className="naxatw-mx-auto naxatw-flex naxatw-w-[95%] naxatw-flex-col naxatw-gap-4">
            <FlexRow className="naxatw-items-center naxatw-gap-2">
              <Icon
                name="arrow_back"
                className="naxatw-items-center hover:naxatw-text-red"
                onClick={() => {
                  setIsVideoBoxVisible(false);
                  setCurrentVideo(null);
                }}
              />

              <p className="naxatw-text-primary-700 naxatw-text-[1.5rem] naxatw-font-medium">
                Video Tutorial
              </p>
            </FlexRow>
            <div
              className={`naxatw-grid naxatw-gap-4 ${videoTutorialData.length > 1 ? 'lg:naxatw-grid-cols-[1fr_30rem]' : 'naxatw-w-full'}`}
            >
              <motion.div
                variants={videoBoxVariants}
                initial="hidden"
                animate={isVideoBoxVisible ? 'show' : 'hidden'}
              >
                {currentVideo && (
                  <VideoPlayer
                    src={currentVideo.videoUrl}
                    title={currentVideo.title}
                  />
                )}
              </motion.div>
              <motion.div
                variants={videoCardVariants}
                animate={isVideoBoxVisible ? 'show' : 'hidden'}
                initial="hidden"
              >
                <FlexColumn className="naxatw-gap-2">
                  {videoTutorialData.map((video: IVideoTutorialItems) => {
                    if (video.id === currentVideo?.id) return null;
                    return (
                      <motion.div variants={childVariants} key={video.id}>
                        <RowVideoCards
                          thumbnail={video.thumbnail}
                          title={video.title}
                          onClick={() => {
                            setCurrentVideo(video);
                            setIsVideoBoxVisible(true);
                          }}
                        />
                      </motion.div>
                    );
                  })}
                </FlexColumn>
              </motion.div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="naxatw-m-auto naxatw-w-full naxatw-max-w-[90rem] naxatw-py-7">
            <div className="naxatw-mx-auto naxatw-w-11/12">
              <FlexColumn className="naxatw-items-start naxatw-gap-4">
                <FlexRow className="naxatw-items-center naxatw-gap-2">
                  <Link to="/" className="naxatw-flex naxatw-text-center">
                    <Icon
                      name="arrow_back"
                      className="naxatw-items-center hover:naxatw-text-red"
                    />
                  </Link>
                  <p className="naxatw-text-primary-700 naxatw-text-[1.5rem] naxatw-font-medium">
                    Video Tutorial
                  </p>
                </FlexRow>

                <motion.div
                  variants={videoColumnCardVariants}
                  initial="hidden"
                  animate={!isVideoBoxVisible ? 'show' : 'hidden'}
                  className="naxatw-w-full"
                >
                  <div className="naxatw-grid naxatw-w-full naxatw-grid-cols-1 naxatw-gap-5 sm:naxatw-grid-cols-2 lg:naxatw-grid-cols-3 xl:naxatw-grid-cols-4">
                    {videoTutorialData?.map((video: IVideoTutorialItems) => (
                      <motion.div variants={columnChildVariants} key={video.id}>
                        <ColumnVideoCards
                          key={video.id}
                          title={video.title}
                          thumbnail={video.thumbnail}
                          onClick={() => {
                            setCurrentVideo(video);
                            setIsVideoBoxVisible(true);
                          }}
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              </FlexColumn>
            </div>
          </div>
        </>
      )}
    </animated.div>
  );
};

export default Tutorials;
