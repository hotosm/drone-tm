import Icon from '@Components/common/Icon';
import { FlexRow } from '@Components/common/Layouts';

const mapTools = [
  {
    id: 1,
    name: 'Draw Polygon',
    iconName: 'polyline',
    onClick: () => {},
  },
  {
    id: 2,
    name: 'Draw Line',
    iconName: 'mode_edit_outline',
    onClick: () => {},
  },
  {
    id: 3,
    name: 'Reset',
    iconName: 'restart_alt',
    onClick: () => {},
  },
  {
    id: 4,
    name: 'Undo',
    iconName: 'undo',
    onClick: () => {},
  },
  {
    id: 5,
    name: 'Redo',
    iconName: 'redo',
    onClick: () => {},
  },
  {
    id: 6,
    name: 'Save',
    iconName: 'save',
    onClick: () => {},
  },
];

export default function MapTools() {
  return (
    <FlexRow
      className="naxatw-absolute naxatw-left-[55%] naxatw-top-2 naxatw-cursor-pointer naxatw-rounded-sm naxatw-bg-white naxatw-px-2 naxatw-py-1.5"
      gap={2}
    >
      {mapTools.map(tool => (
        <Icon
          key={tool.iconName}
          name={tool.iconName}
          className="hover:naxatw-text-red"
          onClick={tool.onClick}
        />
      ))}
    </FlexRow>
  );
}
