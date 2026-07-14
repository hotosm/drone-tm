import { useTypedDispatch, useTypedSelector } from "@Store/hooks";
import { FlexColumn } from "@Components/common/Layouts";
import { FormControl, Label, Input } from "@Components/common/FormUI";
import ErrorMessage from "@Components/common/ErrorMessage";
import { UseFormPropsType } from "@Components/common/FormUI/types";
import RadioButton from "@Components/common/RadioButton";
import MultipleEmailInput from "@Components/common/MultipleEmailInput";
import { lockApprovalOptions, regulatorApprovalOptions } from "@Constants/createProject";
import { setCreateProjectState } from "@Store/actions/createproject";
import { m } from "@/paraglide/messages";

export default function AdvancedConfig({ formProps }: { formProps: UseFormPropsType }) {
  const dispatch = useTypedDispatch();
  const { register, errors } = formProps;
  const requireApprovalFromManagerForLocking = useTypedSelector(
    (state) => state.createproject.requireApprovalFromManagerForLocking,
  );
  const requiresApprovalFromRegulator = useTypedSelector(
    (state) => state.createproject.requiresApprovalFromRegulator,
  );
  const regulatorEmails = useTypedSelector((state) => state.createproject.regulatorEmails);

  return (
    <details className="naxatw-mt-6 naxatw-rounded naxatw-border naxatw-border-[#D7D7D7] naxatw-bg-[#FAFAFA] [&[open]>summary>svg]:naxatw-rotate-90">
      <summary className="naxatw-flex naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 naxatw-px-4 naxatw-py-3 naxatw-text-body-btn naxatw-select-none">
        <svg
          className="naxatw-h-4 naxatw-w-4 naxatw-transition-transform"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path fillRule="evenodd" d="M6 4l8 6-8 6V4z" clipRule="evenodd" />
        </svg>
        {m.create_basic_advanced_config_toggle()}
      </summary>
      <FlexColumn gap={5} className="naxatw-px-4 naxatw-py-4">
        <FormControl>
          <Label>{m.create_contributions_instructions_key()}</Label>
          <Input
            placeholder={m.create_contributions_instructions_placeholder()}
            {...register("per_task_instructions", {
              setValueAs: (value: string) => value.trim(),
            })}
          />
          <ErrorMessage message={errors?.per_task_instructions?.message as string} />
        </FormControl>

        <FormControl className="naxatw-gap-1">
          <div className="naxatw-w-full">
            <Label>{m.create_contributions_deadline_key()}</Label>
            <Input
              placeholder={m.create_contributions_deadline_placeholder()}
              type="date"
              className="naxatw-mt-1"
              {...register("deadline_at")}
            />
          </div>
          <ErrorMessage message={errors?.deadline_at?.message as string} />
        </FormControl>

        <FormControl>
          <RadioButton
            topic={m.create_contributions_regulator_key()}
            options={regulatorApprovalOptions()}
            direction="column"
            onChangeData={(value) => {
              dispatch(
                setCreateProjectState({
                  requiresApprovalFromRegulator: value,
                }),
              );
            }}
            value={requiresApprovalFromRegulator}
          />
        </FormControl>

        {requiresApprovalFromRegulator === "required" && (
          <FormControl className="naxatw-gap-2">
            <Label required>{m.create_contributions_regulator_email_label()}</Label>
            <MultipleEmailInput
              emails={regulatorEmails}
              onEmailAdd={(emails) => {
                dispatch(setCreateProjectState({ regulatorEmails: emails }));
              }}
            />
            <ErrorMessage message={errors?.regulator_emails?.message as string} />
          </FormControl>
        )}

        <FormControl>
          <RadioButton
            topic={m.create_contributions_lock_approval_key()}
            options={lockApprovalOptions()}
            direction="column"
            onChangeData={(value) => {
              dispatch(
                setCreateProjectState({
                  requireApprovalFromManagerForLocking: value,
                }),
              );
            }}
            value={requireApprovalFromManagerForLocking}
            name="requireApprovalFromManagerForLocking"
          />
        </FormControl>
      </FlexColumn>
    </details>
  );
}
