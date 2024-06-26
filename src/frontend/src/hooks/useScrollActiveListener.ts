/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
import { useCallback, useEffect } from 'react';

function debounce(func: Function, timeout = 300) {
  let timer: any;
  return (arg: any) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func(arg);
    }, timeout);
  };
}

interface IUseScrollActiveListenerProps {
  sectionRefs: Record<string, any>;
  onChange: (key: string) => void;
}

export default function useScrollActiveListener({
  sectionRefs,
  onChange,
}: IUseScrollActiveListenerProps) {
  const handleScroll = useCallback(
    debounce(() => {
      Object.entries(sectionRefs.current).forEach(([key, section]) => {
        // @ts-ignore
        const elementPosition = section.getBoundingClientRect().top;
        if (elementPosition < 200) {
          onChange(key);
        }
      });
    }, 50),
    [], // eslint-disable-line
  );

  useEffect(() => {
    document.addEventListener('scroll', handleScroll);
    return () => {
      document.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);
  return null;
}
