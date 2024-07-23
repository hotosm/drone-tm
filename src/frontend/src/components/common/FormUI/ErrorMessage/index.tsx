interface IErrorMessageProp {
  message: string;
}

export default function ErrorMessage({ message }: IErrorMessageProp) {
  return (
    <span
      role="alert"
      className="naxatw-px-1 naxatw-pt-2 naxatw-text-sm naxatw-text-red"
    >
      {message}
    </span>
  );
}
