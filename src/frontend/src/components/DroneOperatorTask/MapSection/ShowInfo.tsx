interface IShowInfo {
  heading?: string;
  message: string;
  wrapperClassName?: string;
  className?: string;
}

const ShowInfo = ({
  message,
  className,
  heading,
  wrapperClassName,
}: IShowInfo) => {
  return (
    <div
      className={`naxatw-absolute naxatw-left-[calc(50%-7.5rem)] naxatw-top-2 naxatw-z-30 naxatw-w-[15rem] naxatw-rounded-lg naxatw-bg-white naxatw-p-2 naxatw-shadow-xl ${wrapperClassName}`}
    >
      <div className="naxatw-flex naxatw-items-center naxatw-gap-1">
        <i className="material-icons-outlined naxatw-text-base">info</i>{' '}
        <h6 className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-600">
          {heading}
        </h6>
      </div>
      <div className={`naxatw-text-xs naxatw-text-gray-500 ${className}`}>
        {message}
      </div>
    </div>
  );
};

export default ShowInfo;
