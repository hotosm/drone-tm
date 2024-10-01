import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { useNavigate } from 'react-router-dom';
import { UserProfileHeader } from '@Components/CompleteUserProfile';
import { useForm } from 'react-hook-form';
import {
  BasicDetails,
  OrganizationDetails,
  OtherDetails,
  PasswordSection,
} from '@Components/CompleteUserProfile/FormContents';
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
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import useWindowDimensions from '@Hooks/useWindowDimensions';

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

const CompleteUserProfile = () => {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const { width } = useWindowDimensions();
  const signedInAs = localStorage.getItem('signedInAs') || 'Project Creator';
  const isDroneOperator =
    localStorage.getItem('signedInAs') === 'Drone Operator';

  const userProfileActiveTab = useTypedSelector(
    state => state.common.userProfileActiveTab,
  );
  const userProfile = getLocalStorageValue('userprofile');

  const initialState = {
    name: userProfile?.name,
    country: userProfile?.country || null,
    city: userProfile?.city || null,
    password: null,
    confirm_password: null,
    // country_code: userProfile?.country_code || null,
    phone_number: userProfile?.phone_number || null,
    // for project creators
    organization_name: userProfile?.organization_name || null,
    organization_address: userProfile?.organization_address || null,
    job_title: userProfile?.job_title || null,
    // for drone operators
    notify_for_projects_within_km: null,
    experience_years: null,
    certified_drone_operator: false,
    drone_you_own: null,
    role: isDroneOperator ? 2 : 1,
  };

  const { register, setValue, handleSubmit, formState, control, watch } =
    useForm({
      defaultValues: initialState,
    });

  const formProps = {
    register,
    setValue,
    formState,
    control,
    watch,
  };

  const { mutate: updateUserProfile } = useMutation<any, any, any, unknown>({
    mutationFn: payloadDataObject => postUserProfile(payloadDataObject),
    onSuccess: () => {
      toast.success('UserProfile Updated Successfully');
      dispatch(setCommonState({ userProfileActiveTab: 1 }));
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
    <section className="naxatw-h-screen">
      <UserProfileHeader />
      <div className="naxatw-mx-auto naxatw-flex naxatw-h-[80vh] naxatw-w-full naxatw-flex-col naxatw-gap-2 naxatw-border naxatw-shadow-lg md:naxatw-w-[34rem] md:naxatw-flex-row">
        <div className="naxatw-w-full naxatw-border-r md:naxatw-w-2/6">
          <Tab
            className="naxatw-w-full naxatw-border-b"
            orientation={width < 768 ? 'row' : 'column'}
            onTabChange={() => {}}
            tabOptions={tabOptions}
            activeTab={userProfileActiveTab}
          />
        </div>
        <div className="naxatw-flex naxatw-flex-[70%] naxatw-flex-col naxatw-justify-between naxatw-py-1">
          <div className="naxatw-h-[calc(80vh-7rem)] naxatw-overflow-y-scroll md:naxatw-h-[calc(80vh-5rem)]">
            {getActiveFormContent(userProfileActiveTab, signedInAs, formProps)}
          </div>
          <div className="naxatw-flex naxatw-h-[50px] naxatw-justify-between naxatw-px-12 naxatw-py-1">
            <Button
              className="naxatw-text-red"
              variant="ghost"
              onClick={onBackBtnClick}
              leftIcon="chevron_left"
            >
              Back
            </Button>
            <Button
              className="naxatw-bg-red"
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
      </div>
    </section>
  );
};

export default hasErrorBoundary(CompleteUserProfile);
