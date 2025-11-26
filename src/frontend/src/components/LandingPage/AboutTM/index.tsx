import { Grid } from '@Components/common/Layouts';
import Image from '@Components/RadixComponents/Image';
import { motion } from 'framer-motion';
import droneImage from '@Assets/images/LandingPage/DroneImage.png';
import { aboutData } from '@Constants/landingPage';
import {
  containerAnimationVariant,
  fadeUpVariant,
} from '@Constants/animations';

export default function AboutTM() {
  return (
    <section className="about-section naxatw-overflow-hidden naxatw-bg-landing-white">
      <div className="naxatw-container !naxatw-max-w-full">
        <Grid className="naxatw-grid-cols-1 naxatw-items-center naxatw-gap-10 naxatw-py-10 sm:naxatw-grid-cols-2 md:naxatw-gap-20 md:naxatw-pb-40 md:naxatw-pt-52">
          <motion.div
            initial={{ translateX: -200, opacity: 0 }}
            whileInView={{ translateX: 0, opacity: 1 }}
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
            className="naxatw-col-span-1 naxatw-text-start"
          >
            <p className="naxatw-text-[2rem] naxatw-leading-[2.66rem] naxatw-text-landing-red md:naxatw-text-[3.75rem] md:naxatw-leading-[77px]">
              About Drone Tasking Manager (DroneTM)
            </p>
            <p className="naxatw-mt-5 naxatw-text-base naxatw-leading-[24px] naxatw-text-landing-grey">
              DroneTM is an integrated digital public good solution that aims
              to harness the power of the crowd to help generate high-resolution
              aerial maps of any location. Its innovative platform allows drone
              pilots in developing countries to access job opportunities and
              contribute to creating high-resolution datasets for disaster
              response and community resilience.
            </p>
          </motion.div>
          <motion.div
            initial={{ translateX: 200, opacity: 0 }}
            whileInView={{ translateX: 0, opacity: 1 }}
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
            className="naxatw-col-span-1 naxatw-hidden naxatw-justify-self-center md:naxatw-block md:naxatw-justify-self-end"
          >
            <Image src={droneImage} />
          </motion.div>
        </Grid>
        <motion.div
          variants={containerAnimationVariant}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="naxatw-grid naxatw-grid-cols-1 naxatw-gap-10 naxatw-rounded-[30px] naxatw-bg-[#F7EEE0] naxatw-px-10 naxatw-py-10 md:naxatw-grid-cols-2 md:naxatw-gap-40 md:naxatw-py-32 lg:naxatw-px-28"
        >
          {aboutData.map(data => (
            <motion.div key={data.id} variants={fadeUpVariant}>
              <Image src={data.icon} />
              <p className="naxatw-mb-6 naxatw-mt-4 naxatw-text-[1.5rem] naxatw-text-landing-red md:naxatw-text-[3.125rem]">
                {data.title}
              </p>
              <p className="naxatw-text-[1rem] naxatw-leading-[1.625rem] naxatw-text-landing-grey md:naxatw-text-xl md:naxatw-leading-9">
                {data.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
