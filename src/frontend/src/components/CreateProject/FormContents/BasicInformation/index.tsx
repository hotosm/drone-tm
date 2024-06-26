import { FormControl, Label, Input } from '@Components/common/FormUI';

export default function BasicInformation({ formProps }: { formProps: any }) {
  const { register } = formProps;
  return (
    <div className="naxatw-px-10 naxatw-py-5">
      <FormControl className="naxatw-gap-1">
        <Label required>Name</Label>
        <Input
          placeholder="Enter Name of the Project"
          {...register('name', {
            required: 'Required',
          })}
        />
      </FormControl>
      <FormControl className="naxatw-mt-5 naxatw-gap-1">
        <Label required>Description of the project</Label>
        <Input
          placeholder="Description of the Project"
          {...register('description', {
            required: 'Required',
          })}
        />
      </FormControl>
    </div>
  );
}
