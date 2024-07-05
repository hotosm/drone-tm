export const containerAnimationVariant = {
  hidden: { opacity: 0, scale: 1 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      delayChildren: 0.3,
      staggerChildren: 0.2,
    },
  },
};

export const fadeUpVariant = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
  },
};

export const slideVariants = {
  hidden: { opacity: 0, y: -1000 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 1, y: -1000 },
};
