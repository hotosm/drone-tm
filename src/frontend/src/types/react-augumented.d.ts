import type React from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends IntrinsicElements {
      'hot-tracking': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'site-id'?: string;
        domain?: string;
      };
    }
  }
}
