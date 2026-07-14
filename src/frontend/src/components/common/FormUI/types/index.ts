import type {
  Control,
  FieldErrors,
  FieldValues,
  UseFormClearErrors,
  UseFormGetValues,
  UseFormRegister,
  UseFormSetError,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";

export interface UseFormPropsType {
  register: UseFormRegister<FieldValues>;
  control: Control;
  errors?: FieldErrors<FieldValues>;
  setValue: UseFormSetValue<FieldValues>;
  setError?: UseFormSetError<FieldValues>;
  clearErrors?: UseFormClearErrors<FieldValues>;
  getValues?: UseFormGetValues<FieldValues>;
  watch: UseFormWatch<FieldValues>;
}
