import * as React from 'react';
import { cn } from '@Utils/index';

export interface IInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, IInputProps>(
  ({ className, placeholder, type, ...rest }, ref) => {
    return (
      <input
        type={type}
        placeholder={placeholder || 'Search'}
        className={cn(
          `naxatw-flex naxatw-rounded-[4px] naxatw-border naxatw-border-[#555555] naxatw-bg-transparent naxatw-p-2 naxatw-text-body-md file:naxatw-font-medium hover:naxatw-border-red focus:naxatw-border-red focus:naxatw-bg-transparent focus:naxatw-outline-none disabled:naxatw-cursor-not-allowed`,
          className,
        )}
        ref={ref}
        {...rest}
      />
    );
  },
);
Input.displayName = 'Input';

export default Input;
