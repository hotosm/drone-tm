const StatusChip = ({
  color = '#417EC9',
  text = 'Ongoing',
}: {
  color: string;
  text: string;
}) => {
  return (
    <div
      className="naxatw-flex naxatw-items-center naxatw-justify-center naxatw-text-nowrap naxatw-rounded-full naxatw-border naxatw-px-2 naxatw-text-xs naxatw-capitalize"
      style={{ borderColor: color, color }}
    >
      {text}
    </div>
  );
};

export default StatusChip;
