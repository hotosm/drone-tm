import { cn } from '@Utils/index';

export default function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'naxatw-animate-pulse naxatw-rounded-[4.5px] naxatw-bg-grey-300',
        className,
      )}
      {...props}
    />
  );
}
