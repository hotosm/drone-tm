import { createElement } from 'react';

const HotTracker = () => {
  return createElement('hot-tracking', {
    style: { position: 'fixed', bottom: '0%' },
    'site-id': '35',
    domain: 'dronetm.org',
    force: true,
  });
};

export default HotTracker;
