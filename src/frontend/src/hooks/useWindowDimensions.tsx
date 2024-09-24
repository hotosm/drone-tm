import { useState, useEffect } from 'react';

function debounce(func: Function, timeout = 300) {
  let timer: any;
  return (arg: any) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func(arg);
    }, timeout);
  };
}

const useWindowDimensions = () => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const handleResize = debounce(() => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }, 100);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return dimensions;
};

export default useWindowDimensions;
