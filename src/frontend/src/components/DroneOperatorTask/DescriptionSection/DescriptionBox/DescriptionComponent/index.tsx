import { v4 as uuidv4 } from 'uuid';

interface IDescriptionBoxComponentProps {
  title: string;
  data: {
    name: string;
    value: string;
  }[];
}
const DescriptionBoxComponent = ({
  title,
  data,
}: IDescriptionBoxComponentProps) => {
  return (
    <>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
        <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
          {title}
        </p>
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
          {data?.map(item => (
            <div
              className="naxatw-flex naxatw-w-full naxatw-gap-2"
              key={uuidv4()}
            >
              <p className="naxatw-w-[6.875rem] naxatw-text-[0.75rem] naxatw-text-[#484848]">
                {item.name}
              </p>
              <p className="naxatw-text-[0.75rem] naxatw-text-[#484848]">:</p>
              <p className="naxatw-text-[0.75rem] naxatw-text-[#484848]">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default DescriptionBoxComponent;
