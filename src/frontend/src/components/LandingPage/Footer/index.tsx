/* eslint-disable no-unused-vars */
import { Flex, FlexRow } from '@Components/common/Layouts';
import Icon from '@Components/common/Icon';
import Image from '@Components/RadixComponents/Image';
import naxaLogo from '@Assets/images/LandingPage/Naxa-logo.png';
import hotLogo from '@Assets/images/LandingPage/HOT-logo.png';
import { Button } from '@Components/RadixComponents/Button';
import { motion } from 'framer-motion';
import { fadeUpVariant } from '@Constants/animations';

export default function Footer() {
  return (
    <footer className="naxatw-h-fit naxatw-pb-6 naxatw-text-landing-white">
      <div className="!naxatw-max-w-full">
        {/* <div className="naxatw-bg-landing-red naxatw-px-5 naxatw-py-24 md:naxatw-px-9 lg:naxatw-px-32">
          <motion.div
            variants={fadeUpVariant}
            initial="hidden"
            whileInView="visible"
            transition={{ duration: 0.7 }}
            className="naxatw-text-center"
          >
            <p className="naxatw-text-[2rem] naxatw-leading-[2.66rem] md:naxatw-text-[4.375rem] md:naxatw-leading-[5rem]">
              Talk to Us
            </p>
            <p className="naxatw-mt-10 naxatw-text-xl">
              Experience heightened speed, improved stability,
            </p>
            <p className="naxatw-text-xl">and a complete suite of features.</p>
          </motion.div>
          <Flex className="naxatw-mt-[72px] naxatw-items-center naxatw-justify-center">
            <Button className="!naxatw-rounded-[3.125rem] !naxatw-bg-[#03101c] naxatw-px-9 naxatw-py-8 naxatw-text-body-lg naxatw-tracking-wide">
              <span className="naxatw-text-base naxatw-font-semibold">
                Lets Talk
              </span>
              <Icon name="east" />
            </Button>
          </Flex>
        </div> */}
        <motion.div
          variants={fadeUpVariant}
          initial="hidden"
          whileInView="visible"
          className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-between naxatw-gap-8 naxatw-border-b naxatw-border-t naxatw-border-landing-white naxatw-px-5 naxatw-py-8 naxatw-text-landing-grey md:naxatw-flex-row md:naxatw-px-9 lg:naxatw-px-32"
        >
          <div className="naxatw-text-center md:naxatw-text-start">
            <span className="naxatw-font-medium">Developed & Designed by</span>
            <FlexRow className="naxatw-mt-3 naxatw-items-center" gap={10}>
              <Image src={hotLogo} />
              <Image src={naxaLogo} />
            </FlexRow>
          </div>
          {/* <div className="naxatw-flex naxatw-w-1/3 naxatw-flex-col naxatw-justify-between naxatw-gap-4 naxatw-text-center naxatw-font-medium md:naxatw-flex-row">
            <span className="naxatw-cursor-pointer">Impacts</span>
            <span className="naxatw-cursor-pointer">Privacy Policy</span>
            <span className="naxatw-cursor-pointer">Partners</span>
            <span className="naxatw-cursor-pointer">FAQs</span>
            <span className="naxatw-cursor-pointer">Cookies</span>
          </div> */}
        </motion.div>
        <p className="naxatw-mt-2 naxatw-text-center naxatw-text-base naxatw-text-landing-grey">
          © Drone Arial Tasking Manager. All Rights Reserved 2024
        </p>
      </div>
    </footer>
  );
}
