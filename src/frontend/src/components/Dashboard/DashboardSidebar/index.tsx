import { useNavigate } from 'react-router-dom';
import { Flex, FlexColumn, FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const DashboardSidebar = () => {
  const navigate = useNavigate();

  const userDetails = getLocalStorageValue('userprofile');
  return (
    <FlexColumn className="w-naxatw-w-full naxatw-items-center naxatw-rounded-lg naxatw-border naxatw-border-grey-400 naxatw-bg-white naxatw-p-2.5 md:naxatw-min-h-[37.188rem]">
      <Flex className="naxatw-h-20 naxatw-w-20 naxatw-items-center naxatw-justify-center naxatw-overflow-hidden naxatw-rounded-full naxatw-bg-grey-600">
        <img src={userDetails?.profile_img} alt="profile" />
      </Flex>
      <h5 className="mt-2.5">{userDetails?.name}</h5>
      <p className="naxatw-text-body-sm">{userDetails?.email_address}</p>
      <Button
        leftIcon="edit"
        className="naxatw-mt-8 naxatw-border naxatw-border-red !naxatw-text-red"
        onClick={() => navigate('/user-profile')}
      >
        Edit Profile
      </Button>
      <FlexColumn className="naxatw-my-5 naxatw-w-full naxatw-gap-2">
        <FlexRow className="naxatw-justify-center naxatw-gap-1 md:naxatw-justify-normal">
          <p className="md:naxatw-min-w-[30%]">Name</p>:
          <p className="naxatw-break-words md:naxatw-min-w-[65%]">
            {userDetails?.name}
          </p>
        </FlexRow>
        <FlexRow className="naxatw-justify-center naxatw-gap-1 md:naxatw-justify-normal">
          <p className="md:naxatw-min-w-[30%]">Email</p>:
          <p className="naxatw-break-words md:naxatw-min-w-[65%]">
            {userDetails?.email_address}
          </p>
        </FlexRow>
      </FlexColumn>
    </FlexColumn>
  );
};

export default hasErrorBoundary(DashboardSidebar);
