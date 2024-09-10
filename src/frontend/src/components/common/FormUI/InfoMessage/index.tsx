interface IInfoMessageProp {
  message: string;
}

const InfoMessage = ({ message }: IInfoMessageProp) => {
  return (
    <span
      role="alert"
      className="naxatw-px-1 naxatw-pt-0 naxatw-text-sm naxatw-text-[#17A2B8]"
    >
      {message}
    </span>
  );
};

export default InfoMessage;
