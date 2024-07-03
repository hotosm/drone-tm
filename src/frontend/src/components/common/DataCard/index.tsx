import formatNumberWithCommas from '@Utils/formatNumberWithCommas';
import Icon from '@Components/common/Icon';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import { cn } from '@Utils/index';
import RoundedContainer from '../RoundedContainer';

interface DataCardProps {
  title: string;
  count: number;
  iconName: string;
  className?: string;
}

export default function DataCard({
  title,
  count,
  iconName,
  className,
}: DataCardProps) {
  return (
    <RoundedContainer
      className={cn(
        `${className} naxatw-bg-primary-50 naxatw-w-full naxatw-min-w-[180px] naxatw-px-5 naxatw-py-4 naxatw-shadow-md md:!naxatw-h-28`,
      )}
    >
      <FlexColumn>
        <h5>{title}</h5>
        <FlexRow className="naxatw-text-primary-400 naxatw-items-center naxatw-justify-between naxatw-text-[38px] naxatw-font-bold">
          <FlexRow>
            <div>{formatNumberWithCommas(count)}</div>
          </FlexRow>
          <Icon
            name={iconName}
            className="naxatw-text-primary-200 !naxatw-text-[38px]"
          />
        </FlexRow>
      </FlexColumn>
    </RoundedContainer>
  );
}
