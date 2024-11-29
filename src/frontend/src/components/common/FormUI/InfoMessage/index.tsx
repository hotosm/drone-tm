interface IInfoMessageProp {
  message: string;
  className?: string;
}

const InfoMessage = ({ message, className }: IInfoMessageProp) => {
  return (
    <span
      role="alert"
      className={`naxatw-px-1 naxatw-pt-0 naxatw-text-sm naxatw-text-[#17A2B8] ${className}`}
    >
      {message}
    </span>
  );
};

export default InfoMessage;
