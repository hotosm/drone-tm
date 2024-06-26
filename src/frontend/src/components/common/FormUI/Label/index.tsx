import { ReactNode } from 'react';

interface ILabelProps {
  children: ReactNode;
  htmlFor?: string | number;
  required?: boolean;
}

export default function Label({ children, htmlFor, required }: ILabelProps) {
  return (
    <label
      className="naxatw-text-body-btn naxatw-text-grey-800"
      htmlFor={htmlFor?.toString()}
    >
      {children}
      {required && <span className="naxatw-ml-[2px] naxatw-text-red">*</span>}
    </label>
  );
}
