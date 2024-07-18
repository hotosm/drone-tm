import { useNavigate } from 'react-router-dom';
import { Flex, FlexColumn } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';

export default function DashboardSidebar() {
  const navigate = useNavigate();

  const userDetails = getLocalStorageValue('userprofile');

  return (
    <FlexColumn className="naxatw-col-span-1 naxatw-items-center naxatw-rounded-lg naxatw-border naxatw-border-grey-400 naxatw-bg-white naxatw-p-2.5">
      <Flex className="naxatw-h-20 naxatw-w-20 naxatw-items-center naxatw-justify-center naxatw-overflow-hidden naxatw-rounded-full naxatw-bg-grey-600">
        <img src={userDetails?.img_url} alt="profile" />
      </Flex>
      <h5 className="mt-2.5">{userDetails?.name}</h5>
      <p className="naxatw-text-body-sm">{userDetails?.email}</p>
      <Button
        leftIcon="edit"
        className="naxatw-mt-8 naxatw-border naxatw-border-red !naxatw-text-red"
        onClick={() => navigate('/user-profile')}
      >
        Edit Profile
      </Button>
    </FlexColumn>
  );
}
