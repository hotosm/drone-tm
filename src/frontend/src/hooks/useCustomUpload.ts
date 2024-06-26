import { useRef } from 'react';

/**
 *
 * A React custom hook that allows to use custom input field for file upload.
 *
 * Returns a ref and a click handler to trigger the file input.
 *
 * @usage
 * Put the ref on hidden input element and the clickhandler on custom element.
 *
 */
const useCustomUpload = () => {
  const inputRef = useRef<null | HTMLInputElement>(null);

  const onClick = (): void => {
    inputRef?.current?.click();
  };

  return [inputRef, onClick];
};

export default useCustomUpload;
