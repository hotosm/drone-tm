import Image from '@Components/RadixComponents/Image';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import graphImage from '@Assets/images/graph.svg';

interface IDashboardCardProps {
  title: string;
  value: number;
}

export default function DashboardCard({ title, value }: IDashboardCardProps) {
  return (
    <FlexRow className="naxatw-items-center naxatw-gap-7 naxatw-p-5 naxatw-shadow-lg">
      <Image src={graphImage} />
      <FlexColumn>
        <h2>{value}</h2>
        <p>{title}</p>
      </FlexColumn>
    </FlexRow>
  );
}
