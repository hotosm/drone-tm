import { useTypedDispatch } from '@Store/hooks';
import { FlexColumn } from '@Components/common/Layouts';
import Image from '@Components/RadixComponents/Image';
import { Button } from '@Components/RadixComponents/Button';
import { motion } from 'framer-motion';
import droneTaskingManagerLogo from '@Assets/images/DTM-logo-white.svg';
import droneBackgroundImage from '@Assets/images/LandingPage/DroneTM-bg.jpg';
import arrowSouth from '@Assets/images/LandingPage/arrow_south.svg';
import { setCommonState } from '@Store/actions/common';
import useAuth from '@Hooks/useAuth';
import { useNavigate } from 'react-router-dom';
// import { getLocalStorageValue } from '@Utils/getLocalStorageValue';

export default function Home() {
  const dispatch = useTypedDispatch();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  // const userProfile = getLocalStorageValue('userprofile');
  const role = localStorage.getItem('signedInAs');

  const bounceTransition: {
    y: {
      repeat: number;
      repeatType: 'reverse' | 'loop' | 'mirror';
      duration: number;
      ease: string;
    };
  } = {
    y: {
      repeat: Infinity,
      repeatType: 'mirror',
      duration: 0.8,
      ease: 'easeOut',
    },
  };

  const container = {
    visible: {
      transition: {
        staggerChildren: 0.025,
      },
    },
  };

  return (
    <section
      style={{
        backgroundImage: `url(${droneBackgroundImage})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
      }}
      className="naxatw-h-screen naxatw-w-full naxatw-text-landing-white"
    >
      <div className="naxatw-container naxatw-h-full !naxatw-max-w-full naxatw-py-12">
        <div className="naxatw-flex naxatw-animate-fade-up naxatw-flex-row naxatw-justify-between">
          <Image src={droneTaskingManagerLogo} />
          {isAuthenticated() && role !== 'REGULATOR' ? (
            <Button
              onClick={() => navigate('/projects')}
              className="naxatw-cursor-pointer !naxatw-rounded-[3.125rem] naxatw-border naxatw-px-5 naxatw-py-3 naxatw-text-body-md naxatw-font-normal naxatw-text-landing-white"
            >
              Dashboard
            </Button>
          ) : (
            <Button
              onClick={() => dispatch(setCommonState({ openSignInMenu: true }))}
              className="naxatw-cursor-pointer !naxatw-rounded-[3.125rem] !naxatw-bg-landing-red naxatw-px-5 naxatw-py-3 naxatw-text-body-md naxatw-font-normal naxatw-text-landing-white"
            >
              Sign In
            </Button>
          )}
        </div>
        <FlexColumn className="naxatw-relative naxatw-h-full naxatw-items-center naxatw-justify-center naxatw-pb-20 naxatw-text-center md:naxatw-items-start lg:naxatw-text-end">
          <motion.div
            variants={container}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="naxatw-flex naxatw-flex-col naxatw-items-start"
          >
            <p className="naxatw-animate-fade-up naxatw-text-[3.25rem] naxatw-font-light naxatw-leading-[4rem] md:naxatw-text-[4.375rem] md:naxatw-leading-[5rem]">
              Drone Tasking
            </p>
            <p className="naxatw-animate-fade-up naxatw-text-[3.25rem] naxatw-font-light naxatw-leading-[4rem] md:naxatw-text-[4.375rem] md:naxatw-leading-[5rem]">
              Manager (Drone TM)
            </p>
            <p className="naxatw-animate-fade-up naxatw-text-[1.5rem] naxatw-leading-8 md:naxatw-mt-8 md:naxatw-text-2xl">
              Together, WeMap - Open.Accurate. Accessible
            </p>
          </motion.div>
          {/* <div className="naxatw-mt-12 naxatw-flex naxatw-animate-fade-up naxatw-flex-col naxatw-items-center naxatw-gap-3 md:naxatw-flex-row">
            <input
              type="email"
              placeholder="Email"
              className="naxatw-w-[22.75rem] naxatw-rounded-[3.125rem] naxatw-px-6 naxatw-py-5 !naxatw-text-grey-900 placeholder:naxatw-text-grey-700 focus:naxatw-outline-0"
            />
            <Button className="!naxatw-rounded-[3.125rem] !naxatw-bg-[#03101c] naxatw-px-9 naxatw-py-8 naxatw-text-body-lg naxatw-tracking-wide">
              Join Waitlist
            </Button>
          </div> */}
          <motion.div
            className="naxatw-absolute naxatw-bottom-16 naxatw-left-[50%] naxatw-hidden naxatw-opacity-85 lg:naxatw-block"
            animate={{
              y: ['0%', '-30%'],
            }}
            transition={bounceTransition.y}
          >
            <Image src={arrowSouth} className="naxatw-w-[1.5rem]" />
          </motion.div>
        </FlexColumn>
      </div>
    </section>
  );
}
