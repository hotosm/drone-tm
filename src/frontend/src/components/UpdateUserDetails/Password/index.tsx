import { useForm } from "react-hook-form";
import { toast } from "react-toastify";
import ErrorMessage from "@Components/common/ErrorMessage";
import { FormControl, Input, Label } from "@Components/common/FormUI";
import { Flex, FlexColumn } from "@Components/common/Layouts";
import { Button } from "@Components/RadixComponents/Button";
import { patchUserProfile } from "@Services/common";
import { useMutation } from "@tanstack/react-query";
import { getLocalStorageValue } from "@Utils/getLocalStorageValue";
import { useNavigate } from "react-router-dom";
import { m } from "@/paraglide/messages";

const Password = () => {
  const navigate = useNavigate();
  const initialState = {
    old_password: "",
    password: "",
    confirm_password: "",
  };
  const userProfile = getLocalStorageValue("userprofile");

  const { register, handleSubmit, formState, watch } = useForm({
    defaultValues: initialState,
  });
  const password = watch("password");

  const { mutate: updatePassword, isPending } = useMutation<any, any, any, unknown>({
    mutationFn: (payloadDataObject) => patchUserProfile(payloadDataObject),
    onSuccess: () => {
      toast.success(m.profile_password_updated_success());
      navigate("/dashboard");
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.log(err);
      toast.error(err?.response?.data?.detail || m.profile_something_went_wrong());
    },
  });

  const onSubmit = (formData: Record<string, any>) => {
    updatePassword({ userId: userProfile?.id, data: formData });
  };

  return (
    <section className="naxatw-w-full naxatw-px-14">
      <Flex>
        <p className="naxatw-mb-2 naxatw-text-lg naxatw-font-bold">{m.profile_change_password()}</p>
      </Flex>
      <FlexColumn gap={5}>
        <FormControl>
          <Label required>{m.profile_old_password_label()}</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder={m.profile_old_password_placeholder()}
            {...register("old_password", {
              required: m.profile_old_password_required(),
            })}
          />
          <ErrorMessage message={formState.errors?.old_password?.message} />
        </FormControl>
        <FormControl>
          <Label required>{m.profile_password_label()}</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder={m.profile_new_password_placeholder()}
            {...register("password", {
              required: m.profile_password_required(),
              minLength: {
                value: 8,
                message: m.profile_password_min_length(),
              },
            })}
          />
          <ErrorMessage message={formState.errors?.password?.message} />
        </FormControl>
        <FormControl>
          <Label required>{m.profile_confirm_password_label()}</Label>
          <Input
            type="password"
            className="naxatw-mt-1"
            placeholder={m.profile_confirm_password_placeholder_lower()}
            {...register("confirm_password", {
              validate: {
                matchPassword: (value: string) =>
                  value === password || m.profile_password_mismatch(),
              },
              required: m.profile_confirm_password_required(),
            })}
          />
          <ErrorMessage message={formState.errors?.confirm_password?.message} />
        </FormControl>
      </FlexColumn>

      <div className="naxatw-flex naxatw-justify-center naxatw-py-4">
        <Button
          className="naxatw-bg-red"
          onClick={(e) => {
            e.preventDefault();
            handleSubmit(onSubmit)();
          }}
          withLoader
          isLoading={isPending}
        >
          {m.profile_save()}
        </Button>
      </div>
    </section>
  );
};

export default Password;
