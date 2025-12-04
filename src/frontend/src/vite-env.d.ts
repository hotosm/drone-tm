/// <reference types="vite/client" />

export {};

// Auth-libs web component module declaration
declare module '../../../../auth-libs/web-component/dist/hanko-auth.esm.js';

// JSX IntrinsicElements for custom web components
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'hotosm-auth': {
        'hanko-url'?: string;
        'base-path'?: string;
        'show-profile'?: string | boolean;
        'redirect-after-login'?: string;
        'redirect-after-logout'?: string;
        'osm-required'?: string | boolean;
        'auto-connect'?: string | boolean;
        'verify-session'?: string | boolean;
      };
    }
  }
}
