import Tab from '@Components/common/Tabs';
import DescriptionSection from '@Components/RegulatorsApprovalPage/DescriptionSection';
import { tabOptions } from '@Constants/approvalPage';
import { useState } from 'react';
import InstructionSection from './InstructionSection';

const getContent = (
  selectedTab: string | number,
  projectData: Record<string, any>,
) => {
  if (selectedTab === 'about')
    return <DescriptionSection projectData={projectData} />;
  return (
    <InstructionSection
      instructions={projectData?.per_task_instructions || ''}
    />
  );
};
const DetailsTemplate = ({ projectData }: Record<string, any>) => {
  const [selectedTab, setSelectedTab] = useState<string | number>('about');

  return (
    <div className="naxatw-w-full naxatw-max-w-[30rem]">
      <Tab
        orientation="row"
        className="naxatw-bg-transparent hover:naxatw-border-b-2 hover:naxatw-border-red"
        activeClassName="naxatw-border-b-2 naxatw-bg-transparent naxatw-border-red"
        onTabChange={(val: string | number) => {
          setSelectedTab(val);
        }}
        tabOptions={tabOptions}
        activeTab={selectedTab}
        clickable
      />
      <div className="scrollbar naxatw-max-h-[calc(100vh-200px)] naxatw-overflow-y-auto">
        {getContent(selectedTab, projectData)}
      </div>
    </div>
  );
};

export default DetailsTemplate;
