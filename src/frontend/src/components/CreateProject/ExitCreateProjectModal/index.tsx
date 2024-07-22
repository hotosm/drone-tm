import { useTypedDispatch } from '@Store/hooks';
import { useNavigate } from 'react-router-dom';
import { FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import { toggleModal } from '@Store/actions/common';

export default function ExitCreateProjectModal() {
  const dispatch = useTypedDispatch();
  const navigate = useNavigate();

  return (
    <section>
      <p className="naxatw-mb-3">
        This page has some unsaved changes, are you sure you want to leave this
        page?
      </p>
      <FlexRow className="naxatw-w-full" gap={2}>
        <Button
          variant="ghost"
          className="naxatw-text-red"
          onClick={() => {
            navigate('/projects');
            dispatch(toggleModal(null));
          }}
        >
          Leave
        </Button>
        <Button
          className="naxatw-bg-red naxatw-px-5"
          onClick={() => dispatch(toggleModal(null))}
        >
          Stay
        </Button>
      </FlexRow>
    </section>
  );
}
