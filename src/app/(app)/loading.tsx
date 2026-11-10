import {
  ItemListSkeleton,
  NarrowPageSkeleton,
} from "~/components/app/skeletons";
import { Skeleton } from "~/components/ui/skeleton";

/**
 * Shown the moment a signed-in page is navigated to, while it renders. Without
 * it a dynamic route can't be prefetched, and a click changes nothing on
 * screen until the server answers. Every page has a `loading.tsx` of its own
 * that outlines its layout; this one covers a route that lacks one.
 */
export default function Loading() {
  return (
    <NarrowPageSkeleton title={<Skeleton className="h-4 w-32" />}>
      <ItemListSkeleton />
    </NarrowPageSkeleton>
  );
}
