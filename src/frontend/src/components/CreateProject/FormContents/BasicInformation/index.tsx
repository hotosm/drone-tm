import { FormControl, Label, Input } from '@Components/common/FormUI';
import ErrorMessage from '@Components/common/FormUI/ErrorMessage';
import { UseFormPropsType } from '@Components/common/FormUI/types';
import { Controller } from 'react-hook-form';

export default function BasicInformation({
  formProps,
}: {
  formProps: UseFormPropsType;
}) {
  const { register, errors, control } = formProps;

  return (
    <div className="naxatw-h-full">
      <FormControl className="naxatw-gap-1">
        <Label required>Name</Label>
        <Input
          placeholder="Enter Name of the Project"
          {...register('name', {
            required: 'Name of the project is required',
            setValueAs: (value: string) => value.trim(),
          })}
        />
        <ErrorMessage message={errors?.name?.message as string} />
      </FormControl>
      <FormControl className="naxatw-mt-5 naxatw-gap-1">
        <Label>Description of the project</Label>
        <Controller
          control={control}
          name="description"
          render={({ field: { onChange, onBlur, value, ref, ...others } }) => (
            <textarea
              className="naxatw-flex naxatw-h-[100px] naxatw-rounded-[4px] naxatw-border naxatw-border-[#555555] naxatw-bg-transparent naxatw-p-2 naxatw-text-body-md file:naxatw-font-medium hover:naxatw-border-red focus:naxatw-border-red focus:naxatw-bg-transparent focus:naxatw-outline-none disabled:naxatw-cursor-not-allowed"
              placeholder="Description of the Project"
              onChange={onChange}
              value={value}
              {...others}
            />
          )}
        />
        <ErrorMessage message={errors?.description?.message as string} />
      </FormControl>
    </div>
  );
}
