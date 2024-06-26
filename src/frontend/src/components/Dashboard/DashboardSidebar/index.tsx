import { useNavigate } from 'react-router-dom';
import { Flex, FlexColumn } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';

export default function DashboardSidebar() {
  const navigate = useNavigate();
  return (
    <FlexColumn className="naxatw-col-span-1 naxatw-items-center naxatw-rounded-lg naxatw-border naxatw-border-grey-400 naxatw-bg-white naxatw-p-2.5">
      <Flex className="naxatw-h-20 naxatw-w-20 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-grey-600">
        <h3>PK</h3>
      </Flex>
      <h5 className="mt-2.5">Kylan Gentry</h5>
      <p className="naxatw-text-body-sm">kylan_gentry22</p>
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
