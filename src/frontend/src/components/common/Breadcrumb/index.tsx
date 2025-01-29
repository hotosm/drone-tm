import { useNavigate } from 'react-router-dom';

export interface IBreadCrumbItem {
  name: string;
  navLink: string;
}

interface IBreadCrumbProps {
  data: IBreadCrumbItem[];
}

const BreadCrumb = ({ data }: IBreadCrumbProps) => {
  const navigate = useNavigate();
  return (
    <div className="naxatw-flex naxatw-items-center naxatw-justify-start naxatw-gap-1 naxatw-p-1 naxatw-text-sm naxatw-tracking-[0.0175rem] naxatw-text-[#212121]">
      {data.map((breadCrumbItem, index) => (
        <>
          <div
            key={breadCrumbItem.name}
            onClick={() =>
              index < data.length - 1
                ? navigate(breadCrumbItem.navLink)
                : () => {}
            }
            onKeyDown={() => {}}
            tabIndex={0}
            role="button"
            className={`${index === data.length - 1 ? 'naxatw-cursor-default naxatw-font-semibold' : 'naxatw-cursor-pointer hover:naxatw-underline'}`}
          >
            {breadCrumbItem?.name}
          </div>
          {index < data.length - 1 && <div>/</div>}
        </>
      ))}
    </div>
  );
};

export default BreadCrumb;
