interface TaskLogsProps {
  title: string;
}

const TaskLogs = ({ title }: TaskLogsProps) => {
  return (
    <div className="naxatw-mt-8 naxatw-flex-col">
      <h4 className="naxatw-py-2 naxatw-text-base naxatw-font-bold naxatw-text-gray-800">
        {title}
      </h4>
      {/* <FlexColumn className="naxatw-max-h-[24.4rem] naxatw-gap-2 naxatw-overflow-y-auto"></FlexColumn> */}
    </div>
  );
};

export default TaskLogs;
