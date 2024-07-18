import { useEffect, useRef, useState } from 'react';

type ValueType = string | number | null;

export default function useDebounceListner(value: ValueType, delay = 500) {
  const [debouncedValue, setDebouncedValue] = useState<ValueType>(value);
  const timerRef = useRef<null | ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedValue(value), delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay]);

  return debouncedValue;
}
