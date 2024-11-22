import { useGetDashboardTaskStaticsQuery } from '@Api/dashboard';
import { DashboardSidebar, DashboardCard } from '@Components/Dashboard';
import { DashboardCardSkeleton } from '@Components/Dashboard/DashboardCard';
import RequestLogs from '@Components/Dashboard/RequestLogs';
import TaskLogs from '@Components/Dashboard/TaskLogs';
import {
  dashboardCardsForDroneOperator,
  dashboardCardsForProjectCreator,
} from '@Constants/dashboard';
import hasErrorBoundary from '@Utils/hasErrorBoundary';
import { useState } from 'react';

const getContent = (activeTab: string, title: string) => {
  if (activeTab === 'request_logs') return <RequestLogs />;
  return <TaskLogs title={title} />;
};

const Dashboard = () => {
  const signedInAs = localStorage.getItem('signedInAs') || 'PROJECT_CREATOR';
  const [activeTab, setActiveTab] = useState(
    signedInAs === 'PROJECT_CREATOR'
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
    signedInAs === 'PROJECT_CREATOR'
      ? dashboardCardsForProjectCreator
      : dashboardCardsForDroneOperator;

  const { data: taskStatistics, isLoading }: Record<string, any> =
    useGetDashboardTaskStaticsQuery({
      select: (data: any) => {
        const taskCounts: Record<string, any> = data?.data;
        return dashboardCards?.map(card => ({
          ...card,
          count: taskCounts?.[`${card?.value}`],
        }));
      },
    });

  return (
    <section className="naxatw-flex naxatw-h-screen-nav naxatw-flex-col naxatw-px-3 md:naxatw-px-16">
      <h5 className="naxatw-py-4 naxatw-font-bold">Profile</h5>
      <div className="naxatw-grid naxatw-h-full naxatw-w-full naxatw-grid-cols-10 naxatw-gap-5">
        <div className="naxatw-col-span-10 naxatw-py-4 md:naxatw-col-span-3">
          <DashboardSidebar />
        </div>
        <div className="naxatw-col-span-10 naxatw-flex naxatw-w-full naxatw-flex-col naxatw-py-4 md:naxatw-col-span-7">
          <div className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-5 lg:naxatw-grid-cols-4">
            {isLoading ? (
              <>
                {Array.from({ length: 4 }, (_, index) => (
                  <DashboardCardSkeleton key={index} />
                ))}
              </>
            ) : (
              taskStatistics?.map((task: any) => (
                <div
                  key={task.id}
                  tabIndex={0}
                  role="button"
                  onKeyUp={() =>
                    setActiveTab({ value: task.value, title: task.title })
                  }
                  onClick={() =>
                    setActiveTab({ value: task.value, title: task.title })
                  }
                  className="naxatw-w-full naxatw-cursor-pointer md:naxatw-w-auto"
                >
                  <DashboardCard
                    title={task.title}
                    count={task?.count}
                    active={task.value === activeTab.value}
                  />
                </div>
              ))
            )}
          </div>
          {getContent(activeTab.value, activeTab.title)}
        </div>
      </div>
    </section>
  );
};

export default hasErrorBoundary(Dashboard);
