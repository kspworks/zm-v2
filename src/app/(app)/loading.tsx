import { getTranslations } from "next-intl/server";

import { PageHeader } from "~/components/app/page-header";
import { Skeleton } from "~/components/ui/skeleton";

/**
 * Shown the moment a signed-in page is navigated to, while it renders. Without
 * it a dynamic route can't be prefetched, and a click changes nothing on
 * screen until the server answers.
 */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <>
      <PageHeader title={<Skeleton className="h-5 w-32" />} />
      <div
        role="status"
        className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 sm:p-6"
      >
        <span className="sr-only">{t("loading")}</span>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </>
  );
}
