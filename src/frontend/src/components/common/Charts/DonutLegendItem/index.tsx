import { IDonutLegendItemProps } from '../types';

export default function DonutLegendItem({
  color,
  name,
  percentage,
}: IDonutLegendItemProps) {
  return (
    <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-text-sm naxatw-text-grey-800">
      <div className="legend-box-name naxatw-justify-items naxatw-flex naxatw-flex-grow naxatw-items-center naxatw-gap-2">
        <div
          className="naxatw-min-h-[14px] naxatw-min-w-[14px] naxatw-rounded"
          style={{
            backgroundColor: color,
          }}
        />
        <div className="name naxatw-button naxatw-text-start naxatw-font-normal">
          {name}
        </div>
      </div>
      <div className="value-percentage naxatw-flex naxatw-min-w-[2rem] naxatw-items-center naxatw-justify-end naxatw-gap-2 naxatw-font-bold">
        <div className="naxatw-button naxatw-min-w-[60px] naxatw-max-w-[60px] naxatw-whitespace-nowrap naxatw-text-start">
          {Number(percentage)?.toFixed(1)} %
        </div>
      </div>
    </div>
  );
}
