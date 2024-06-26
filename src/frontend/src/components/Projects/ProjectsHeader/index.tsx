import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { useNavigate } from 'react-router-dom';
import { FlexRow } from '@Components/common/Layouts';
import Switch from '@Components/RadixComponents/Switch';
import { setCommonState } from '@Store/actions/common';
import { Button } from '@Components/RadixComponents/Button';

export default function ProjectsHeader() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const showMap = useTypedSelector(state => state.common.showMap);
  return (
    <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-py-3">
      <h5 className="naxatw-font-bold">Projects</h5>
      <FlexRow gap={4} className="naxatw-items-center">
        <FlexRow className="naxatw-items-center naxatw-gap-[10px]">
          <p className="naxatw-text-body-md">Show map</p>
          <Switch
            checked={showMap}
            onClick={() => {
              dispatch(setCommonState({ showMap: !showMap }));
            }}
          />
        </FlexRow>
        <Button
          variant="secondary"
          className="!naxatw-bg-red naxatw-text-white"
          onClick={() => navigate('/create-project')}
        >
          Add Project
        </Button>
      </FlexRow>
    </FlexRow>
  );
}
