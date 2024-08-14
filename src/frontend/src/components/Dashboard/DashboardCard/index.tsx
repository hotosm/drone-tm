import Image from '@Components/RadixComponents/Image';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import graphImage from '@Assets/images/graph.svg';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

interface IDashboardCardProps {
  title: string;
  count: number;
  active: boolean;
}

export const DashboardCardSkeleton = () => {
  return (
    <div className="naxatw-flex naxatw-h-[130px] naxatw-w-full naxatw-animate-pulse naxatw-items-center naxatw-gap-3 naxatw-rounded-xl naxatw-bg-gray-200 naxatw-px-2">
      <div className="naxatw-h-10 naxatw-w-10 naxatw-rounded-full naxatw-bg-gray-300" />
      <div className="naxatw-flex naxatw-w-[140px] naxatw-flex-col naxatw-gap-2">
        <div className="naxatw-h-9 naxatw-w-[50px] naxatw-bg-gray-300" />
        <div className="naxatw-h-5 naxatw-w-full naxatw-bg-gray-300" />
      </div>
    </div>
  );
};

const DashboardCard = ({ title, count, active }: IDashboardCardProps) => {
  return (
    <FlexRow
      className={`naxatw-items-center naxatw-gap-7 naxatw-rounded-lg naxatw-border naxatw-p-5 naxatw-shadow-lg hover:naxatw-border-[#D73F3F] ${active ? 'naxatw-border-[#D73F3F]' : ''}`}
    >
      <Image src={graphImage} />
      <FlexColumn>
        <h2>{count}</h2>
        <p>{title}</p>
      </FlexColumn>
    </FlexRow>
  );
};

export default hasErrorBoundary(DashboardCard);
