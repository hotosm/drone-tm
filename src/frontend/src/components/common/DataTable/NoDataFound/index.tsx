import { FlexColumn } from '@Components/common/Layouts';
import NoDataImage from '@Assets/images/no-data.png';

interface INoDataComponent {
  className?: string;
  message?: string;
  messageStyles?: string;
  isExport?: boolean;
  iconClassName?: string;
}

export default function NoDataComponent({
  className,
  message,
  messageStyles,
  isExport = false,
  iconClassName,
}: INoDataComponent) {
  return (
    <div
      className={`${className} naxatw-flex naxatw-h-full naxatw-min-h-[150px] naxatw-w-full naxatw-items-center naxatw-justify-center naxatw-rounded-lg `}
    >
      <FlexColumn
        className={`${isExport ? 'naxatw-h-full naxatw-justify-center naxatw-gap-1' : ' naxatw-gap-3'}  `}
      >
        <img
          src={NoDataImage}
          alt="No Data"
          height={100}
          width={100}
          className={`naxatw-mx-auto naxatw-w-full ${iconClassName}`}
        />
        <h6
          className={`naxatw-text-center ${isExport ? 'fs-xs-medium' : ''}  ${messageStyles}`}
        >
          {message || 'No Data Available'}
        </h6>
      </FlexColumn>
    </div>
  );
}
