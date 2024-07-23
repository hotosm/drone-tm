interface IUserAvatarProps {
  className?: string;
  imageSource?: string;
}

export default function UserAvatar({
  className,
  imageSource,
}: IUserAvatarProps) {
  return (
    <div
      className={`naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-red naxatw-text-body-md naxatw-font-semibold naxatw-capitalize naxatw-text-white ${className}`}
    >
      <img src={imageSource} alt="profile" />
    </div>
  );
}
