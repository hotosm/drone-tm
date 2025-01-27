interface IProgressBarProps {
  heading?: string;
  successCount?: number;
  totalCount?: number;
}

const ProgressBar = ({
  heading = 'Uploading',
  successCount = 0,
  totalCount = 100,
}: IProgressBarProps) => {
  const fillWidth = (successCount / totalCount) * 100;
  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
      <div className="naxatw-flex naxatw-flex-col naxatw-items-start naxatw-self-stretch">
        <p className="naxatw-flex naxatw-items-center naxatw-justify-start naxatw-gap-2 naxatw-text-[1.0625rem] naxatw-font-bold naxatw-leading-normal">
          {heading}
        </p>
      </div>
      <div className="naxatw naxatw-flex naxatw-flex-col naxatw-items-start naxatw-gap-1 naxatw-self-stretch">
        <p className="naxatw-text-[0.875rem] naxatw-text-[#7A7676]">
          {totalCount === successCount && totalCount !== 0 ? (
            <></>
          ) : (
            `${successCount} / ${totalCount} Completed`
          )}
        </p>
        <div className="naxatw-h-[0.75rem] naxatw-w-full naxatw-rounded-3xl naxatw-bg-gray-300">
          <div
            className={`naxatw-h-[0.75rem] naxatw-animate-pulse naxatw-bg-[#D73F3F] ${fillWidth === 100 ? 'naxatw-rounded-3xl' : 'naxatw-rounded-l-3xl'} naxatw-transition-all`}
            style={{ width: `${fillWidth}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;
