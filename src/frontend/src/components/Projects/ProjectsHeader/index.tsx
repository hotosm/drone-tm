import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { useNavigate } from 'react-router-dom';
import { FlexRow } from '@Components/common/Layouts';
import Switch from '@Components/RadixComponents/Switch';
import { setCommonState } from '@Store/actions/common';
import { Button } from '@Components/RadixComponents/Button';
import { Select } from '@Components/common/FormUI';
import { setCreateProjectState } from '@Store/actions/createproject';

export default function ProjectsHeader() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const signedInAs = localStorage.getItem('signedInAs') || 'Project Creator';
  const showMap = useTypedSelector(state => state.common.showMap);
  const projectsFilterByOwner = useTypedSelector(
    state => state.createproject.ProjectsFilterByOwner,
  );

  return (
    <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-py-3">
      <h5 className="naxatw-font-bold">Projects</h5>
      <FlexRow gap={4} className="naxatw-items-center">
        <div>
          <Select
            placeholder="Select"
            options={[
              {
                label: 'All projects',
                value: 'no',
              },
              { label: 'My Projects', value: 'yes' },
            ]}
            labelKey="label"
            valueKey="value"
            className="!naxatw-w-[100px]"
            selectedOption={projectsFilterByOwner}
            onChange={value =>
              dispatch(setCreateProjectState({ ProjectsFilterByOwner: value }))
            }
          />
        </div>

        <FlexRow className="naxatw-items-center naxatw-gap-[10px]">
          <p className="naxatw-text-body-md">Show map</p>
          <Switch
            checked={showMap}
            onClick={() => {
              dispatch(setCommonState({ showMap: !showMap }));
            }}
          />
        </FlexRow>

        {signedInAs === 'Project Creator' && (
          <Button
            variant="secondary"
            className="!naxatw-bg-red naxatw-text-white"
            onClick={() => navigate('/create-project')}
          >
            Add Project
          </Button>
        )}
      </FlexRow>
    </FlexRow>
  );
}
