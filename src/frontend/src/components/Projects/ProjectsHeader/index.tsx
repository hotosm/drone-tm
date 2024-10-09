import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import { FlexRow } from '@Components/common/Layouts';
import Switch from '@Components/RadixComponents/Switch';
import { setCommonState } from '@Store/actions/common';
import { Button } from '@Components/RadixComponents/Button';
import { Select } from '@Components/common/FormUI';
import { setCreateProjectState } from '@Store/actions/createproject';
import SearchInput from '@Components/common/FormUI/SearchInput';
import useDebounceListener from '@Hooks/useDebouncedListener';

export default function ProjectsHeader() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();
  const signedInAs = localStorage.getItem('signedInAs') || 'Project Creator';
  const showMap = useTypedSelector(state => state.common.showMap);
  const projectsFilterByOwner = useTypedSelector(
    state => state.createproject.ProjectsFilterByOwner,
  );
  const [searchValue, setSearchValue] = useState('');
  const debouncedValue = useDebounceListener(searchValue || '', 300);

  useEffect(() => {
    dispatch(setCommonState({ projectSearchKey: debouncedValue as string }));
  }, [debouncedValue, dispatch]);

  return (
    <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-justify-between naxatw-gap-2 naxatw-py-3 md:naxatw-flex-row">
      <FlexRow className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-justify-between naxatw-gap-4 md:naxatw-w-[65%]">
        <h5 className="naxatw-font-bold">Projects</h5>
        <FlexRow gap={3} className="">
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
                dispatch(
                  setCreateProjectState({ ProjectsFilterByOwner: value }),
                )
              }
            />
          </div>
          <div>
            <SearchInput
              inputValue={searchValue}
              placeholder="Project Name"
              onChange={(e: any) => setSearchValue(e.target.value)}
              onClear={() => setSearchValue('')}
            />
          </div>
        </FlexRow>
      </FlexRow>
      <FlexRow
        gap={4}
        className="naxatw-w-full naxatw-items-center naxatw-justify-end md:naxatw-w-[210px]"
      >
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
    </div>
  );
}
