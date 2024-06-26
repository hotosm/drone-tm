import { useState, useEffect, useCallback, useRef, RefObject } from 'react';

/**
 * A React custom hook that handles click events outside a specific DOM element.
 *
 * Returns a ref, toggle state and a function to handle toggle state.
 *
 * @usage
 * Put the ref on the element.
 * Toggle state to change the display from none to block or vice-versa.
 * Toggle handler on the element to trigger the toggle.
 *
 */
const useOutsideClick = (
  type: 'single' | 'multiple' = 'single',
): [RefObject<HTMLElement | null>, boolean, () => void] => {
  const ref = useRef<HTMLElement | null>(null);
  const [toggle, setToggle] = useState<boolean>(false);

  const onOutsideClick = useCallback((e: MouseEvent) => {
    const inputElement = ref.current;
    if (inputElement && !inputElement.contains(e.target as Node)) {
      setToggle(false);
    }
  }, []);

  useEffect(() => {
    if (toggle) {
      window.addEventListener('click', onOutsideClick);
    } else {
      window.removeEventListener('click', onOutsideClick);
    }

    return () => {
      window.removeEventListener('click', onOutsideClick);
    };
  }, [toggle, onOutsideClick]);

  const handleToggle = () => {
    if (type === 'multiple') {
      setToggle(true);
    } else {
      setToggle(prev => !prev);
    }
  };

  return [ref, toggle, handleToggle];
};

export default useOutsideClick;
