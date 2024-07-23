import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { useNavigate } from 'react-router-dom';
import { UserProfileHeader } from '@Components/UserProfile';
import { useForm } from 'react-hook-form';
import {
  BasicDetails,
  OrganizationDetails,
  OtherDetails,
  PasswordSection,
} from '@Components/UserProfile/FormContents';
import {
  tabOptions,
  projectCreatorKeys,
  droneOperatorKeys,
} from '@Constants/index';
import { setCommonState } from '@Store/actions/common';
import { Button } from '@Components/RadixComponents/Button';
import { useMutation } from '@tanstack/react-query';
import { postUserProfile } from '@Services/common';
import { toast } from 'react-toastify';
import { removeKeysFromObject } from '@Utils/index';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';
import Tab from '@Components/common/Tabs';

const getActiveFormContent = (
  activeTab: number,
  userType: string,
  formProps: any,
) => {
  switch (activeTab) {
    case 1:
      return <BasicDetails formProps={formProps} />;
    case 2:
      return userType === 'Project Creator' ? (
        <OrganizationDetails formProps={formProps} />
      ) : (
        <OtherDetails formProps={formProps} />
      );
    case 3:
      return <PasswordSection formProps={formProps} />;
    default:
      return <></>;
  }
};

export default function UserProfile() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();

  const signedInAs = localStorage.getItem('signedInAs') || 'Project Creator';
  const isDroneOperator =
    localStorage.getItem('signedInAs') === 'Drone Operator';

  const userProfileActiveTab = useTypedSelector(
    state => state.common.userProfileActiveTab,
  );

  const userProfile = getLocalStorageValue('userprofile');

  const initialState = {
    name: '',
    country: '',
    city: null,
    password: null,
    confirm_password: null,
    phone_number: null,
    // for project creators
    organization_name: null,
    organization_address: null,
    job_title: null,
    // for drone operators
    notify_for_projects_within_km: null,
    experience_years: null,
    certified_drone_operator: false,
    drone_you_own: null,
    role: isDroneOperator ? 2 : 1,
  };

  const { register, setValue, handleSubmit, formState, control } = useForm({
    defaultValues: initialState,
  });

  const formProps = {
    register,
    setValue,
    formState,
    control,
  };

  const { mutate: updateUserProfile } = useMutation<any, any, any, unknown>({
    mutationFn: payloadDataObject => postUserProfile(payloadDataObject),
    onSuccess: () => {
      toast.success('UserProfile Updated Successfully');
      navigate('/projects');
    },
    onError: err => {
      // eslint-disable-next-line no-console
      console.log(err);
    },
  });

  const onSubmit = (formData: Record<string, any>) => {
    if (userProfileActiveTab !== 3) {
      dispatch(
        setCommonState({ userProfileActiveTab: userProfileActiveTab + 1 }),
      );
      return;
    }
    const finalFormData = isDroneOperator
      ? removeKeysFromObject(formData, projectCreatorKeys)
      : removeKeysFromObject(formData, droneOperatorKeys);
    updateUserProfile({ userId: userProfile?.id, data: finalFormData });
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
      <section className="naxatw-mt-5 naxatw-bg-grey-50 naxatw-px-5 xl:naxatw-px-20 2xl:naxatw-px-60">
        <div className="naxatw-grid naxatw-h-[38rem] naxatw-grid-cols-3 naxatw-gap-14 naxatw-bg-white naxatw-py-5">
          <div className="naxatw-col-span-1">
            <Tab
              orientation="column"
              onTabChange={() => {}}
              tabOptions={tabOptions}
              activeTab={userProfileActiveTab}
            />
          </div>
          <div className="naxatw-relative naxatw-col-span-2">
            {getActiveFormContent(userProfileActiveTab, signedInAs, formProps)}
            {userProfileActiveTab !== 1 && (
              <Button
                variant="ghost"
                className="naxatw-absolute naxatw-bottom-0 naxatw-left-[3.75rem] naxatw-border naxatw-border-red naxatw-text-red"
                leftIcon="chevron_left"
                onClick={onBackBtnClick}
              >
                Previous
              </Button>
            )}
            <Button
              className="naxatw-absolute naxatw-bottom-0 naxatw-right-[3.75rem] naxatw-bg-red"
              rightIcon={
                userProfileActiveTab !== 3 ? 'chevron_right' : undefined
              }
              onClick={e => {
                e.preventDefault();
                handleSubmit(onSubmit)();
              }}
              withLoader
            >
              {userProfileActiveTab === 3 ? 'Complete Profile' : 'Next'}
            </Button>
          </div>
        </div>
      </section>
    </section>
  );
}
