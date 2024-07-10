import { Flex, FlexColumn } from '@Components/common/Layouts';
import { FormControl, Select, Input, Label } from '@Components/common/FormUI';
import ErrorMessage from '@Components/common/ErrorMessage';
import { countriesWithPhoneCodes } from '@Constants/countryCode';
import { Controller } from 'react-hook-form';

export default function BasicDetails({ formProps }: { formProps: any }) {
  const { register, formState, control } = formProps;

  return (
    <section className="naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">Basic Details</p>
      </Flex>
      <FlexColumn gap={5} className="naxatw-mt-5">
        <Flex className="naxatw-h-14 naxatw-w-14 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-grey-600">
          <h4>SK</h4>
        </Flex>
        <FormControl>
          <Label required>Name</Label>
          <Input
            placeholder="Enter Name"
            className="naxatw-mt-1"
            {...register('name', {
              required: 'Name is Required',
            })}
          />
          <ErrorMessage message={formState.errors?.name?.message} />
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
          <ErrorMessage message={formState.errors?.country?.message} />
        </FormControl>
        <FormControl>
          <Label required>City</Label>
          <Input
            placeholder="Enter City"
            className="naxatw-mt-1"
            {...register('city', {
              required: 'City is Required',
            })}
          />
          <ErrorMessage message={formState.errors?.city?.message} />
        </FormControl>
        <FormControl>
          <Label required>Phone number</Label>
          <div className="naxatw-flex naxatw-space-x-1">
            <Input
              placeholder="+977"
              className="naxatw-mt-1 naxatw-w-14"
              {...register('country_code', {
                required: 'Phone Number is Required',
              })}
            />
            <Input
              placeholder="Enter Phone number"
              className="naxatw-mt-1 naxatw-w-full"
              type="number"
              {...register('phone_number', {
                required: 'Phone Number is Required',
                valueAsNumber: true,
              })}
            />
          </div>
          <ErrorMessage message={formState.errors?.phone_number?.message} />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
