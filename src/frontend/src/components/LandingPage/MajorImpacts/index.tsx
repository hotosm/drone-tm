import { Grid } from '@Components/common/Layouts';
import Image from '@Components/RadixComponents/Image';
import { motion } from 'framer-motion';
import Accordion from '@Components/common/Accordion';
import majorImpactsImage from '@Assets/images/LandingPage/MajorImpactImage.png';
import { accordionData } from '@Constants/landingPage';
import {
  containerAnimationVariant,
  fadeUpVariant,
} from '@Constants/animations';

export default function MajorImpacts() {
  return (
    <section className="major-impacts naxatw-overflow-hidden">
      <div className="naxatw-bg-landing-white naxatw-px-8 naxatw-py-4 md:naxatw-px-20 lg:naxatw-pt-40">
        <Grid
          gap={10}
          className="naxatw-grid naxatw-grid-cols-1 lg:naxatw-grid-cols-2"
        >
          {/* <motion.div
            initial={{ translateX: -200, opacity: 0 }}
            whileInView={{ translateX: 0, opacity: 1 }}
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
          > */}
          <Image
            src={majorImpactsImage}
            className="naxatw-col-span-1 naxatw-rounded-[5rem] naxatw-object-cover"
          />
          {/* </motion.div> */}
          <motion.div
            variants={containerAnimationVariant}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="naxatw-col-span-1"
          >
            <p className="naxatw-text-[2rem] naxatw-leading-[2.66rem] naxatw-text-landing-red md:naxatw-text-[3.75rem] md:naxatw-leading-[77px]">
              Anticipated Major Impacts
            </p>
            <div>
              {accordionData.map((data: Record<string, any>) => (
                <motion.div variants={fadeUpVariant} key={data.id}>
                  <Accordion
                    title={data.title}
                    description={data.description}
                    open={data.isOpen}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        </Grid>
      </div>
    </section>
  );
}
