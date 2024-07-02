import { FlexColumn } from '@Components/common/Layouts';
import { motion } from 'framer-motion';
import { featuresData } from '@Constants/landingPage';

export default function Features() {
  const container = {
    hidden: { opacity: 1, scale: 0 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        delayChildren: 0.3,
        staggerChildren: 0.2,
      },
    },
  };

  const item = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
    },
  };
  return (
    <section className="features naxatw-bg-landing-white naxatw-p-10 md:naxatw-px-0 md:naxatw-py-32">
      <div className="naxatw-container !naxatw-max-w-full">
        <div className="naxatw-grid naxatw-grid-cols-1 lg:naxatw-grid-cols-4">
          <div className="naxatw-col-span-1">
            <p className="naxatw-text-[40px] naxatw-font-medium naxatw-leading-[3.125rem] naxatw-text-landing-red">
              Features of Drone Tasking Manager
            </p>
          </div>
          <motion.div
            variants={container}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="naxatw-grid naxatw-grid-cols-1 naxatw-gap-10 sm:naxatw-grid-cols-2 lg:naxatw-col-span-3 lg:naxatw-grid-cols-3"
          >
            {featuresData.map(data => (
              <motion.div
                key={data.id}
                variants={item}
                className="naxatw-col-span-1 naxatw-flex naxatw-flex-col naxatw-gap-4"
              >
                <FlexColumn className="naxatw-mt-6 naxatw-h-8 naxatw-w-8 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-landing-red naxatw-text-landing-red md:naxatw-mt-0">
                  <span className="naxatw-text-base">{data.id}</span>
                </FlexColumn>
                <div>
                  <p className="naxatw-text-[30px] naxatw-leading-[40px] naxatw-text-landing-grey">
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
