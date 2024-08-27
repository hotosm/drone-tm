/* eslint-disable no-unused-vars */
/* eslint-disable react/no-danger */
import { useEffect, useRef, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { Popup } from 'maplibre-gl';
import type { MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@Components/common/MapLibreComponents/map.css';
import { Button } from '@Components/RadixComponents/Button';
import Skeleton from '@Components/RadixComponents/Skeleton';
import { IAsyncPopup } from '../types';

const popup = new Popup({
  closeOnClick: false,
  closeButton: false,
});

export default function AsyncPopup({
  map,
  fetchPopupData,
  popupUI,
  title,
  handleBtnClick,
  isLoading = false,
  onClose,
  buttonText = 'View More',
  hideButton = false,
  getCoordOnProperties = false,
  showPopup = (_clickedFeature: Record<string, any>) => true,
}: IAsyncPopup) {
  const [properties, setProperties] = useState<Record<string, any> | null>(
    null,
  );
  const popupRef = useRef(null);
  const [popupHTML, setPopupHTML] = useState<string>('');

  useEffect(() => {
    if (!map) return;
    function displayPopup(e: MapMouseEvent): void {
      if (!map) return;
      const features = map.queryRenderedFeatures(e.point);
      const clickedFeature = features?.[0];

      // in case of popup rendering conditionally
      if (!showPopup(clickedFeature)) return;

      if (!clickedFeature) return;
      setProperties(
        getCoordOnProperties
          ? {
              ...clickedFeature.properties,
              layer: clickedFeature.source,
              coordinates: e.lngLat,
            }
          : {
              ...clickedFeature.properties,
              layer: clickedFeature.source,
            },
      );

      popup.setLngLat(e.lngLat);
    }
    map.on('click', displayPopup);
  }, [map, getCoordOnProperties, showPopup]);

  useEffect(() => {
    if (!map || !properties) return;
    fetchPopupData?.(properties);
  }, [map, properties]); // eslint-disable-line

  useEffect(() => {
    if (!map || !properties || !popupUI || !popupRef.current) return;
    const htmlString = renderToString(popupUI(properties));
    popup.setDOMContent(popupRef.current).addTo(map);
    setPopupHTML(htmlString);
  }, [map, popupUI, properties]);

  const onPopupClose = () => {
    popup.remove();
    onClose?.();
    setProperties(null);
  };

  if (!properties) return <div />;

  return (
    <div
      ref={popupRef}
      className={`naxatw-w-[17.5rem] naxatw-px-3 ${hideButton ? 'naxatw-pb-3' : ''}`}
    >
      <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-py-2">
        {isLoading ? (
          <Skeleton className="naxatw-my-3 naxatw-h-4 naxatw-w-1/2 naxatw-rounded-md naxatw-bg-grey-100 naxatw-shadow-sm" />
        ) : (
          <p className="naxatw-text-body-btn naxatw-text-red">{title}</p>
        )}
        <span
          role="button"
          tabIndex={0}
          className="naxatw-text-grey-600"
          onClick={onPopupClose}
          onKeyDown={() => {}}
        >
          <i className="material-symbols-outlined">close</i>
        </span>
      </div>
      <div dangerouslySetInnerHTML={{ __html: popupHTML }} />
      {!isLoading && !hideButton && (
        <div className="naxatw-flex naxatw-items-center naxatw-p-3">
          <Button
            className="naxatw-mx-auto naxatw-bg-red naxatw-font-primary naxatw-text-white"
            size="sm"
            onClick={() => handleBtnClick?.(properties)}
          >
            {buttonText}
          </Button>
        </div>
      )}
    </div>
  );
}
