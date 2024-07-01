import { useTypedSelector } from '@Store/hooks';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import { keyParamsDescriptions } from '@Constants/createProject';

export default function KeyParameters() {
  const keyParamOption = useTypedSelector(
    state => state.createproject.keyParamOption,
  );
  return (
    <>
      {keyParamOption === 'basic' ? (
        <div className="naxatw-animate-fade-up naxatw-p-5">
          <p className="naxatw-text-body-btn">
            Ground Sampling Distance (meter)
          </p>
          <p className="naxatw-mt-2 naxatw-text-body-md">
            Fill in your project basic information such as name, description,
            hashtag, etc.
          </p>
        </div>
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
    </>
  );
}
