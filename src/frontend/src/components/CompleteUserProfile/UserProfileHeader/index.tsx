import { FlexRow } from '@Components/common/Layouts';
import { Link } from 'react-router-dom';

export default function UserProfileHeader() {
  return (
    <FlexRow className="naxatw-mb-4 naxatw-py-3" gap={2}>
      <Link to="/projects">
        <p className="naxatw-text-body-md">Profile /</p>
      </Link>
      <span className="naxatw-text-body-btn">Edit Profile</span>
    </FlexRow>
  );
}
