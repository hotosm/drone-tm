/* eslint-disable no-nested-ternary */
import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { motion } from 'framer-motion';

import { Button } from '@Components/RadixComponents/Button';
import Tab from '@Components/common/Tabs';
import { useTypedDispatch, useTypedSelector } from '@Store/hooks';
import FileUpload from '@Components/common/UploadArea';
import { descriptionData, descriptionTitle } from '@Constants/droneOperator';
import { setSecondPageState } from '@Store/actions/droneOperatorTask';
import DescriptionBoxComponent from './DescriptionBox';
import QuestionBox from './QuestionBox';

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

const UploadsBox = () => {
  return (
    <>
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-5">
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            Upload Raw Image
          </p>

          <FileUpload
            name="outline_geojson"
            data={[]}
            // onChange={handleProjectAreaFileChange}
            fileAccept=".geojson, .kml"
            placeholder="*The supported file formats are jpeg,pn"
            // isValid={validateAreaOfFileUpload}
            // {...formProps}
            control={() => {}}
            register={() => {}}
          />
        </div>
        <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-gap-3">
          <p className="naxatw-text-[0.875rem] naxatw-font-semibold naxatw-leading-normal naxatw-tracking-[0.0175rem] naxatw-text-[#D73F3F]">
            Upload GCP File
          </p>

          <FileUpload
            name="outline_geojson"
            data={[]}
            // onChange={handleProjectAreaFileChange}
            fileAccept=".geojson, .kml"
            placeholder="*The supported file formats are  csv, xlsx"
            // isValid={validateAreaOfFileUpload}
            // {...formProps}
            control={() => {}}
            register={() => {}}
          />
        </div>
        <Button
          variant="ghost"
          className="naxatw-w-fit naxatw-bg-[#D73F3F] naxatw-text-[#FFFFFF]"
        >
          Save
        </Button>
      </div>
    </>
  );
};

const DroneOperatorDescriptionBox = () => {
  const secondPageStates = useTypedSelector(state => state.droneOperatorTask);
  const { secondPageState, secondPage } = secondPageStates;
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    setAnimated(true);
    setTimeout(() => {
      setAnimated(false);
    }, 100);
  }, [secondPageState, secondPage]);
  const variants = {
    open: { opacity: 1, y: 0 },
    closed: { opacity: 0, y: '50%' },
  };
  const renderComponent = (role: string) => {
    switch (role) {
      case 'description':
        return (
          <motion.div
            animate={animated ? 'closed' : 'open'}
            variants={{ ...variants }}
            className="naxatw-w-full"
          >
            <DescriptionBox />
          </motion.div>
        );
      case 'uploads':
        return (
          <motion.div
            animate={animated ? 'closed' : 'open'}
            variants={{ ...variants }}
            className="naxatw-w-full"
          >
            <UploadsBox />
          </motion.div>
        );
      default:
        return (
          <motion.div
            animate={animated ? 'closed' : 'open'}
            variants={{ ...variants }}
            className="naxatw-w-full"
          >
            <DescriptionBox />
          </motion.div>
        );
    }
  };
  const dispatch = useTypedDispatch();

  const headerTabOptions = [
    {
      id: 1,
      label: 'Description',
      value: 'description',
    },
    {
      id: 2,
      label: 'Uploads',
      value: 'uploads',
    },
  ];

  return (
    <>
      <div className="naxatw-flex naxatw-w-full naxatw-flex-col naxatw-items-start naxatw-gap-5">
        <div className="naxatw-flex naxatw-w-full naxatw-items-center naxatw-justify-between naxatw-self-stretch">
          <p className="naxatw-text-[0.875rem] naxatw-font-normal naxatw-leading-normal naxatw-text-[#484848]">
            Task #74936
          </p>
          <Button
            variant="ghost"
            className="naxatw-border naxatw-border-[#D73F3F] naxatw-text-[0.875rem] naxatw-text-[#D73F3F]"
            leftIcon="download"
            iconClassname="naxatw-text-[1.125rem]"
          >
            Download Flight Plan
          </Button>
        </div>
        <Tab
          onTabChange={value => {
            dispatch(setSecondPageState(value));
          }}
          tabOptions={headerTabOptions}
          activeTab={secondPageState}
          orientation="row"
          className={`naxatw-h-[3rem] naxatw-border-b naxatw-bg-transparent hover:naxatw-border-b-2 hover:naxatw-border-red ${!secondPage ? 'naxatw-hidden' : 'naxatw-block'}`}
          activeClassName="naxatw-border-b-2 naxatw-bg-transparent naxatw-border-red"
          clickable
        />
        {renderComponent(secondPageState)}
      </div>
    </>
  );
};

export default DroneOperatorDescriptionBox;
