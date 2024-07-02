import { FlexRow } from '@Components/common/Layouts';
import Icon from '@Components/common/Icon';
import Image from '@Components/RadixComponents/Image';
import { motion } from 'framer-motion';
import {
  containerAnimationVariant,
  fadeUpVariant,
} from '@Constants/animations';
import { caseStudiesData } from '@Constants/landingPage';
import caseStudyImage from '@Assets/images/LandingPage/CaseStudyImage.png';
import { useEffect, useState } from 'react';

export default function CaseStudies() {
  const [itemsToShow, setItemsToShow] = useState(1);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth < 768) {
        setItemsToShow(1);
      } else {
        setItemsToShow(2);
      }
    }

    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return (
    <section className="case-studies naxatw-bg-[#F9F3EA]">
      <div className="naxatw-container naxatw-max-w-full naxatw-py-6 md:naxatw-py-24">
        <FlexRow className="naxatw-items-center naxatw-justify-between">
          <motion.p
            variants={fadeUpVariant}
            initial="hidden"
            whileInView="visible"
            className="naxatw-text-[2rem] naxatw-leading-[60px] naxatw-text-landing-red md:naxatw-text-[3.75rem]"
          >
            Case Studies
          </motion.p>
          <FlexRow gap={3}>
            <button
              type="button"
              className="naxatw-flex naxatw-h-12 naxatw-w-12 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-landing-blue naxatw-bg-white hover:naxatw-animate-loader"
              onClick={() => {}}
            >
              <Icon name="west" />
            </button>
            <button
              type="button"
              className="naxatw-flex naxatw-h-12 naxatw-w-12 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-landing-blue naxatw-bg-white hover:naxatw-animate-loader"
              onClick={() => {}}
            >
              <Icon name="east" />
            </button>
          </FlexRow>
        </FlexRow>
        <motion.div
          variants={containerAnimationVariant}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="naxatw-mt-12 naxatw-grid naxatw-grid-cols-1 naxatw-gap-5 md:naxatw-grid-cols-2"
        >
          {caseStudiesData.slice(0, itemsToShow).map(data => (
            <motion.div
              key={data.id}
              variants={fadeUpVariant}
              className="naxatw-col-span-1 naxatw-grid naxatw-min-h-[300px] naxatw-grid-cols-1 naxatw-gap-8 naxatw-rounded-xl naxatw-bg-white naxatw-px-8 naxatw-py-10 naxatw-duration-100 hover:naxatw-shadow-lg md:naxatw-grid-cols-2"
            >
              <div className="naxatw-col-span-1">
                <p className="naxatw-text-[24px] naxatw-font-medium naxatw-leading-[30px]">
                  {data.title}
                </p>
                <p className="naxatw-mt-4 naxatw-text-[16px] naxatw-font-medium naxatw-leading-[24px]">
                  {data.description}
                </p>
              </div>
              <div className="naxatw-col-span-1 naxatw-justify-self-center">
                <Image src={caseStudyImage} className="naxatw-rounded-lg" />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
