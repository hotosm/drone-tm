/* eslint-disable react/display-name */
import { HtmlHTMLAttributes, ReactNode, forwardRef } from 'react';

interface IRoundedContainerProps extends HtmlHTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  ref?: React.RefObject<HTMLDivElement>;
}

const RoundedContainer = forwardRef<HTMLDivElement, IRoundedContainerProps>(
  ({ children, className, ...restProps }, ref) => {
    return (
      <div
        ref={ref}
        className={`naxatw-h-fit naxatw-w-fit naxatw-rounded-xl naxatw-border-[0.5px] naxatw-transition-all naxatw-duration-200 ${className}`}
        {...restProps}
      >
        {children}
      </div>
    );
  },
);

export default RoundedContainer;
