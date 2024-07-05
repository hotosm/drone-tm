interface IErrorMessageProp {
  message: string;
}

export default function ErrorMessage({ message }: IErrorMessageProp) {
  return (
    <span
      role="alert"
      className="naxatw-text-red-500 naxatw-px-1 naxatw-pt-2 naxatw-text-sm"
    >
      {message}
    </span>
  );
}
