import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import { Input, Label, FormControl } from '@Components/common/FormUI';
import { Button } from '@Components/RadixComponents/Button';
import Icon from '@Components/common/Icon';
import { Flex, FlexRow } from '@Components/common/Layouts';
import ErrorMessage from '@Components/common/ErrorMessage';
import { signInUser } from '@Services/common';

const initialState = {
  email: '',
};

export default function ForgotPassword() {
  const navigate = useNavigate();

  const { mutate, error } = useMutation<any, any, any, unknown>({
    mutationFn: signInUser,
    onSuccess: () => {
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    },
  });

  const { register, handleSubmit } = useForm({
    defaultValues: initialState,
  });

  const onSubmit = (data: any) => {
    mutate(data);
  };

  return (
    <Flex
      gap={5}
      className="naxatw-bg-primary-50 naxatw-h-screen naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-center"
    >
      <Flex className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-font-semibold">
        <Icon
          name="lock_reset"
          className="naxatw-bg-primary-400 naxatw-rounded-[80px] naxatw-px-4 naxatw-py-[15px] naxatw-text-white"
        />
        <h1 className="naxatw-text-2xl naxatw-font-semibold naxatw-leading-10">
          Forgot Your Password?
        </h1>
        <p className="naxatw-items-center naxatw-justify-center naxatw-text-center naxatw-text-base">
          Enter the email address and we will send you a link to reset your
          password.
        </p>
      </Flex>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="naxatw-flex naxatw-w-[60%] naxatw-flex-col naxatw-gap-5 naxatw-pt-7"
      >
        {/* {isSuccess && (
          <InfoDialog
            status="success"
            description={
              successMessage?.data?.Message ||
              'Email has been sent successfully.'
            }
          />
        )} */}
        <FormControl>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="Email"
            {...register('email', { required: true })}
          />
          <ErrorMessage message={error?.response?.data?.Message || ''} />
        </FormControl>

        <FlexRow className="naxatw-items-center naxatw-justify-between">
          <Button type="submit" className="naxatw-bg-red">
            Reset Password
          </Button>

          <Button
            variant="ghost"
            leftIcon="west"
            className="naxatw-text-red"
            onClick={() => {
              navigate('/login');
            }}
            type="button"
          >
            Back to Sign In
          </Button>
        </FlexRow>
      </form>
    </Flex>
  );
}
