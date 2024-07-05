import {
  Arrow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { FlexColumn } from '@Components/common/Layouts';
import Icon from '../common/Icon';

interface ToolTipProps {
  name: string;
  message?: string;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
  className?: string;
  iconClassName?: string;
  onClick?: () => void;
}

export default function ToolTip({
  name,
  message,
  side = 'left',
  onClick,
  className,
  iconClassName,
}: ToolTipProps) {
  return (
    <FlexColumn
      className={`naxatw-cursor-pointer naxatw-select-none naxatw-items-center naxatw-justify-center ${className}`}
      tabIndex={0}
    >
      <TooltipProvider delayDuration={80} skipDelayDuration={50}>
        <Tooltip>
          <TooltipTrigger onClick={onClick}>
            <Icon
              name={name}
              className={`hover:naxatw-text-primary-400 naxatw-text-grey-500 hover:naxatw-animate-pulse ${iconClassName}`}
            />
          </TooltipTrigger>
          {message && (
            <TooltipContent
              className="data-[state=delayed-open]:data-[side=top]:naxatw-animate-slideDownAndFade data-[state=delayed-open]:data-[side=right]:naxatw-animate-slideLeftAndFade data-[state=delayed-open]:data-[side=left]:naxatw-animate-slideRightAndFade data-[state=delayed-open]:data-[side=bottom]:naxatw-animate-slideUpAndFade naxatw-max-w-xs naxatw-select-none naxatw-rounded naxatw-bg-grey-900 naxatw-px-[15px] naxatw-py-[10px] naxatw-text-sm naxatw-leading-none naxatw-text-white naxatw-shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] naxatw-will-change-[transform,opacity]"
              side={side}
              sideOffset={10}
            >
              {message}
              <Arrow className="fill-white" />
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </FlexColumn>
  );
}
