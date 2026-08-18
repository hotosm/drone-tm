import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements extends IntrinsicElements {
      "hot-tracking": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        "site-id"?: string;
        domain?: string;
      };
      "hot-announcement": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        version?: string;
        title?: string;
        message?: string;
        variant?: "brand" | "success" | "neutral" | "warning";
        "dismiss-label"?: string;
        "storage-key"?: string;
      };
    }
  }
}
