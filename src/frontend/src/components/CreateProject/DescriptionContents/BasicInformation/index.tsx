import { FlexColumn } from '@Components/common/Layouts';

export default function BasicInformation() {
  return (
    <FlexColumn gap={2} className="naxatw-animate-fade-up">
      <div className="">
        <p className="naxatw-text-body-btn">Basic Information</p>
        <p className="naxatw-text-body-md">
          Fill in your basic project information such as name and description
        </p>
      </div>
    </FlexColumn>
  );
}
