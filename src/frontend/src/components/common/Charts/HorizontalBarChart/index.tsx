import { IChartProps } from '../types';
import HorizontalBarLabel from '../HorizontalBarLabel';
import { calculatePercentageAndInjectValue } from '../utils';

export default function HorizontalBarChart({ data }: IChartProps) {
  const finalData = data
    ? calculatePercentageAndInjectValue(data, 'value')
    : [];
  return (
    <div className="in-label scrollbar naxatw-h-full naxatw-w-full naxatw-overflow-auto">
      <div className="cover naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-2  naxatw-pr-2">
        {finalData?.map((item: any) => (
          <HorizontalBarLabel
            key={item.name}
            width={item?.percentage}
            value={item?.value}
            label={item?.name}
          />
        ))}
      </div>
    </div>
  );
}
