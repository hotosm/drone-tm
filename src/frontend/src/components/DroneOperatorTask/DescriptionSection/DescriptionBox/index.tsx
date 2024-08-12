import { v4 as uuidv4 } from 'uuid';

import { useTypedSelector } from '@Store/hooks';

import { descriptionData, descriptionTitle } from '@Constants/droneOperator';
import DescriptionBoxComponent from './DescriptionComponent';
import QuestionBox from '../QuestionBox';

const DescriptionBox = () => {
  const secondPageStates = useTypedSelector(state => state.droneOperatorTask);
  const { secondPage } = secondPageStates;

  return (
    <>
      {/* --------------Generates Description Boxes --------------------- */}
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-5">
        {descriptionData.map((details, index) => (
          <DescriptionBoxComponent
            title={descriptionTitle[index]}
            data={details}
            key={uuidv4()}
          />
        ))}
      </div>
      {!secondPage && <QuestionBox />}
    </>
  );
};

export default DescriptionBox;
