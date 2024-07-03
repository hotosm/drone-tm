import React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '@Utils/index';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      `peer focus-visible:naxatw-ring-offset-background naxatw-inline-flex naxatw-h-[16px] naxatw-w-[26px] naxatw-shrink-0 naxatw-cursor-pointer naxatw-items-center naxatw-rounded-full naxatw-border-2 naxatw-border-transparent naxatw-transition-colors focus-visible:naxatw-outline-none focus-visible:naxatw-ring-2 focus-visible:naxatw-ring-offset-2 disabled:naxatw-cursor-not-allowed disabled:naxatw-opacity-50 data-[state=checked]:naxatw-bg-red data-[state=unchecked]:naxatw-bg-[#555555]`,
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        `naxatw-pointer-events-none naxatw-block naxatw-h-3 naxatw-w-3 naxatw-rounded-full naxatw-bg-white naxatw-shadow-lg naxatw-ring-0 naxatw-transition-transform data-[state=checked]:naxatw-translate-x-2.5 data-[state=unchecked]:naxatw-translate-x-0`,
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export default Switch;
