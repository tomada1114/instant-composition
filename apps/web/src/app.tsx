import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";

import { CatalogProvider } from "./i18n/provider";
import { beginVisit } from "./lib/endpoints";
import { KeyMode } from "./lib/key-mode";
import { createQueryClient } from "./lib/queries";
import { createAppRouter } from "./router";

/** The document's title and description, from the catalog rather than `index.html`. */
function DocumentMetadata(): null {
  const t = useTranslations("Metadata");
  const title = t("title");
  const description = t("description");
  useEffect(() => {
    document.title = title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", description);
  }, [title, description]);
  return null;
}

/** A mount of the app is a new visit: its own cache, and nobody yet known to be signed in. */
function startVisit(): QueryClient {
  beginVisit();
  return createQueryClient();
}

/**
 * The whole client: the catalog, one query cache and one router per mount, so
 * a second mount — a test's — starts from nothing.
 */
export function App(): ReactElement {
  const [queryClient] = useState(startVisit);
  const [router] = useState(createAppRouter);
  return (
    <CatalogProvider>
      <QueryClientProvider client={queryClient}>
        <DocumentMetadata />
        <RouterProvider router={router} />
        <KeyMode />
      </QueryClientProvider>
    </CatalogProvider>
  );
}
