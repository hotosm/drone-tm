import { useTypedSelector } from '@Store/hooks';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import {
  keyParametersInfo,
  keyParamsDescriptions,
} from '@Constants/createProject';

export default function KeyParameters() {
  const keyParamOption = useTypedSelector(
    state => state.createproject.keyParamOption,
  );

  return (
    <div className="">
      {keyParamOption === 'basic' ? (
        keyParametersInfo?.map(info => (
          <div className="naxatw-animate-fade-up naxatw-py-2" key={info.key}>
            <p className="naxatw-text-body-btn">{info.key}</p>
            <p className="naxatw-py-1 naxatw-text-body-md">
              {info.description}
            </p>
          </div>
        ))
      ) : (
        <FlexColumn gap={2} className="naxatw-animate-fade-up">
          {keyParamsDescriptions.map(desc => (
            <FlexRow key={desc.id} className="naxatw-items-center">
              <img src={desc.icon} alt={desc.title} />
              <FlexColumn gap={1}>
                <p className="naxatw-text-body-btn">{desc.title}</p>
                <span className="naxatw-text-body-md">{desc.description}</span>
              </FlexColumn>
            </FlexRow>
          ))}
        </FlexColumn>
      )}
    </div>
  );
}
