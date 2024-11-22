import { useTypedDispatch } from '@Store/hooks';
import { FlexRow } from '@Components/common/Layouts';
import Icon from '@Components/common/Icon';
import { toggleModal } from '@Store/actions/common';
import hasErrorBoundary from '@Utils/hasErrorBoundary';

const CreateProjectHeader = () => {
  const dispatch = useTypedDispatch();
  return (
    <FlexRow className="naxatw-items-center naxatw-justify-between">
      {/* <Icon
        name="west"
        onClick={() => dispatch(toggleModal('quit-create-project'))}
      /> */}
      <FlexRow className="naxatw-items-center">
        <h5
          className="naxatw-cursor-pointer naxatw-font-bold hover:naxatw-underline"
          onClick={() => dispatch(toggleModal('quit-create-project'))}
          role="presentation"
        >
          Project /
        </h5>
        <span className="naxatw-text-body-lg">&nbsp;Add Project</span>
      </FlexRow>
      <Icon
        className="!naxatw-text-xl hover:naxatw-text-red"
        name="close"
        onClick={() => dispatch(toggleModal('quit-create-project'))}
      />
    </FlexRow>
  );
};

export default hasErrorBoundary(CreateProjectHeader);
