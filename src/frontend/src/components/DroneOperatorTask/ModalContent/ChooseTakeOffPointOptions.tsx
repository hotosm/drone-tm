import RadioButton from '@Components/common/RadioButton';
import { Button } from '@Components/RadixComponents/Button';
import { takeOffPointOptions } from '@Constants/taskDescription';
import { setSelectedTakeOffPointOption } from '@Store/actions/droneOperatorTask';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';

const ChooseTakeOffPointOptions = () => {
  const dispatch = useTypedDispatch();
  const selectedTakeOffPointOption = useTypedSelector(
    state => state.droneOperatorTask.selectedTakeOffPointOption,
  );
  return (
    <div>
      <p className="naxatw-text-sm naxatw-text-[#7A7676]">
        Please select the take-off point for your drone.
      </p>
      <div className="naxatw-py-1 naxatw-text-gray-700">
        <RadioButton
          className="!naxatw-text-black"
          options={takeOffPointOptions}
          direction="column"
          onChangeData={value => dispatch(setSelectedTakeOffPointOption(value))}
          value={selectedTakeOffPointOption}
        />
      </div>
      <div className="naxatw naxatw-flex naxatw-justify-center naxatw-pt-3">
        <Button withLoader className="naxatw-bg-red" onClick={() => {}}>
          Next
        </Button>
      </div>
    </div>
  );
};

export default ChooseTakeOffPointOptions;
