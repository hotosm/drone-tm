import RadioButton from "@Components/common/RadioButton";
import { Button } from "@Components/RadixComponents/Button";
import { getTakeOffPointOptions } from "@Constants/taskDescription";
import { toggleModal } from "@Store/actions/common";
import {
  setSelectedTakeOffPoint,
  setSelectedTakeOffPointOption,
} from "@Store/actions/droneOperatorTask";
import { useTypedDispatch, useTypedSelector } from "@Store/hooks";
import { point } from "@turf/helpers";
import { m } from "@/paraglide/messages";

const ChooseTakeOffPointOptions = () => {
  const dispatch = useTypedDispatch();
  const selectedTakeOffPointOption = useTypedSelector(
    (state) => state.droneOperatorTask.selectedTakeOffPointOption,
  );

  const handleNextClick = () => {
    if (selectedTakeOffPointOption === "current_location") {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((latLng) =>
          dispatch(
            setSelectedTakeOffPoint(point([latLng?.coords?.longitude, latLng?.coords?.latitude])),
          ),
        );
      }
    } else {
      dispatch(setSelectedTakeOffPoint(selectedTakeOffPointOption));
    }
    dispatch(toggleModal());
  };
  return (
    <div>
      <p className="naxatw-text-sm naxatw-text-[#7A7676]">{m.task_takeoff_select_prompt()}</p>
      <div className="naxatw-py-1 naxatw-text-gray-700">
        <RadioButton
          className="!naxatw-text-black"
          options={getTakeOffPointOptions()}
          direction="column"
          onChangeData={(value) => dispatch(setSelectedTakeOffPointOption(value))}
          value={selectedTakeOffPointOption}
        />
      </div>
      <div className="naxatw naxatw-flex naxatw-justify-center naxatw-pt-3">
        <Button withLoader className="naxatw-bg-red" onClick={() => handleNextClick()}>
          {m.create_button_next()}
        </Button>
      </div>
    </div>
  );
};

export default ChooseTakeOffPointOptions;
