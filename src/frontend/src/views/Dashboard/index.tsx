import { FlexRow } from '@Components/common/Layouts';
import { DashboardSidebar, DashboardCard } from '@Components/Dashboard';
import { dashboardCards } from '@Constants/dashboard';

export default function Dashboard() {
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
              <DashboardCard
                key={card.id}
                title={card.title}
                value={card.value}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
