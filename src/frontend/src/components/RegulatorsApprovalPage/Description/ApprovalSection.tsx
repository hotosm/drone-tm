import { Button } from '@Components/RadixComponents/Button';

const ApprovalSection = () => {
  return (
    <>
      {' '}
      <div className="naxatw-mt-6 naxatw-flex naxatw-flex-col naxatw-gap-1">
        <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem]">
          Comment
        </p>
        <textarea
          placeholder="Comment"
          name=""
          id=""
          cols={4}
          className="naxatw-w-full naxatw-rounded-md naxatw-border naxatw-border-gray-800 naxatw-p-1"
        />
      </div>
      <div className="naxatw-flex naxatw-items-start naxatw-justify-start naxatw-gap-2">
        <Button
          variant="outline"
          className="naxatw-border-red naxatw-font-primary naxatw-text-red"
        >
          Reject
        </Button>
        <Button
          variant="ghost"
          className="naxatw-bg-red naxatw-font-primary naxatw-text-white"
        >
          Accept
        </Button>
      </div>{' '}
    </>
  );
};

export default ApprovalSection;
