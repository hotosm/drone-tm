import ErrorMessage from '@Components/common/ErrorMessage';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import { FlexColumn } from '@Components/common/Layouts';

export default function OrganizationDetails({ formProps }: { formProps: any }) {
  const { register } = formProps;

  return (
    <section className="naxatw-px-14 naxatw-py-10">
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>Organization Name</Label>
          <Input
            placeholder="Enter Organization Name"
            className="naxatw-mt-1"
            {...register('organization_name', {
              required: 'Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.organization_name?.message}
          />
        </FormControl>
        <FormControl>
          <Label required>Organization Address</Label>
          <Input
            placeholder="Enter Organization Address"
            className="naxatw-mt-1"
            {...register('organization_address', {
              required: 'Required',
            })}
          />
          <ErrorMessage
            message={formProps.formState.errors?.organization_address?.message}
          />
        </FormControl>
        <FormControl>
          <Label required>Job Title</Label>
          <Input
            placeholder="Enter Job Title"
            className="naxatw-mt-1"
            {...register('job_title', {
              required: 'Required',
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
