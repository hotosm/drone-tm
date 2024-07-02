import { FlexColumn } from '@Components/common/Layouts';
import { motion } from 'framer-motion';
import { ourRationaleData } from '@Constants/landingPage';
import {
  containerAnimationVariant,
  fadeUpVariant,
} from '@Constants/animations';

export default function OurRationale() {
  return (
    <section className="our-nationale naxatw-bg-landing-white naxatw-px-10 naxatw-pt-10 md:naxatw-px-0 md:naxatw-pt-40">
      <div className="naxatw-container !naxatw-max-w-full">
        <div className="naxatw-grid naxatw-grid-cols-1 sm:naxatw-grid-cols-2 md:naxatw-grid-cols-3 md:naxatw-gap-20">
          <div className="naxatw-col-span-1">
            <p className="naxatw-text-[2rem] naxatw-leading-[3.75rem] naxatw-text-landing-red md:naxatw-text-[3.75rem]">
              Our Rationale
            </p>
          </div>
          <motion.div
            variants={containerAnimationVariant}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="naxatw-col-span-2 naxatw-grid naxatw-grid-cols-1 naxatw-gap-10 md:naxatw-grid-cols-2"
          >
            {ourRationaleData.map(data => (
              <motion.div
                key={data.id}
                variants={fadeUpVariant}
                className="naxatw-flex naxatw-flex-col naxatw-gap-4"
              >
                <FlexColumn className="naxatw-mt-6 naxatw-h-8 naxatw-w-8 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-landing-red md:naxatw-mt-0">
                  <span className="naxatw-text-base naxatw-text-landing-red">
                    {data.id}
                  </span>
                </FlexColumn>
                <div>
                  <p className="naxatw-text-[1.5rem] naxatw-leading-[2rem] naxatw-text-landing-grey md:naxatw-text-[1.875rem] md:naxatw-leading-[2.5rem]">
                    {data.title}
                  </p>
                </div>
                <p className="naxatw-text-base naxatw-leading-6 naxatw-text-landing-grey">
                  {data.description}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
