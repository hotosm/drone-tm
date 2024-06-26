import React, { ReactElement } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@Utils/index';

interface IPopoverProps {
  triggerContent?: ReactElement;
  popoverContent?: ReactElement;
  show: boolean;
}

const PopoverRoot = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'end', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        `naxatw-z-50 naxatw-w-64 naxatw-rounded-md naxatw-border naxatw-bg-white naxatw-p-4 naxatw-text-grey-800
        naxatw-shadow-lg naxatw-outline-none data-[state=open]:naxatw-animate-in data-[state=closed]:naxatw-animate-out
        data-[state=closed]:naxatw-fade-out-0 data-[state=open]:naxatw-fade-in-0 data-[state=closed]:naxatw-zoom-out-95
        data-[state=open]:naxatw-zoom-in-95 data-[side=bottom]:naxatw-slide-in-from-top-2 data-[side=left]:naxatw-slide-in-from-right-2
        data-[side=right]:naxatw-slide-in-from-left-2 data-[side=top]:naxatw-slide-in-from-bottom-2`,
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export default function Popover({
  triggerContent,
  popoverContent,
  show,
}: IPopoverProps) {
  return (
    <PopoverRoot open={show}>
      <PopoverTrigger>{triggerContent}</PopoverTrigger>
      <PopoverContent className="naxatw-flex naxatw-flex-col naxatw-gap-4">
        {popoverContent}
      </PopoverContent>
    </PopoverRoot>
  );
}
