// Type declarations for HOTOSM Auth web component
declare namespace JSX {
  interface IntrinsicElements {
    'hotosm-auth': {
      'hanko-url'?: string;
      'show-profile'?: string | boolean;
      'redirect-after-login'?: string;
      'osm-required'?: string | boolean;
      'auto-connect'?: string | boolean;
    };
    'hanko-auth': {
      api?: string;
      'redirect-to'?: string;
    };
  }
}
