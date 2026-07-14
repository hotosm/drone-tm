import { FlexColumn } from "@Components/common/Layouts";
import { m } from "@/paraglide/messages";
// import Image from '@Components/RadixComponents/Image';
// import { motion } from 'framer-motion';
// import forestImage from '@Assets/images/LandingPage/ForestImage.png';

export default function OpenSource() {
  return (
    <section className="open-source-drone naxatw-bg-landing-white naxatw-px-10">
      <div className="naxatw-container !naxatw-max-w-full naxatw-pt-10 md:naxatw-pt-40">
        <FlexColumn className="naxatw-items-center naxatw-gap-10 naxatw-text-center">
          <div>
            <p className="naxatw-text-[2rem] naxatw-leading-[2.688rem] naxatw-text-landing-red md:naxatw-text-[4.375rem] md:naxatw-leading-[5rem]">
              {m.landing_open_source_heading_part_one()}
            </p>
            <p className="naxatw-text-[2rem] naxatw-leading-[2.688rem] naxatw-text-landing-red md:naxatw-text-[4.375rem] md:naxatw-leading-[5rem]">
              {m.landing_brand_name()}
            </p>
          </div>
          <p className="naxatw-w-full naxatw-text-base naxatw-leading-[1.625rem] naxatw-text-landing-grey md:naxatw-w-2/3 md:naxatw-text-xl md:naxatw-leading-7">
            {m.landing_open_source_description()}
          </p>
          {/* <motion.div
            initial={{ translateX: -200, opacity: 0 }}
            whileInView={{ translateX: 0, opacity: 1 }}
            transition={{ duration: 0.7 }}
            viewport={{ once: true }}
          >
            <Image src={forestImage} />
          </motion.div> */}
        </FlexColumn>
      </div>
    </section>
  );
}
