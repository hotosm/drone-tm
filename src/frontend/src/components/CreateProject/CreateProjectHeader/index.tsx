import { useTypedDispatch } from '@Store/hooks';
import { FlexRow } from '@Components/common/Layouts';
import Icon from '@Components/common/Icon';
import { toggleModal } from '@Store/actions/common';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const CreateProjectHeader = () => {
  const dispatch = useTypedDispatch();
  return (
    <FlexRow className="naxatw-items-center">
      <Icon
        name="west"
        onClick={() => dispatch(toggleModal('quit-create-project'))}
      />
      <h5 className="naxatw-ml-4 naxatw-font-bold">Project /</h5>
      <span className="naxatw-text-body-lg">&nbsp;Add Project</span>
    </FlexRow>
  );
};

export default hasErrorBoundary(CreateProjectHeader);
