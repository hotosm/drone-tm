import { Flex, FlexColumn } from '@Components/common/Layouts';
import { FormControl, Select, Input, Label } from '@Components/common/FormUI';
import ErrorMessage from '@Components/common/ErrorMessage';
import { Controller } from 'react-hook-form';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';
import { countries } from 'countries-list';

export default function BasicDetails({ formProps }: { formProps: any }) {
  const { register, formState, control } = formProps;

  const userProfile = getLocalStorageValue('userprofile');

  // eslint-disable-next-line no-unused-vars
  const countryList = Object.entries(countries).map(([_, value]) => ({
    name: value?.name,
    phone: value?.phone?.[0],
  }));

  return (
    <section className="naxatw-px-14">
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
          <ErrorMessage message={formState.errors?.name?.message} />
        </FormControl>
        <FormControl>
          <Label>Country</Label>
          <Controller
            control={control}
            name="country"
            defaultValue=""
            render={({ field: { value, onChange } }) => (
              <Select
                withSearch
                placeholder="Choose a Country"
                options={countryList}
                labelKey="name"
                valueKey="name"
                selectedOption={value}
                onChange={onChange}
              />
            )}
          />
          <ErrorMessage message={formState.errors?.country?.message} />
        </FormControl>
        <FormControl>
          <Label>City</Label>
          <Input
            placeholder="Enter City"
            className="naxatw-mt-1"
            {...register('city', {
              setValueAs: (value: string) => value?.trim(),
            })}
          />
          <ErrorMessage message={formState.errors?.city?.message} />
        </FormControl>
        <FormControl>
          <Label>Phone number</Label>
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
                minLength: {
                  value: 5,
                  message: 'Invalid Phone Number',
                },
              })}
            />
          </div>
          <ErrorMessage message={formState.errors?.phone_number?.message} />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
