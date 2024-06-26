interface IHorizontalLabelProps {
  width: number;
  value: string;
  label: string;
}

export default function HorizontalBarLabel({
  width,
  value,
  label,
}: IHorizontalLabelProps) {
  return (
    <div className="bar naxatw-group naxatw-relative naxatw-h-8 naxatw-w-full">
      <div
        className="fill naxatw-h-full  naxatw-rounded-r-lg naxatw-bg-blue-200 naxatw-bg-opacity-50
         naxatw-transition-all naxatw-duration-500 naxatw-ease-in-out group-hover:naxatw-border "
        style={{ width: `${width}%` }}
      />
      <div className="content naxatw-absolute  naxatw-top-1/2 -naxatw-translate-y-1/2 naxatw-translate-x-2">
        <div className="cover naxatw-flex naxatw-h-full naxatw-items-center naxatw-justify-center naxatw-gap-4">
          <p className="value naxatw-text-sm naxatw-font-semibold naxatw-text-grey-800">
            {value}
          </p>
          <p className="label naxatw-line-clamp-1 naxatw-text-sm naxatw-text-grey-800">
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}
