import { Controller, useForm } from 'react-hook-form';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';
import { Flex, FlexColumn } from '@Components/common/Layouts';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import ErrorMessage from '@Components/common/ErrorMessage';
import RadioButton from '@Components/common/RadioButton';
import FileUpload from '@Components/common/UploadArea';
import { droneOperatorOptions } from '@Constants/index';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { setCommonState } from '@Store/actions/common';
import { Button } from '@Components/RadixComponents/Button';
import { patchUserProfile } from '@Services/common';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import callApiSimultaneously from '@Utils/callApiSimultaneously';
import { useEffect } from 'react';

const OtherDetails = () => {
  const userProfile = getLocalStorageValue('userprofile');
  const dispatch = useTypedDispatch();
  const isCertifiedDroneOperator = useTypedSelector(
    state => state.common.isCertifiedDroneUser,
  );

  const initialState = {
    // for drone operators
    notify_for_projects_within_km:
      userProfile?.notify_for_projects_within_km || null,
    experience_years: userProfile?.experience_years || null,
    certified_drone_operator: userProfile?.certified_drone_operator || false,
    drone_you_own: userProfile?.drone_you_own || null,
    certificate_file:
      userProfile?.certificate_file || userProfile?.certificate_url || null,
    registration_file:
      userProfile?.registration_file ||
      userProfile?.registration_certificate_url ||
      null,
  };
  const queryClient = useQueryClient();

  const { register, handleSubmit, setValue, control, formState, getValues } =
    useForm({
      defaultValues: initialState,
    });

  const { mutate: updateOtherDetails, isLoading } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: payloadDataObject => patchUserProfile(payloadDataObject),
    onSuccess: async data => {
      const results = data.data?.results;
      const values = getValues();
      const urlsToUpload = [];
      const assetsToUpload = [];
      if (results?.certificate_url) {
        urlsToUpload.push(results?.certificate_url);
        assetsToUpload.push(values?.certificate_file?.[0]?.file);
      }
      if (results?.registration_certificate_url) {
        urlsToUpload.push(results?.registration_certificate_url);
        assetsToUpload.push(values?.registration_file?.[0]?.file);
      }
      if (urlsToUpload.length) {
        await callApiSimultaneously(urlsToUpload, assetsToUpload, 'put');
      }

      queryClient.invalidateQueries(['user-profile']);

      toast.success('Details Updated Successfully');
    },
    onError: err => {
      // eslint-disable-next-line no-console
      console.log(err);
      toast.error(err?.response?.data?.detail || 'Something went wrong');
    },
  });

  useEffect(() => {
    dispatch(
      setCommonState({
        isCertifiedDroneUser: userProfile?.certified_drone_operator
          ? 'yes'
          : 'no',
      }),
    );
<<<<<<< HEAD
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
=======
  }, [userProfile, dispatch]);
>>>>>>> 5510fd82f24d43d7c1aebeed1384fd165ca13fc7

  const onSubmit = (formData: Record<string, any>) => {
    updateOtherDetails({
      userId: userProfile?.id,
      data: {
        ...formData,
        certificate_file: formData?.certificate_file?.[0]?.file?.name,
        registration_file: formData?.registration_file?.[0]?.file?.name,
      },
    });
  };

  return (
    <section className="naxatw-max-h-full naxatw-w-full naxatw-overflow-y-auto naxatw-px-14">
      <Flex>
        <p className="naxatw-mb-2 naxatw-text-lg naxatw-font-bold">
          Other Details
        </p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>Notify for projects withing Distance (in km)</Label>
          <Input
            placeholder="Enter"
            className="naxatw-mt-1"
            type="number"
            {...register('notify_for_projects_within_km', {
              required: 'Required',
              valueAsNumber: true,
            })}
          />
          <ErrorMessage
            message={
              formState?.errors?.notify_for_projects_within_km
                ?.message as string
            }
          />
        </FormControl>
        <FormControl>
          <Label required>Experience </Label>
          <Input
            placeholder="Enter years of experience"
            className="naxatw-mt-1"
            type="number"
            {...register('experience_years', {
              required: 'Required',
              valueAsNumber: true,
            })}
          />
          <ErrorMessage
            message={formState.errors?.experience_years?.message as string}
          />
        </FormControl>
        <FormControl>
          <Label required>Drone you own</Label>
          <Input
            placeholder="Enter the type of drone you own"
            className="naxatw-mt-1"
            {...register('drone_you_own', {
              required: 'Required',
            })}
          />
          <ErrorMessage
            message={formState.errors?.drone_you_own?.message as string}
          />
        </FormControl>
        <FormControl>
          <RadioButton
            topic="Certified Drone Operator?"
            options={droneOperatorOptions}
            direction="column"
            onChangeData={val => {
              dispatch(setCommonState({ isCertifiedDroneUser: val }));
              setValue('certified_drone_operator', val === 'yes');
            }}
            value={isCertifiedDroneOperator}
          />
          <ErrorMessage
            message={
              formState.errors?.certified_drone_operator?.message as string
            }
          />
          {isCertifiedDroneOperator === 'yes' && (
            <Controller
              control={control}
              name="certificate_file"
              rules={{
                required: 'Certificate file is required',
              }}
              render={({ field: { value }, fieldState: { error } }) => {
                return (
                  <>
                    <FileUpload
                      // @ts-ignore
                      register={() => {}}
                      // @ts-ignore
                      setValue={setValue}
                      name="certificate_file"
                      data={value}
                      onChange={() => {}}
                      fileAccept=".pdf, .jpeg, .png"
                      placeholder="The supported file formats are pdf, .jpeg, .png"
                    />
                    <ErrorMessage message={error?.message as string} />
                  </>
                );
              }}
            />
          )}
        </FormControl>
        <FormControl className="naxatw-flex-col naxatw-gap-1">
          <Label>Drone Registration Certificate</Label>
          <Controller
            control={control}
            name="registration_file"
            render={({ field: { value } }) => {
              // console.log(value, 'value12');
              return (
                <FileUpload
                  // @ts-ignore
                  register={() => {}}
                  // @ts-ignore
                  setValue={setValue}
                  name="registration_file"
                  data={value}
                  onChange={() => {}}
                  fileAccept=".pdf, .jpeg, .png"
                  placeholder="The supported file formats are pdf, .jpeg, .png"
                />
              );
            }}
          />
        </FormControl>
      </FlexColumn>
      <div className="naxatw-flex naxatw-justify-center naxatw-py-4">
        <Button
          className="naxatw-bg-red"
          onClick={e => {
            e.preventDefault();
            handleSubmit(onSubmit)();
          }}
          withLoader
          isLoading={isLoading}
        >
          Save
        </Button>
      </div>
    </section>
  );
};

export default OtherDetails;
