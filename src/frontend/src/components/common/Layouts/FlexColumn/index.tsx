/* eslint-disable react/jsx-props-no-spreading */
import { cn } from '@Utils/index';
import { IFlexContainerProps } from '../types';

export default function FlexColumn({
  className = '',
  children,
  gap,
  ...rest
}: IFlexContainerProps) {
  return (
    <div
      className={cn(`naxatw-flex naxatw-flex-col ${className}`)}
      style={{
        gap: gap ? `${gap * 0.25}rem` : '',
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
