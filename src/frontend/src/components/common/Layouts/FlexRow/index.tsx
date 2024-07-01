/* eslint-disable react/jsx-props-no-spreading */
import { cn } from '@Utils/index';
import { IFlexContainerProps } from '../types';

export default function FlexRow({
  className = '',
  children,
  gap,
  ...rest
}: IFlexContainerProps) {
  return (
    <div
      className={cn(
        `naxatw-flex naxatw-flex-row
      ${className}`,
      )}
      {...rest}
      style={{
        gap: gap ? `${gap * 0.25}rem` : '',
      }}
    >
      {children}
    </div>
  );
}
