import { useGetRequestedTasksListQuery } from '@Api/dashboard';
import { FlexRow } from '@Components/common/Layouts';
import { DashboardSidebar, DashboardCard } from '@Components/Dashboard';
import RequestLogs from '@Components/Dashboard/RequestLogs';
import TaskLogs from '@Components/Dashboard/TaskLogs';
import {
  dashboardCardsForDroneOperator,
  dashboardCardsForProjectCreator,
} from '@Constants/dashboard';
import { useState } from 'react';

const getContent = (activeTab: string, title: string) => {
  if (activeTab === 'request_logs') return <RequestLogs />;
  return <TaskLogs title={title} />;
};

export default function Dashboard() {
  const signedInAs = localStorage.getItem('signedInAs') || 'Project Creator';
  const [activeTab, setActiveTab] = useState(
    signedInAs === 'Project Creator'
      ? {
          value: 'request_logs',
          title: 'Request Logs',
        }
      : {
          value: 'ongoing_tasks',
          title: 'Ongoing Tasks',
        },
  );
  const dashboardCards =
    signedInAs === 'Project Creator'
      ? dashboardCardsForProjectCreator
      : dashboardCardsForDroneOperator;

  const { data: requestedTasks } = useGetRequestedTasksListQuery({
    select: (data: any) => data.data,
  });

  return (
    <section className="naxatw-h-screen-nav naxatw-bg-grey-50 naxatw-px-16 naxatw-pt-8">
      <FlexRow className="naxatw-mb-4 naxatw-py-3">
        <h5 className="naxatw-font-bold">Profile</h5>
      </FlexRow>
      <div className="naxatw-grid naxatw-h-[595px] naxatw-grid-cols-5 naxatw-gap-5">
        <DashboardSidebar />
        <div className="naxatw-col-span-4">
          <div className="naxatw-grid naxatw-grid-cols-4 naxatw-gap-5">
            {dashboardCards.map(card => (
              <div
                key={card.id}
                tabIndex={0}
                role="button"
                onKeyUp={() =>
                  setActiveTab({ value: card.value, title: card.title })
                }
                onClick={() =>
                  setActiveTab({ value: card.value, title: card.title })
                }
                className="naxatw-cursor-pointer"
              >
                <DashboardCard
                  title={card.title}
                  value={
                    // @ts-ignore
                    card?.value === 'request_logs' ? requestedTasks?.length : 0
                  }
                  active={card.value === activeTab.value}
                />
              </div>
            ))}
          </div>
          {getContent(activeTab.value, activeTab.title)}
        </div>
      </div>
    </section>
  );
}
