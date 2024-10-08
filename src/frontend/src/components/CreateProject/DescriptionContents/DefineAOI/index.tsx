import { DefineAOIInfo } from '@Constants/createProject';

export default function DefineAOI() {
  return DefineAOIInfo?.map(info => (
    <div className="naxatw-px-2 naxatw-py-2" key={info.key}>
      <p className="naxatw-text-body-btn">{info.key}</p>
      <p className="naxatw-py-1 naxatw-text-body-md">{info.description}</p>
    </div>
  ));
}
