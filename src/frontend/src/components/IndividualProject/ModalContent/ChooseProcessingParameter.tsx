import RadioButton from "@Components/common/RadioButton";
import { Button } from "@Components/RadixComponents/Button";
import { getStartProcessingOptions } from "@Constants/projectDescription";
import { processAllImagery } from "@Services/project";
import { toggleModal } from "@Store/actions/common";
import { setProjectState } from "@Store/actions/project";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { m } from "@/paraglide/messages";

const ChooseProcessingParameter = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const pathname = window.location.pathname?.split("/");
  const projectId = pathname?.[2];

  const [value, setValue] = useState("with_gcp");
  const { mutate: startImageProcessing } = useMutation({
    mutationFn: processAllImagery,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-detail"] });
      toast.success(m.proj_choose_param_toast_started());
      dispatch(toggleModal());
    },
    onError: (error) => {
      const detail =
        axios.isAxiosError(error) &&
        typeof error.response?.data?.detail === "string" &&
        error.response.data.detail
          ? error.response.data.detail
          : m.proj_choose_param_toast_failed();
      toast.error(detail);
    },
  });

  return (
    <div>
      <p className="naxatw-text-sm naxatw-text-[#7A7676]">{m.proj_choose_param_title()}</p>
      <div className="naxatw-py-1 naxatw-text-gray-700">
        <RadioButton
          className="!naxatw-text-black"
          options={getStartProcessingOptions()}
          direction="column"
          onChangeData={(selectedValue) => setValue(selectedValue)}
          value={value}
        />
      </div>
      <div className="naxatw naxatw-flex naxatw-justify-center naxatw-pt-3">
        <Button
          withLoader
          className="naxatw-bg-red"
          onClick={() => {
            if (value === "with_gcp") {
              dispatch(setProjectState({ showGcpEditor: true }));
              dispatch(toggleModal());
            } else {
              startImageProcessing({ projectId });
            }
          }}
        >
          {m.proj_choose_param_proceed()}
        </Button>
      </div>
    </div>
  );
};

export default ChooseProcessingParameter;
