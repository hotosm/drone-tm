import Image from '@Components/RadixComponents/Image';
import { motion } from 'framer-motion';
import worldBankLogo from '@Assets/images/LandingPage/WorldbankLogo.png';
import { fadeUpVariant } from '@Constants/animations';

export default function ClientAndPartners() {
  return (
    <section className="client-and-partners naxatw-overflow-hidden naxatw-bg-landing-white">
      <div className="naxatw-container !naxatw-max-w-full">
        <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-14 naxatw-py-20">
          <motion.p
            variants={fadeUpVariant}
            initial="hidden"
            whileInView="visible"
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
            className="naxatw-text-[35px] naxatw-leading-[5rem] naxatw-text-landing-red"
          >
            Client & Partners
          </motion.p>
          <motion.div
            variants={fadeUpVariant}
            initial="hidden"
            whileInView="visible"
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
          >
            <Image src={worldBankLogo} alt="world bank logo" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
