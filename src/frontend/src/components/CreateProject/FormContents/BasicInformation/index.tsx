import { FormControl, Label, Input } from '@Components/common/FormUI';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';

export default function BasicInformation({ formProps }: { formProps: any }) {
  const { register, formState } = formProps;

  return (
    <div className="naxatw-px-10 naxatw-py-5">
      <FormControl className="naxatw-gap-1">
        <Label required>Name</Label>
        <Input
          placeholder="Enter Name of the Project"
          {...register('name', {
            required: 'Name of the project is required',
          })}
        />
        <ErrorMessage message={formState.errors?.name?.message} />
      </FormControl>
      <FormControl className="naxatw-mt-5 naxatw-gap-1">
        <Label required>Description of the project</Label>
        <Input
          type="text-area"
          placeholder="Description of the Project"
          {...register('description', {
            required: 'Description is Required',
          })}
        />
        <ErrorMessage message={formState.errors?.description?.message} />
      </FormControl>
    </div>
  );
}
