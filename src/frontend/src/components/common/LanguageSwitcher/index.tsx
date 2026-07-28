import WaDropdown from '@awesome.me/webawesome/dist/react/dropdown/index.js';
import WaDropdownItem from '@awesome.me/webawesome/dist/react/dropdown-item/index.js';
import WaButton from '@awesome.me/webawesome/dist/react/button/index.js';
import type { WaSelectEvent } from '@awesome.me/webawesome/dist/events/events.js';
import { setLocale, locales, getLocaleDisplayName } from '@/i18n';
import type { Locale } from '@/paraglide/runtime';
import translateIcon from '@Assets/icons/translate.svg';
export default function LanguageSwitcher() {
  const handleLanguageSelect = (event: WaSelectEvent) => {
    const selectedLang = (event.detail.item as HTMLElement & { value: string })
      .value as Locale;
    setLocale(selectedLang);
  };

  return (
    <WaDropdown onWaSelect={handleLanguageSelect}>
      <WaButton slot="trigger" appearance="plain">
        <img src={translateIcon} alt="" className="naxatw-h-4 naxatw-w-4" />
      </WaButton>
      {locales.map(locale => (
        <WaDropdownItem key={locale} value={locale}>
          {getLocaleDisplayName(locale)}
        </WaDropdownItem>
      ))}
    </WaDropdown>
  );
}
