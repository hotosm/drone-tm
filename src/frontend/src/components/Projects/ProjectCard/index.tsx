import MapSection from './MapSection';

export default function ProjectCard({ containerId }: { containerId: string }) {
  return (
    <div className="!naxatw-col-span-1 naxatw-rounded-md naxatw-border naxatw-border-grey-400 naxatw-p-[0.625rem]">
      <MapSection containerId={containerId} />
      <p className="naxatw-mt-2 naxatw-text-body-sm">ID: #12468</p>
      <p className="naxatw-text-body-btn naxatw-text-grey-800">
        Lorem ipsum dolor sit amet consectur
      </p>
      <p className="naxatw-text-body-sm">
        Cameroon RoLorem ipsum dolor sit amet consec.Lorem ipsum dolor sit amet
        consectetur.Lorem ipsum dolor sit amet consectetur.ad Assessment for
        Sustainable Development in Rural Communities in Africa
      </p>
    </div>
  );
}
