import { FlexColumn } from '@Components/common/Layouts';
import { DefineAOIInfo } from '@Constants/createProject';

export default function DefineAOI() {
  return (
    <FlexColumn gap={2} className="naxatw-animate-fade-up">
      {DefineAOIInfo?.map(info => (
        <div className="" key={info.key}>
          <p className="naxatw-text-body-btn">{info.key}</p>
          <p className="naxatw-text-body-md">{info.description}</p>
        </div>
      ))}
    </FlexColumn>
  );
}
