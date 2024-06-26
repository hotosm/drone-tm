import { FlexRow } from '@Components/common/Layouts';

export default function UserProfileHeader() {
  return (
    <FlexRow className="naxatw-mb-4 naxatw-py-3" gap={2}>
      <p className="naxatw-text-body-md">Profile /</p>
      <span className="naxatw-text-body-btn">Edit Profile</span>
    </FlexRow>
  );
}
