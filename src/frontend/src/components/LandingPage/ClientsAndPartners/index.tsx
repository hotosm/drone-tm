import Image from '@Components/RadixComponents/Image';
import { motion } from 'framer-motion';
import worldBankLogo from '@Assets/images/LandingPage/WorldbankLogo.png';
import { fadeUpVariant } from '@Constants/animations';
import gfdrrLogo from '@Assets/images/GFDRR-logo.png';
import JamaicaFlyingLabsLogo from '@Assets/images/LandingPage/JamaicaFlyingLabs_Logo.png';
import { FlexRow } from '@Components/common/Layouts';

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
            <FlexRow
              className="naxatw-flex naxatw-items-center naxatw-justify-center"
              gap={10}
            >
              <Image src={worldBankLogo} alt="world bank logo" />
              <Image src={gfdrrLogo} alt="gfdrrLogo" width={260} />
              <Image src={JamaicaFlyingLabsLogo} alt="gfdrrLogo" width={200} />
            </FlexRow>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
