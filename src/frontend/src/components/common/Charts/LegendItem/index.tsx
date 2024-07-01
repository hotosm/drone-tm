import { ILegendItemProps } from '../types';

export default function LegendItem({ color, name }: ILegendItemProps) {
  return (
    <button
      type="button"
      className="naxatw-flex naxatw-items-center naxatw-justify-center naxatw-gap-2"
    >
      <span
        className="naxatw-h-[16px] naxatw-w-[16px] naxatw-rounded "
        style={{
          background: color,
        }}
      />
      <p className="naxatw-text-sm">{name}</p>
    </button>
  );
}
