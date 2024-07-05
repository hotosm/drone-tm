import { useState, useEffect } from 'react';
import { FlexRow } from '@Components/common/Layouts';
// import Icon from '@Components/common/Icon';
import { motion } from 'framer-motion';
import { userAndRolesData } from '@Constants/landingPage';
import {
  containerAnimationVariant,
  fadeUpVariant,
} from '@Constants/animations';

export default function UserAndRoles() {
  const [itemsToShow, setItemsToShow] = useState(1);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth < 768) {
        setItemsToShow(1);
      } else if (window.innerWidth < 1024) {
        setItemsToShow(2);
      } else {
        setItemsToShow(3);
      }
    }

    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <section className="user-and-roles naxatw-bg-[#F9F3EA]">
      <div className="!naxatw-w-full naxatw-px-[1.25rem] naxatw-py-24 md:naxatw-px-[4.375rem]">
        <motion.p
          variants={fadeUpVariant}
          initial="hidden"
          whileInView="visible"
          className="naxatw-text-center naxatw-text-[2rem] naxatw-leading-[2.66rem] naxatw-text-landing-red md:naxatw-text-[4.375rem]"
        >
          Drone TM: Users & Roles
        </motion.p>
        <FlexRow
          gap={5}
          className="naxatw-mt-20 naxatw-items-center naxatw-justify-between"
        >
          {/* <button
            type="button"
            className="naxatw-flex naxatw-h-12 naxatw-w-12 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-landing-blue naxatw-bg-white hover:naxatw-animate-loader"
            onClick={() => {}}
          >
            <Icon name="west" />
          </button> */}
          <motion.div
            variants={containerAnimationVariant}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="naxatw-mx-auto naxatw-grid naxatw-w-[90%] naxatw-grid-cols-1 naxatw-gap-5 md:naxatw-grid-cols-2 lg:naxatw-grid-cols-3"
          >
            {userAndRolesData.slice(0, itemsToShow).map(singleItem => (
              <motion.div
                key={singleItem.id}
                variants={fadeUpVariant}
                className="naxatw-col-span-1 naxatw-rounded-lg naxatw-bg-white naxatw-px-8 naxatw-py-10 naxatw-text-landing-grey naxatw-duration-200 hover:naxatw-shadow-lg"
              >
                <p className="naxatw-text-[30px] naxatw-leading-[40px]">
                  {singleItem.title}
                </p>
                <ul className="naxatw-ml-6 naxatw-mt-6 naxatw-flex naxatw-list-disc naxatw-flex-col naxatw-gap-4">
                  {singleItem.listItems.map(item => (
                    <li key={item.id}>{item.text}</li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </motion.div>
          {/* <button
            type="button"
            className="naxatw-flex naxatw-h-12 naxatw-w-12 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-border naxatw-border-landing-blue naxatw-bg-white hover:naxatw-animate-loader"
            onClick={() => {}}
          >
            <Icon name="east" />
          </button> */}
        </FlexRow>
      </div>
    </section>
  );
}
