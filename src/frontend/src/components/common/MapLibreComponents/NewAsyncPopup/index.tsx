/* eslint-disable jsx-a11y/interactive-supports-focus */
/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable react/display-name */
/* eslint-disable no-unused-vars */
/* eslint-disable react/no-danger */
import '@Components/common/MapLibreComponents/map.css';
import { Button } from '@Components/RadixComponents/Button';
import Skeleton from '@Components/RadixComponents/Skeleton';
import type { LngLatLike, MapMouseEvent } from 'maplibre-gl';
import { Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { IAsyncPopup } from '../types';

const popup = new Popup({
  closeOnClick: false,
  closeButton: false,
});

interface IPopupUIComponent {
  isLoading: boolean;
  popupUI: any;
  properties: Record<string, any>;
  title: string;
  hideButton: boolean;
  buttonText?: string;
  closeFn: () => void;
}

function PopupUIComponent({
  isLoading,
  popupUI,
  properties,
  title,
  hideButton,
  buttonText = 'View More',
  closeFn,
}: IPopupUIComponent) {
  const popupHTML = useMemo(
    () => renderToString(popupUI(properties)),
    [popupUI, properties],
  );
  return (
    <div className="naxatw-relative naxatw-w-[17.5rem] naxatw-bg-transparent naxatw-px-3">
      <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-py-2">
        {isLoading ? (
          <Skeleton className="naxatw-my-3 naxatw-h-4 naxatw-w-1/2 naxatw-rounded-md naxatw-bg-grey-100 naxatw-shadow-sm" />
        ) : (
          <p className="naxatw-btn-text naxatw-text-primary-400 naxatw-text-red">
            {title}
          </p>
        )}
        <span
          id="popup-close-button"
          onClick={closeFn}
          role="button"
          className="naxatw-absolute naxatw-right-3 naxatw-top-1 naxatw-cursor-pointer naxatw-rounded-full naxatw-text-grey-600 hover:naxatw-bg-green-100"
        >
          <i className="material-symbols-outlined">close</i>
        </span>
      </div>
      <div dangerouslySetInnerHTML={{ __html: popupHTML }} />
      <div className="naxatw-flex naxatw-w-full naxatw-justify-center naxatw-py-2">
        {!isLoading && !hideButton && (
          <Button
            variant="link"
            size="sm"
            id="popup-button"
            className="naxatw-bg-red naxatw-text-white naxatw-no-underline hover:naxatw-underline"
          >
            {buttonText}
          </Button>
        )}
      </div>
    </div>
  );
}

const AsyncPopup = forwardRef<HTMLDivElement, IAsyncPopup>(
  (
    {
      map,
      fetchPopupData,
      popupUI,
      title,
      handleBtnClick,
      buttonText,
      isLoading = false,
      onClose,
      hideButton = false,
      getCoordOnProperties = false,
      showPopup = (_clickedFeature: Record<string, any>) => true,
      openPopupFor,
      popupCoordinate,
      closePopupOnButtonClick,
    }: IAsyncPopup,
    ref,
  ) => {
    const [properties, setProperties] = useState<Record<string, any> | null>(
      null,
    );
    const [coordinates, setCoordinates] = useState<number[]>();
    const [isPopupOpen, setIsPopupOpen] = useState(false);

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

        setCoordinates(e.lngLat as unknown as number[]);
        // popup.setLngLat(e.lngLat);
      }
      map.on('click', displayPopup);
    }, [map, getCoordOnProperties, showPopup]);

    useEffect(() => {
      if (!map || !properties) return;
      fetchPopupData?.(properties);
    }, [map, properties]); // eslint-disable-line

    useEffect(() => {
      if (!map || !properties || !popupUI) return;
      const htmlString = renderToString(
        <PopupUIComponent
          isLoading={isLoading}
          popupUI={popupUI}
          properties={properties}
          title={title as string}
          hideButton={hideButton as boolean}
          closeFn={onClose as () => void}
          buttonText={buttonText}
        />,
      );
      popup.setHTML(htmlString).addTo(map);
      popup.setLngLat(coordinates as LngLatLike);
      setIsPopupOpen(true);
    }, [
      handleBtnClick,
      hideButton,
      isLoading,
      map,
      onClose,
      popupUI,
      properties,
      title,
      coordinates,
      buttonText,
    ]);

    useEffect(() => {
      if (!map || !openPopupFor || !popupCoordinate) return;
      setProperties(openPopupFor);
      setCoordinates(popupCoordinate);
    }, [map, openPopupFor, popupCoordinate]);

    useEffect(() => {
      const closeBtn = document.getElementById('popup-close-button');
      const popupBtn = document.getElementById('popup-button');

      const handleCloseBtnClick = () => {
        popup.remove();
        onClose?.();
        setProperties(null);
        setIsPopupOpen(false);
      };

      const handlePopupBtnClick = () => {
        if (!properties) return;
        handleBtnClick?.(properties);
        if (closePopupOnButtonClick) handleCloseBtnClick();
      };

      closeBtn?.addEventListener('click', handleCloseBtnClick);
      popupBtn?.addEventListener('click', handlePopupBtnClick);

      return () => {
        closeBtn?.removeEventListener('click', handleCloseBtnClick);
        popupBtn?.removeEventListener('click', handlePopupBtnClick);
      };
    }, [
      onClose,
      isPopupOpen,
      properties,
      handleBtnClick,
      closePopupOnButtonClick,
    ]);

    if (!properties) return <div />;
    return null;
  },
);
export default AsyncPopup;
