/// <reference types="vite/client" />

// Auth-libs web component - declare all possible relative paths
declare module '../../../../auth-libs/web-component/dist/hanko-auth.esm.js' {
  const content: any;
  export default content;
}
declare module '../../../auth-libs/web-component/dist/hanko-auth.esm.js' {
  const content: any;
  export default content;
}
declare module '../../auth-libs/web-component/dist/hanko-auth.esm.js' {
  const content: any;
  export default content;
}
declare module '../auth-libs/web-component/dist/hanko-auth.esm.js' {
  const content: any;
  export default content;
}

// JSX IntrinsicElements for hotosm-auth web component
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'hotosm-auth': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          'hanko-url'?: string;
          'base-path'?: string;
          'show-profile'?: string | boolean;
          'redirect-after-login'?: string;
          'redirect-after-logout'?: string;
          'osm-required'?: string | boolean;
          'auto-connect'?: string | boolean;
          'verify-session'?: string | boolean;
        },
        HTMLElement
      >;
    }
  }
}
