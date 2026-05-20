import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";

import { Input, Label, FormControl } from "@Components/common/FormUI";
import { Button } from "@Components/RadixComponents/Button";
import Icon from "@Components/common/Icon";
import { Flex, FlexRow } from "@Components/common/Layouts";
import ErrorMessage from "@Components/common/ErrorMessage";
import { forgotPassword } from "@Services/common";
import { toast } from "react-toastify";
import { m } from "@/paraglide/messages";

const initialState = {
  email: "",
};

export default function ForgotPassword() {
  const navigate = useNavigate();

  const { mutate, error } = useMutation<any, any, any, unknown>({
    mutationFn: forgotPassword,
    onSuccess: () => {
      toast.success(m.auth_forgot_password_email_sent());

      navigate("/login");
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
          {m.auth_forgot_password_question()}
        </h1>
        <p className="naxatw-items-center naxatw-justify-center naxatw-text-center naxatw-text-base">
          {m.auth_forgot_password_instructions()}
        </p>
      </Flex>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="naxatw-flex naxatw-w-[60%] naxatw-flex-col naxatw-gap-5 naxatw-pt-7"
      >
        <FormControl>
          <Label htmlFor="email">{m.auth_email_label()}</Label>
          <Input
            id="email"
            type="email"
            placeholder={m.auth_email_placeholder()}
            {...register("email", { required: true })}
          />
          <ErrorMessage
            message={error?.response?.data?.detail?.[0]?.msg || m.auth_reset_password_error()}
          />
        </FormControl>

        <FlexRow className="naxatw-items-center naxatw-justify-between">
          <Button type="submit" className="naxatw-bg-red">
            {m.auth_reset_password()}
          </Button>

          <Button
            variant="ghost"
            leftIcon="west"
            className="naxatw-text-red"
            onClick={() => {
              navigate("/login");
            }}
            type="button"
          >
            {m.auth_back_to_sign_in()}
          </Button>
        </FlexRow>
      </form>
    </Flex>
  );
}
