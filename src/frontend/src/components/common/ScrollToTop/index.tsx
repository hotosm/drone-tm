import React, { useState, useEffect } from 'react';

const ScrollToTop: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const toggleVisibility = () => {
      const playgroundElement = document.getElementById('app_playground');
      if (playgroundElement && playgroundElement?.scrollTop > 400) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    const playgroundElement = document.getElementById('app_playground');
    playgroundElement?.addEventListener('scroll', toggleVisibility);

    return () => {
      playgroundElement?.removeEventListener('scroll', toggleVisibility);
    };
  }, []);

  const scrollToTop = () => {
    const playgroundElement = document.getElementById('app_playground');
    playgroundElement?.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  return (
    <div
      className={`naxatw-fixed naxatw-bottom-4 naxatw-right-6 naxatw-z-40 naxatw-animate-bounce ${
        isVisible ? 'naxatw-opacity-100' : 'naxatw-hidden naxatw-opacity-0'
      }`}
    >
      <button
        type="button"
        className="hover:naxatw-bg-teal-green-600 naxatw-h-10 naxatw-w-10 naxatw-rounded-full naxatw-bg-red naxatw-p-2 naxatw-font-bold naxatw-text-white naxatw-shadow"
        onClick={scrollToTop}
      >
        <i className="material-icons">arrow_upward</i>
      </button>
    </div>
  );
};

export default ScrollToTop;
