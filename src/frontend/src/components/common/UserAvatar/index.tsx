import avatarImage from '@Assets/images/avatar-images.svg';

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
      <img
        src={imageSource}
        alt="profile"
        className="naxatw-h-full naxatw-w-full"
        // @ts-ignore
        onError={({ e }) => {
          e.onerror = null; // prevents looping
          e.src = avatarImage;
        }}
      />
    </div>
  );
}
