"use client";

import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { isErrorKey } from "~/lib/error-keys";

/** Turns a thrown tRPC error into a translated, user-facing message */
export const useErrorMessage = () => {
  const t = useTranslations("errors");

  return useCallback(
    (error: unknown): string => {
      const message =
        error instanceof TRPCClientError || error instanceof Error
          ? error.message
          : undefined;

      return isErrorKey(message) ? t(message) : t("generic");
    },
    [t],
  );
};
