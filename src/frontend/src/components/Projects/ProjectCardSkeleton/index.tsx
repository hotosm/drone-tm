import Skeleton from '@Components/RadixComponents/Skeleton';

export default function ProjectCardSkeleton() {
  return (
    <Skeleton className="!naxatw-col-span-1 naxatw-max-h-[19.25rem] naxatw-w-[13.5rem] naxatw-cursor-pointer naxatw-rounded-md naxatw-border naxatw-border-grey-400 naxatw-p-[0.625rem] hover:naxatw-shadow-lg">
      <Skeleton className="naxatw-h-[10rem] naxatw-bg-grey-50" />
      <Skeleton className="naxatw-mt-2 naxatw-h-[20px] naxatw-w-1/2 naxatw-bg-grey-50" />
      <Skeleton className="naxatw-mt-2 naxatw-h-[30px] naxatw-bg-grey-50" />
    </Skeleton>
  );
}
