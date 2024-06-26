import { FlexColumn } from '@Components/common/Layouts';
import NoDataImage from '@Assets/images/no-data.png';

export default function NoDataComponent() {
  return (
    <div className="naxatw-flex naxatw-h-[220px] naxatw-w-full naxatw-items-center naxatw-justify-center">
      <FlexColumn className="naxatw-gap-3">
        <img src={NoDataImage} alt="No Data" height={100} width={100} />
        <h6>No Data Available</h6>
      </FlexColumn>
    </div>
  );
}
