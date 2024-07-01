/* eslint-disable no-underscore-dangle */
import { MapInstanceType } from '../types';

export default function changeLayerOrder(
  map: MapInstanceType,
  newOrder: any[],
) {
  const currentOrder = map.style._order;
  const mapLayerOrder = currentOrder.filter(item => newOrder.includes(item));
  let beforeId: any = null;
  let id: any = null;
  newOrder.forEach((item: any, idx: number) => {
    if (id) return;
    if (mapLayerOrder[idx] !== item) {
      id = item;
      beforeId = newOrder[idx + 1];
    }
  });
  if (!id) return;
  map.moveLayer(id, beforeId);
}
