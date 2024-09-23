const UploadsInformation = ({ data }: { data: Record<string, any>[] }) => {
  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-5">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            Upload Information
          </p>
        </div>

        {data.map(information => (
          <div
            className="naxatw-flex naxatw-w-full naxatw-gap-2"
            key={information?.name}
          >
            <p className="naxatw-w-[6.875rem] naxatw-text-[0.75rem] naxatw-text-[#484848]">
              {information?.name}
            </p>
            <p className="naxatw-text-[0.75rem] naxatw-text-[#484848]">:</p>
            <p className="naxatw-text-[0.75rem] naxatw-text-[#484848]">
              {information?.value}
            </p>
          </div>
        ))}
      </div>
    </>
  );
};
export default UploadsInformation;
