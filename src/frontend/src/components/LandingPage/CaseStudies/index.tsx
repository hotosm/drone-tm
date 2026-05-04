import { motion } from "framer-motion";
import { containerAnimationVariant, fadeUpVariant } from "@Constants/animations";
import { caseStudiesData } from "@Constants/landingPage";

export default function CaseStudies() {
  return (
    <section className="case-studies naxatw-bg-landing-white naxatw-px-10 naxatw-py-10 md:naxatw-px-0 md:naxatw-py-24">
      <div className="naxatw-container !naxatw-max-w-full">
        <motion.p
          variants={fadeUpVariant}
          initial="hidden"
          whileInView="visible"
          className="naxatw-text-[2rem] naxatw-leading-[3.75rem] naxatw-text-landing-red md:naxatw-text-[3.75rem]"
        >
          Case Studies
        </motion.p>
        <motion.div
          variants={containerAnimationVariant}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="naxatw-mt-10 naxatw-grid naxatw-grid-cols-1 naxatw-gap-6 md:naxatw-grid-cols-3"
        >
          {caseStudiesData.map((data) => (
            <motion.div
              key={data.id}
              variants={fadeUpVariant}
              className="naxatw-flex naxatw-flex-col naxatw-gap-4 naxatw-rounded-xl naxatw-bg-[#F9F3EA] naxatw-px-8 naxatw-py-8 naxatw-duration-200 hover:naxatw-shadow-md"
            >
              <span className="naxatw-w-fit naxatw-rounded-full naxatw-bg-white naxatw-px-3 naxatw-py-1 naxatw-text-xs naxatw-font-medium naxatw-text-landing-red">
                {data.tag}
              </span>
              <p className="naxatw-text-sm naxatw-font-medium naxatw-text-landing-grey naxatw-opacity-60">
                {data.location}
              </p>
              <p className="naxatw-text-[1.25rem] naxatw-font-semibold naxatw-leading-[1.75rem] naxatw-text-landing-grey">
                {data.title}
              </p>
              <p className="naxatw-flex-1 naxatw-text-base naxatw-leading-6 naxatw-text-landing-grey naxatw-opacity-80">
                {data.description}
              </p>
              <a
                href={data.link}
                target="_blank"
                rel="noopener noreferrer"
                className="naxatw-mt-2 naxatw-flex naxatw-w-fit naxatw-items-center naxatw-gap-1 naxatw-text-sm naxatw-font-medium naxatw-text-landing-red hover:naxatw-underline"
              >
                Read full story
                <span className="naxatw-text-base naxatw-leading-none">→</span>
              </a>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
