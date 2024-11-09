import { useNavigate } from 'react-router-dom';
import { useTypedDispatch } from '@Store/hooks';
import useAuth from '@Hooks/useAuth';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import Image from '@Components/RadixComponents/Image';
import droneTMLogo from '@Assets/images/LandingPage/DTM-logo-red.svg';
import projectCreator from '@Assets/images/LandingPage/project-creator.svg';
import droneOperator from '@Assets/images/LandingPage/drone-operator.svg';
import Icon from '@Components/common/Icon';
import { setCommonState } from '@Store/actions/common';
import { motion } from 'framer-motion';
import { slideVariants } from '@Constants/animations';

export default function SignInOverlay() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <motion.section
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={slideVariants}
      transition={{ duration: 0.5 }}
      className="naxatw-font-manrope naxatw-absolute naxatw-top-7 naxatw-z-20 naxatw-h-screen naxatw-w-full naxatw-bg-white naxatw-px-8 naxatw-py-8 md:naxatw-px-16 lg:naxatw-px-36 lg:naxatw-py-12"
    >
      <FlexRow className="naxatw-items-center naxatw-justify-between">
        <Image src={droneTMLogo} />
        <Icon
          name="close"
          onClick={() => {
            dispatch(setCommonState({ openSignInMenu: false }));
          }}
        />
      </FlexRow>
      <FlexRow className="naxatw-mt-12 naxatw-w-full naxatw-flex-wrap naxatw-gap-5 naxatw-px-6 lg:naxatw-flex-nowrap lg:naxatw-px-16 xl:naxatw-justify-between">
        <FlexColumn
          gap={5}
          className="naxatw-flex-1 naxatw-items-center naxatw-rounded-lg naxatw-border naxatw-border-grey-200 naxatw-px-10 naxatw-py-8 naxatw-text-landing-red lg:naxatw-px-16 lg:naxatw-py-14 xl:naxatw-px-24 xl:naxatw-py-20"
        >
          <h5>Project Creator</h5>
          <Image src={projectCreator} />
          <Button
            className="naxatw-whitespace-nowrap !naxatw-bg-landing-red"
            rightIcon="east"
            onClick={() => {
              localStorage.setItem('signedInAs', 'PROJECT_CREATOR');
              if (isAuthenticated()) {
                navigate('/projects');
              } else {
                navigate('/login');
              }
            }}
          >
            I&apos;m a Project Creator
          </Button>
        </FlexColumn>
        <FlexColumn
          gap={5}
          className="naxatw-flex-1 naxatw-items-center naxatw-rounded-lg naxatw-border naxatw-border-grey-200 naxatw-px-10 naxatw-py-8 naxatw-text-landing-red lg:naxatw-px-16 lg:naxatw-py-14 xl:naxatw-px-24 xl:naxatw-py-20"
        >
          <h5>Drone Operator</h5>
          <Image src={droneOperator} />
          <Button
            className="naxatw-whitespace-nowrap !naxatw-bg-landing-red"
            rightIcon="east"
            onClick={() => {
              localStorage.setItem('signedInAs', 'DRONE_PILOT');
              if (isAuthenticated()) {
                navigate('/projects');
              } else {
                navigate('/login');
              }
            }}
          >
            I&apos;m a Drone Operator
          </Button>
        </FlexColumn>
      </FlexRow>
    </motion.section>
  );
}
