import { useEffect, useRef, useState } from "react";
import { FormControl, Label, Input } from "@Components/common/FormUI";
import ErrorMessage from "@Components/common/FormUI/ErrorMessage";
import { UseFormPropsType } from "@Components/common/FormUI/types";
import { Controller } from "react-hook-form";
import { getProjectsList } from "@Services/createproject";

export default function BasicInformation({ formProps }: { formProps: UseFormPropsType }) {
  const { register, errors, control, watch } = formProps;
  const [nameExistsError, setNameExistsError] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nameValue = watch("name");

  useEffect(() => {
    setNameExistsError("");

    if (!nameValue || nameValue.trim().length === 0) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const trimmedName = nameValue.trim();
        const response = await getProjectsList({ search: trimmedName });
        const projects = response?.data?.results || [];
        const exactMatch = projects.some(
          (p: any) => p.name?.toLowerCase() === trimmedName.toLowerCase(),
        );
        if (exactMatch) {
          setNameExistsError("A project with this name already exists");
        }
      } catch {
        // silently ignore lookup errors
      }
    }, 1200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [nameValue]);

  return (
    <div className="naxatw-h-full">
      <FormControl className="naxatw-gap-1">
        <Label required>Name</Label>
        <Input
          placeholder="Enter Name of the Project"
          {...register("name", {
            required: "Name of the project is required",
            setValueAs: (value: string) => value.trim(),
          })}
        />
        <ErrorMessage message={(errors?.name?.message as string) || nameExistsError} />
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
