import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { UserProfileHeader } from '@Components/UserProfile';
import { useForm } from 'react-hook-form';
import { tabOptions } from '@Constants/index';
import { setCommonState } from '@Store/actions/common';
import { Button } from '@Components/RadixComponents/Button';
import {
  BasicDetails,
  OrganizationDetails,
  // PasswordSection,
} from '@Components/UserProfile/FormContents';
import { useMutation } from '@tanstack/react-query';
import { postUserProfile } from '@Services/common';
import { IUserProfileDetailsType } from '@Components/GoogleAuth';
import Tab from './UserProfileTabs';

const getActiveFormContent = (activeTab: number, formProps: any) => {
  switch (activeTab) {
    case 1:
      return <BasicDetails formProps={formProps} />;
    case 2:
      return <OrganizationDetails formProps={formProps} />;
    // case 3:
    //   return <PasswordSection formProps={formProps} />;
    default:
      return <></>;
  }
};

export default function UserProfile() {
  const dispatch = useTypedDispatch();

  const userProfileActiveTab = useTypedSelector(
    state => state.common.userProfileActiveTab,
  );
  const userProfile = localStorage.getItem(
    'userprofile',
  ) as IUserProfileDetailsType;

  const initialState = {
    name: null,
    country: null,
    city: null,
    organization_name: null,
    organization_address: null,
    job_title: null,
    password: null,
    confirm_password: null,
  };

  const { register, setValue, handleSubmit, formState } = useForm({
    defaultValues: initialState,
  });

  const formProps = {
    register,
    setValue,
    formState,
  };

  const { mutate: updateUserProfile } = useMutation<any, any, any, unknown>({
    mutationFn: postUserProfile,
    onSuccess: () => {
      alert('updated');
      // toast.success('UserProfile Updated Successfully');
    },
    onError: err => {
      // eslint-disable-next-line no-console
      console.log(err);
      // toast.error(err.message);
    },
  });

  const onSubmit = (data: any) => {
    updateUserProfile(userProfile?.id, data);
    // if (userProfileActiveTab < 3) return;
    // createProject(data);
    // reset();
    // alert('test');
  };
  const onNextBtnClick = () => {
    handleSubmit(onSubmit)();
    if (Object.keys(formState.errors).length > 0) return;
    if (userProfileActiveTab === 2) return;
    dispatch(
      setCommonState({ userProfileActiveTab: userProfileActiveTab + 1 }),
    );
  };
  const onBackBtnClick = () => {
    if (userProfileActiveTab === 1) return;
    dispatch(
      setCommonState({ userProfileActiveTab: userProfileActiveTab - 1 }),
    );
  };

  return (
    <section className="naxatw-h-screen-nav naxatw-bg-grey-50 naxatw-px-16 naxatw-pt-8">
      <UserProfileHeader />
      <section className="naxatw-mt-5 naxatw-bg-grey-50 naxatw-px-80">
        <div className="naxatw-grid naxatw-h-[35rem] naxatw-grid-cols-3 naxatw-gap-14 naxatw-bg-white naxatw-py-5">
          <div className="naxatw-col-span-1">
            <Tab
              onTabChange={info => {
                dispatch(setCommonState({ userProfileActiveTab: info }));
              }}
              tabOptions={tabOptions}
              activeTab={userProfileActiveTab}
            />
          </div>
          <div className="naxatw-relative naxatw-col-span-2">
            {getActiveFormContent(userProfileActiveTab, formProps)}
            {userProfileActiveTab !== 1 && (
              <Button
                className="naxatw-absolute naxatw-bottom-4 naxatw-left-4 naxatw-bg-red"
                leftIcon="chevron_left"
                onClick={onBackBtnClick}
              >
                Back
              </Button>
            )}
            <Button
              className="naxatw-absolute naxatw-bottom-4 naxatw-right-4 naxatw-bg-red"
              rightIcon={
                userProfileActiveTab !== 2 ? 'chevron_right' : undefined
              }
              onClick={onNextBtnClick}
            >
              {userProfileActiveTab === 2 ? 'Complete Profile' : 'Next'}
            </Button>
          </div>
        </div>
      </section>
    </section>
  );
}
