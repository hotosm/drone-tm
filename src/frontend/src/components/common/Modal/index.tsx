import React, { MouseEventHandler, ReactNode, useRef } from 'react';
import { CSSTransition } from 'react-transition-group';

interface IModalProps {
  title: string;
  subtitle?: string;
  show: boolean;
  onClose: MouseEventHandler;
  children: ReactNode;
  className?: string;
  headerContent?: string;
  zIndex?: number;
  hideCloseButton?: boolean;
}

export default function Modal({
  title,
  subtitle,
  show,
  onClose,
  children,
  className,
  headerContent,
  zIndex = 1111,
  hideCloseButton,
}: IModalProps) {
  const nodeRef = useRef(null);

  return (
    <CSSTransition
      nodeRef={nodeRef}
      in={show}
      timeout={150}
      unmountOnExit
      classNames={{
        enter: 'naxatw-opacity-0 naxatw-scale-95',
        enterActive:
          'naxatw-opacity-100 naxatw-scale-100 naxatw-transition-all naxatw-ease-in naxatw-duration-150',
        enterDone: 'naxatw-opacity-100 naxatw-scale-100',
        exit: 'naxatw-opacity-50 naxatw-scale-75 naxatw-transition-all naxatw-ease-out naxatw-duration-150',
        exitActive: 'naxatw-opacity-0 naxatw-scale-50',
      }}
    >
      <div
        tabIndex={-1}
        className={`${
          show ? '' : ''
        } naxatw-h-modal naxatw-fixed naxatw-inset-0 naxatw-z-[11111] naxatw-flex 
          naxatw-h-screen naxatw-w-screen naxatw-justify-center naxatw-overflow-y-auto naxatw-overflow-x-hidden
          naxatw-bg-grey-700/50 naxatw-p-4 md:naxatw-inset-0 md:naxatw-h-full
      `}
        style={{ zIndex }}
      >
        <div
          ref={nodeRef}
          className="naxatw-fixed naxatw-inset-0 naxatw-overflow-y-auto"
        >
          <div
            className="naxatw-flex naxatw-min-h-full naxatw-items-center 
            naxatw-justify-center naxatw-p-4"
          >
            <div
              className="naxatw-relative naxatw-flex naxatw-h-full naxatw-w-full
              naxatw-max-w-2xl naxatw-flex-col naxatw-items-center naxatw-justify-center md:naxatw-h-auto"
            >
              <div
                className={`naxatw-relative naxatw-max-h-[calc(100vh-4rem)] naxatw-w-[42rem] naxatw-overflow-hidden
                   naxatw-rounded-[20px] naxatw-bg-white naxatw-shadow ${className}`}
              >
                <div
                  className={`naxatw-flex naxatw-items-start naxatw-justify-between
                    naxatw-rounded-t-[20px] naxatw-px-7 ${
                      !subtitle && title ? 'naxatw-py-5' : 'naxatw-py-5'
                    }`}
                >
                  {headerContent || (
                    <div className="naxatw-space-y-1">
                      <h3 className="naxatw-font-bold ">{title}</h3>
                      <p className="naxatw-text-body-lg">{subtitle}</p>
                    </div>
                  )}

                  {!hideCloseButton && (
                    <button
                      type="button"
                      className="naxatw-ml-auto naxatw-inline-flex naxatw-items-center 
                      naxatw-rounded-lg naxatw-bg-transparent naxatw-p-1.5 naxatw-text-sm
                      naxatw-text-grey-800 hover:naxatw-bg-grey-200 hover:naxatw-text-grey-900"
                      onClick={onClose}
                    >
                      <i className="material-icons">close</i>
                      <span className="naxatw-sr-only">Close modal</span>
                    </button>
                  )}
                </div>
                <div className="naxatw-flex">
                  <div
                    className="scrollbar naxatw-max-h-[calc(100vh-10rem)] naxatw-grow naxatw-overflow-y-auto
                      naxatw-px-10 naxatw-pb-5"
                  >
                    {children}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CSSTransition>
  );
}
