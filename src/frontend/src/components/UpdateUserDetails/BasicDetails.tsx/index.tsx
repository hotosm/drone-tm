import { Controller, useForm } from 'react-hook-form';
import { FormControl, Input, Label, Select } from '@Components/common/FormUI';
import { Flex, FlexColumn } from '@Components/common/Layouts';
import { countriesWithPhoneCodes } from '@Constants/countryCode';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';
import ErrorMessage from '@Components/common/ErrorMessage';
import { Button } from '@Components/RadixComponents/Button';
import { useMutation } from '@tanstack/react-query';
import { patchUserProfile } from '@Services/common';
import { toast } from 'react-toastify';

const BasicDetails = () => {
  const userProfile = getLocalStorageValue('userprofile');
  const initialState = {
    name: userProfile?.name,
    country: userProfile?.country || null,
    city: userProfile?.city || null,
    password: null,
    phone_number: userProfile?.phone_number || null,
  };

  const { register, handleSubmit, formState, control } = useForm({
    defaultValues: initialState,
  });

  const { mutate: updateBasicInfo, isLoading } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: payloadDataObject => patchUserProfile(payloadDataObject),
    onSuccess: () => {
      toast.success('Basic Updated Successfully');
    },
    onError: err => {
      // eslint-disable-next-line no-console
      console.log(err);
    },
  });

  const onSubmit = (formData: Record<string, any>) => {
    updateBasicInfo({ userId: userProfile?.id, data: formData });
  };

  return (
    <section className="naxatw-w-full naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">Basic Details</p>
      </Flex>
      <FlexColumn gap={5} className="naxatw-mt-5">
        <Flex className="naxatw-h-14 naxatw-w-14 naxatw-items-center naxatw-justify-center naxatw-overflow-hidden naxatw-rounded-full naxatw-bg-grey-600">
          <img src={userProfile.profile_img} alt="profilepic" />
        </Flex>
        <FormControl>
          <Label>Name</Label>
          <Input
            placeholder="Enter Name"
            className="naxatw-mt-1"
            {...register('name', {
              required: 'Name is Required',
            })}
            readOnly
          />
          <ErrorMessage message={formState?.errors?.name?.message as string} />
        </FormControl>
        <FormControl>
          <Label required>Country</Label>
          <Controller
            control={control}
            name="country"
            defaultValue=""
            rules={{
              required: 'Country is Required',
            }}
            render={({ field: { value, onChange } }) => (
              <Select
                placeholder="Choose a Country"
                options={countriesWithPhoneCodes}
                labelKey="label"
                valueKey="label"
                selectedOption={value}
                onChange={onChange}
              />
            )}
          />
          <ErrorMessage
            message={formState?.errors?.country?.message as string}
          />
        </FormControl>
        <FormControl>
          <Label required>City</Label>
          <Input
            placeholder="Enter City"
            className="naxatw-mt-1"
            {...register('city', {
              setValueAs: (value: string) => value.trim(),
              required: 'City is Required',
            })}
          />
          <ErrorMessage message={formState.errors?.city?.message as string} />
        </FormControl>
        <FormControl>
          <Label required>Phone number</Label>
          <div className="naxatw-flex naxatw-space-x-1">
            {/* <Input
          placeholder="+977"
          className="naxatw-mt-1 naxatw-w-14"
          {...register('country_code', {
            required: 'Phone Number is Required',
          })}
        /> */}
            <Input
              placeholder="Enter Phone number"
              className="naxatw-mt-1 naxatw-w-full"
              type="number"
              {...register('phone_number', {
                required: 'Phone Number is Required',
                minLength: {
                  value: 5,
                  message: 'Invalid Phone Number',
                },
              })}
            />
          </div>
          <ErrorMessage
            message={formState.errors?.phone_number?.message as string}
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

export default BasicDetails;
