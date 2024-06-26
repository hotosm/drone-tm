/* eslint-disable react/no-array-index-key */
import Skeleton from '@Components/RadixComponents/Skeleton';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';

const numberOfRows = 9;
const numberOfColumns = 6;

export default function TableSkeleton() {
  return (
    <FlexColumn className="naxatw-mt-3 naxatw-h-[72vh] naxatw-rounded-md naxatw-border naxatw-pt-6 naxatw-shadow-lg">
      <FlexRow className="naxatw-items-center naxatw-space-x-20 naxatw-border-b-[1px] naxatw-px-10 naxatw-pb-5 ">
        <Skeleton className="naxatw-h-4 naxatw-w-1/12 xl:naxatw-h-6" />
        {Array.from({ length: numberOfColumns }).map((__, index) => (
          <Skeleton
            key={index}
            className="naxatw-h-4 naxatw-w-1/4 xl:naxatw-h-6"
          />
        ))}
      </FlexRow>
      {Array.from({ length: numberOfRows }).map((_, idx) => (
        <FlexRow
          key={idx}
          className="naxatw-space-x-20 naxatw-border-b-[1px] naxatw-px-10 naxatw-py-3 xl:naxatw-py-4"
        >
          <Skeleton className="naxatw-h-4 naxatw-w-1/12 " />
          {Array.from({ length: numberOfColumns }).map((__, index) => (
            <Skeleton key={index} className="naxatw-h-4 naxatw-w-1/4" />
          ))}
        </FlexRow>
      ))}
    </FlexColumn>
  );
}
