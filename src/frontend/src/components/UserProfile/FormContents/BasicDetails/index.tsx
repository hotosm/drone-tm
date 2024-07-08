import { Flex, FlexColumn } from '@Components/common/Layouts';
import {
  FormControl,
  FormGroup,
  Input,
  Label,
  Select,
} from '@Components/common/FormUI';
import { UserProfileDetailsType } from '@Components/GoogleAuth';
import { useForm } from 'react-hook-form';
import ErrorMessage from '@Components/common/ErrorMessage';

export default function BasicDetails({ formProps }: { formProps: any }) {
  const { register } = formProps;

  console.log(formProps.formState.errors, 'formProps.formState.errors');

  // const userProfile: UserProfileDetailsType =
  //   localStorage.getItem('userprofile');
  return (
    <section className="naxatw-px-14 naxatw-py-10">
      <Flex>
        <p className="naxatw-text-3xl">Basic Details</p>
      </Flex>
      <FlexColumn gap={5}>
        <Flex className="naxatw-h-14 naxatw-w-14 naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-grey-600">
          <h4>SK</h4>
        </Flex>
        <FormControl>
          <Label required>Name</Label>
          <Input
            placeholder="Enter Name"
            className="naxatw-mt-1"
            {...register('name', {
              required: 'Required',
            })}
          />
          <ErrorMessage message={formProps.formState.errors?.name?.message} />
        </FormControl>
        <FormControl>
          <Label required>Country</Label>
          <Input
            placeholder="Enter Country"
            className="naxatw-mt-1"
            {...register('country', {
              required: 'Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.country?.message}
          />
        </FormControl>
        {/* <FormControl>
          <Label required>Country</Label>
          <Select
            options={[]}
            placeholder="Choose Country"
            className="naxatw-mt-1"
            {...register('country', {
              required: 'Required',
            })}
          />
        </FormControl> */}
        <FormControl>
          <Label required>City</Label>
          <Input
            placeholder="Enter City"
            className="naxatw-mt-1"
            {...register('city', {
              required: 'Required',
            })}
          />
          <ErrorMessage message={formProps.formState.errors?.city?.message} />
        </FormControl>
        <FormControl>
          <Label required>Phone number</Label>
          <div className="naxatw-flex naxatw-space-x-1">
            <Input
              placeholder="+977"
              className="naxatw-mt-1 naxatw-w-14"
              {...register('country_code', {
                required: 'Required',
              })}
            />
            <Input
              placeholder="Enter Phone number"
              className="naxatw-mt-1 naxatw-w-full"
              {...register('phone', {
                required: 'Required',
              })}
            />
          </div>
          <ErrorMessage
            message={formProps.formState.errors?.country?.message}
          />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
