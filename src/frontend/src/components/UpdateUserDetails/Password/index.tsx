import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import ErrorMessage from '@Components/common/ErrorMessage';
import { FormControl, Input, Label } from '@Components/common/FormUI';
import { Flex, FlexColumn } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { patchUserProfile } from '@Services/common';
import { useMutation } from '@tanstack/react-query';
import { getLocalStorageValue } from '@Utils/getLocalStorageValue';

const Password = () => {
  const initialState = {
    old_password: '',
    password: '',
    confirm_password: '',
  };
  const userProfile = getLocalStorageValue('userprofile');

  const { register, handleSubmit, formState, watch } = useForm({
    defaultValues: initialState,
  });
  const password = watch('password');

  const { mutate: updatePassword, isLoading } = useMutation<
    any,
    any,
    any,
    unknown
  >({
    mutationFn: payloadDataObject => patchUserProfile(payloadDataObject),
    onSuccess: () => {
      toast.success('Password Updated successfully');
    },
    onError: err => {
      // eslint-disable-next-line no-console
      console.log(err);
    },
  });

  const onSubmit = (formData: Record<string, any>) => {
    updatePassword({ userId: userProfile?.id, data: formData });
  };

  return (
    <section className="naxatw-w-full naxatw-px-14">
      <Flex>
        <p className="naxatw-py-2 naxatw-text-lg naxatw-font-bold">
          Change Password
        </p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>Old password</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder="Enter old password"
            {...register('old_password', {
              required: 'Old Password is Required',
            })}
          />
          <ErrorMessage message={formState.errors?.old_password?.message} />
        </FormControl>
        <FormControl>
          <Label required>Password</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder="Enter new password"
            {...register('password', {
              required: 'Password is Required',
              minLength: {
                value: 8,
                message: 'Password must have at least 8 characters',
              },
            })}
          />
          <ErrorMessage message={formState.errors?.password?.message} />
        </FormControl>
        <FormControl>
          <Label required>Confirm Password</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder="Enter confirm password"
            {...register('confirm_password', {
              validate: (value: string) =>
                value === password || 'The passwords do not match',
              // required: 'Confirm Password is Required',
            })}
          />
          <ErrorMessage message={formState.errors?.confirm_password?.message} />
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

export default Password;
