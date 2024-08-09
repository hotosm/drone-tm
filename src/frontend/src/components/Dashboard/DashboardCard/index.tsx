import Image from '@Components/RadixComponents/Image';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import graphImage from '@Assets/images/graph.svg';

interface IDashboardCardProps {
  title: string;
  count: number;
  active: boolean;
}

export default function DashboardCard({
  title,
  count,
  active,
}: IDashboardCardProps) {
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
}
