import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { getLocale, setLocale, locales, getLocaleDisplayName } from "@/i18n";

interface LanguageSwitcherProps {
  className?: string;
}

export default function LanguageSwitcher({ className = "" }: LanguageSwitcherProps) {
  const current = getLocale();
  const [open, setOpen] = useState(false);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="Select language"
          style={{ border: 0, padding: 0, background: "transparent", lineHeight: 1 }}
          className={`naxatw-group naxatw-inline-flex naxatw-h-8 naxatw-items-center naxatw-gap-1 naxatw-text-inherit focus:naxatw-outline-none ${className}`}
        >
          <span className="group-hover:naxatw-underline">{getLocaleDisplayName(current)}</span>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 0 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="naxatw-z-50 naxatw-min-w-[8rem] naxatw-overflow-hidden naxatw-rounded-md naxatw-border naxatw-border-grey-200 naxatw-bg-white naxatw-py-1 naxatw-text-grey-800 naxatw-shadow-lg naxatw-outline-none data-[state=open]:naxatw-animate-in data-[state=closed]:naxatw-animate-out data-[state=closed]:naxatw-fade-out-0 data-[state=open]:naxatw-fade-in-0"
        >
          {locales.map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => {
                setLocale(locale);
                setOpen(false);
              }}
              className={`naxatw-block naxatw-w-full naxatw-cursor-pointer naxatw-px-4 naxatw-py-1.5 naxatw-text-left naxatw-text-body-sm hover:naxatw-bg-grey-100 ${
                locale === current ? "naxatw-bg-grey-100 naxatw-font-semibold" : ""
              }`}
            >
              {getLocaleDisplayName(locale)}
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
