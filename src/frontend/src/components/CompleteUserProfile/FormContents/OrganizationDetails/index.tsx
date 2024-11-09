import ErrorMessage from '@Components/common/ErrorMessage';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import { Flex, FlexColumn } from '@Components/common/Layouts';

export default function OrganizationDetails({ formProps }: { formProps: any }) {
  const { register } = formProps;

  return (
    <section className="naxatw-px-14">
      <Flex>
        <p className="naxatw-text-lg naxatw-font-bold">Organization Details</p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label>Organization Name</Label>
          <Input
            placeholder="Enter Organization Name"
            className="naxatw-mt-1"
            {...register('organization_name', {
              // required: 'Organization name is Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.organization_name?.message}
          />
        </FormControl>
        <FormControl>
          <Label>Organization Address</Label>
          <Input
            placeholder="Enter Organization Address"
            className="naxatw-mt-1"
            {...register('organization_address', {
              // required: 'Organization Address is Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.organization_address?.message}
          />
        </FormControl>
        <FormControl>
          <Label>Job Title</Label>
          <Input
            placeholder="Enter Job Title"
            className="naxatw-mt-1"
            {...register('job_title', {
              // required: 'Job Title is Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.job_title?.message}
          />
        </FormControl>
      </FlexColumn>
    </section>
  );
}
