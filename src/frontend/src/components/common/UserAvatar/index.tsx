interface IUserAvatarProps {
  name: string;
  className?: string;
}

export default function UserAvatar({ name, className }: IUserAvatarProps) {
  const nameParts = name?.split(' ');
  const firstNameInitial = nameParts?.[0] ? nameParts?.[0][0] : '';

  return (
    <div
      className={`naxatw-flex naxatw-h-8 naxatw-w-8 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-red naxatw-text-body-md naxatw-font-semibold naxatw-capitalize naxatw-text-white ${className}`}
    >
      {firstNameInitial || '-'}
    </div>
  );
}
