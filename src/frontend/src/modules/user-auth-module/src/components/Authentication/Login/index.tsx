/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation } from '@tanstack/react-query';

import Image from '@Components/RadixComponents/Image';
import { Input, Label, FormControl } from '@Components/common/FormUI';
import { Button } from '@Components/RadixComponents/Button';
import Icon from '@Components/common/Icon';
import { Flex, FlexRow } from '@Components/common/Layouts';
import Person from '@Assets/images/person.svg';
import { useTypedDispatch } from '@Store/hooks';
import { signInGoogle, signInUser } from '@Services/common';
import { setUserState } from '@UserModule/store/actions/user';
import googleIcon from '@Assets/images/google-icon.svg';
import { toast } from 'react-toastify';
import { isSafeRedirect } from '@Utils/url';

const { BASE_URL } = process.env;

const initialState = {
  username: '',
  password: '',
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useTypedDispatch();
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [onSignUpBtnClick, setOnSignUpBtnClick] = useState<boolean>(false);
  // eslint-disable-next-line no-unused-vars
  const [showErrorToggle, setShowErrorToggle] = useState<boolean>(false);
  const handleShow = () => {
    return setShowPassword(prev => !prev);
  };

  const signedInAs = localStorage.getItem('signedInAs') || 'PROJECT_CREATOR';

  const { mutate, isPending } = useMutation<any, any, any, unknown>({
    mutationFn: signInUser,
    onSuccess: async (res: any) => {
      dispatch(setUserState({ user: res.data }));
      localStorage.setItem('token', res.data.access_token);
      localStorage.setItem('refresh', res.data.refresh_token);
      toast.success('Logged In Successfully');
      const userDetailsUrl = `${BASE_URL}/users/my-info/`;
      const response2 = await fetch(userDetailsUrl, {
        credentials: 'include',
        headers: { 'access-token': res.data.access_token },
      });
      const userDetails = await response2.json();
      const userDetailsString = JSON.stringify(userDetails);
      localStorage.setItem('userprofile', userDetailsString);

      const from = location.state?.from?.pathname;

      if (userDetails?.has_user_profile) {
        if (isSafeRedirect(from)) {
          navigate(from, { replace: true });
        } else if (userDetails?.role?.includes(signedInAs)) {
          navigate('/projects');
        } else {
          navigate('/complete-profile');
        }
      } else {
        navigate('/complete-profile');
      }
    },
    onError: err => {
      toast.error(err.response.data.detail);
    },
  });

  const googleLoginQuery = useQuery({
    queryKey: ['google-login'],
    queryFn: signInGoogle,
    select: (res: any) => res.data,
    enabled: !!onSignUpBtnClick,
  });

  useEffect(() => {
    if (googleLoginQuery.data) {
      window.location.href = googleLoginQuery.data.login_url;
    }
  }, [googleLoginQuery.data]);

  const { register, handleSubmit } = useForm({
    defaultValues: initialState,
  });

  const onSubmit = (data: { username: string; password: string }) =>
    mutate({ ...data, role: signedInAs });

  return (
    <>
      <Flex
        gap={5}
        className="naxatw-h-screen naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-center"
      >
        <Image src={Person} />
        <h3>
          {signedInAs === 'PROJECT_CREATOR'
            ? 'Project Creator'
            : 'Drone Operator'}
        </h3>

        {/* google login button */}
        <div
          className="naxatw-flex naxatw-w-[60%] naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-gap-2 naxatw-rounded-lg naxatw-border naxatw-border-grey-800 naxatw-px-5 naxatw-py-3 hover:naxatw-shadow-md"
          onClick={() => {
            const from = location.state?.from?.pathname;
            if (from) {
              sessionStorage.setItem('postLoginRedirect', from);
            }
            setOnSignUpBtnClick(true);
          }}
        >
          <Image src={googleIcon} />
          <span className="naxatw-text-body-btn">Continue with Google</span>
        </div>
        {/* google login button */}

        <FlexRow
          className="naxatw-w-full naxatw-items-center naxatw-justify-center"
          gap={3}
        >
          <hr className="naxatw-w-[26%]" />
          <span>or</span>
          <hr className="naxatw-w-[26%]" />
        </FlexRow>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="naxatw-flex naxatw-w-[60%] naxatw-flex-col naxatw-gap-5"
        >
          <FormControl>
            <Label htmlFor="username" required>
              Email
            </Label>
            <Input
              id="username"
              type="text"
              placeholder="Username"
              className="naxatw-mt-1 !naxatw-rounded-lg !naxatw-border-grey-400 !naxatw-p-3"
              {...register('username', { required: true })}
            />
          </FormControl>

          <FormControl className="naxatw-relative">
            <Label htmlFor="password" required>
              Password
            </Label>
            <Input
              id="password"
              placeholder="*******"
              className="naxatw-mt-1 !naxatw-rounded-lg !naxatw-border-grey-400 !naxatw-p-3"
              type={showPassword ? 'text' : 'password'}
              {...register('password', { required: true })}
            />
            <Icon
              name={showPassword ? 'visibility' : 'visibility_off'}
              className="naxatw-absolute naxatw-right-2 naxatw-top-[55%] naxatw-cursor-pointer naxatw-text-sm naxatw-text-grey-600"
              onClick={() => handleShow()}
            />
          </FormControl>

          <FlexRow className="naxatw-items-center naxatw-justify-between">
            <FlexRow className="naxatw-items-center naxatw-gap-2 naxatw-pl-3">
              <Input type="checkbox" id="check" />
              <Label htmlFor="check">Remember Me</Label>
            </FlexRow>
            <Button
              variant="ghost"
              className="naxatw-text-body-btn !naxatw-text-red"
              onClick={() => {
                navigate('/forgot-password');
              }}
              type="button"
            >
              Forgot Your Password?
            </Button>
          </FlexRow>
          <Button
            className="!naxatw-bg-red naxatw-py-5"
            type="submit"
            isLoading={isPending}
            withLoader
          >
            Log In
          </Button>
          <Button
            leftIcon="west"
            variant="ghost"
            className="naxatw-py-5 !naxatw-text-red"
            onClick={() => navigate('/')}
          >
            Back
          </Button>
        </form>
      </Flex>
    </>
  );
}
