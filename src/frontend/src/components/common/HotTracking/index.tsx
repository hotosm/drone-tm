import { createElement } from 'react';

// import('@hotosm/ui/components/tracking/tracking');

const HotTracker = () => {
  return createElement('hot-tracking', {
    style: { position: 'fixed', bottom: '0%' },
    'site-id': '35',
    domain: 'dronetm.org',
    force: true,
  });
};

export default HotTracker;
