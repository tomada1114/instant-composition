import type { ReactElement, ReactNode } from "react";
import { IntlProvider } from "use-intl";

import { LOCALE, MESSAGES } from "./messages";

/** The catalog, for every `useTranslations` below it. */
export function CatalogProvider({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <IntlProvider locale={LOCALE} messages={MESSAGES}>
      {children}
    </IntlProvider>
  );
}
