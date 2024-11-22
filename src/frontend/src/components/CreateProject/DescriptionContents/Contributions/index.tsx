import { FlexColumn } from '@Components/common/Layouts';
import { contributionsInfo } from '@Constants/createProject';

export default function Contributions() {
  return (
    <FlexColumn gap={2} className="naxatw-animate-fade-up">
      {contributionsInfo?.map(info => (
        <div className="" key={info.key}>
          <p className="naxatw-text-body-btn">{info.key}</p>
          <p className="naxatw-text-body-md">{info.description}</p>
        </div>
      ))}
    </FlexColumn>
  );
}
