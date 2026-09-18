"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { useErrorMessage } from "~/hooks/use-error-message";

/** Shows a translated error toast for 15 s */
export const useToastError = () => {
  const errorMessage = useErrorMessage();

  return useCallback(
    (error: unknown) => {
      toast.error(errorMessage(error), { duration: 15_000 });
    },
    [errorMessage],
  );
};
