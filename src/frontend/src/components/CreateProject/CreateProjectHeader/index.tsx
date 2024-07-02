import { useNavigate } from 'react-router-dom';
import { FlexRow } from '@Components/common/Layouts';
import Icon from '@Components/common/Icon';

export default function CreateProjectHeader() {
  const navigate = useNavigate();
  return (
    <FlexRow className="naxatw-items-center">
      <Icon name="west" onClick={() => navigate('/projects')} />
      <h5 className="naxatw-ml-4 naxatw-font-bold">Project /</h5>
      <span className="naxatw-text-body-lg">&nbsp;Add Project</span>
    </FlexRow>
  );
}
