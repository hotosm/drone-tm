import { useDispatch } from 'react-redux';
import { setCommonState } from '@Store/actions/common';
import { useTypedSelector } from '@Store/hooks';
import Tab from '@Components/common/Tabs';
import BasicDetails from '@Components/UpdateUserDetails/BasicDetails.tsx';
import Header from '@Components/UpdateUserDetails/Header';
import OrganizationDetails from '@Components/UpdateUserDetails/OrganizationDetails';
import OtherDetails from '@Components/UpdateUserDetails/OtherDetails';
import Password from '@Components/UpdateUserDetails/Password';
import { tabOptions } from '@Constants/index';
import useWindowDimensions from '@Hooks/useWindowDimensions';

const getActiveFormContent = (activeTab: number, userType: string) => {
  switch (activeTab) {
    case 1:
      return <BasicDetails />;
    case 2:
      return userType === 'PROJECT_CREATOR' ? (
        <OrganizationDetails />
      ) : (
        <OtherDetails />
      );
    case 3:
      return <Password />;
    default:
      return <></>;
  }
};

const UpdateUserProfile = () => {
  const dispatch = useDispatch();
  const { width } = useWindowDimensions();

  const userProfileActiveTab = useTypedSelector(
    state => state.common.userProfileActiveTab,
  );
  const signedInAs = localStorage.getItem('signedInAs') || 'PROJECT_CREATOR';

  return (
    <div className="main-content naxatw-w-full naxatw-flex-col naxatw-gap-3 md:naxatw-bg-gray-50">
      <div className="naxatw-flex naxatw-h-full naxatw-flex-col md:naxatw-px-20">
        <div className="naxatw-py-3">
          <Header />
        </div>
        <div className="naxatw-flex naxatw-h-full naxatw-w-full naxatw-items-center naxatw-justify-center md:naxatw-pb-16">
          <div className="naxatw-flex naxatw-h-[calc(100vh-200px)] naxatw-min-h-[300px] naxatw-w-full naxatw-max-w-[34rem] naxatw-flex-col naxatw-overflow-y-auto naxatw-bg-white naxatw-shadow-2xl md:naxatw-flex-row">
            <div className="naxatw-h-fit naxatw-w-full naxatw-border-r md:naxatw-h-full md:naxatw-w-2/6">
              <Tab
                className="naxatw-w-full naxatw-border-b"
                orientation={width < 768 ? 'row' : 'column'}
                clickable
                onTabChange={data => {
                  dispatch(
                    setCommonState({ userProfileActiveTab: Number(data) }),
                  );
                }}
                tabOptions={tabOptions}
                activeTab={userProfileActiveTab}
              />
            </div>
            <div className="naxatw-h-full naxatw-w-full md:naxatw-w-4/6">
              <div className="naxatw-flex naxatw-h-full naxatw-w-full naxatw-overflow-y-auto naxatw-py-2">
                {getActiveFormContent(userProfileActiveTab, signedInAs)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpdateUserProfile;
