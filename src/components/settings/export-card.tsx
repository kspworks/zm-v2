"use client";

import { useMutation } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Spinner } from "~/components/ui/spinner";
import { useToastError } from "~/hooks/use-toast-error";
import { useTRPC } from "~/trpc/react";

const download = (
  file: { filename: string; content: string },
  type: string,
) => {
  // the byte-order mark lets Excel read the Cyrillic in a CSV correctly
  const body = type === "text/csv" ? `﻿${file.content}` : file.content;
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");

  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
};

export function ExportCard() {
  const t = useTranslations("exports");
  const trpc = useTRPC();
  const toastError = useToastError();
  const csv = useMutation(
    trpc.exports.csv.mutationOptions({
      onSuccess: (file) => download(file, "text/csv"),
      onError: toastError,
    }),
  );
  const json = useMutation(
    trpc.exports.json.mutationOptions({
      onSuccess: (file) => download(file, "application/json"),
      onError: toastError,
    }),
  );

  return (
    <Card id="export">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button disabled={csv.isPending} onClick={() => csv.mutate()}>
          {csv.isPending ? <Spinner /> : <DownloadIcon />}
          {t("csv")}
        </Button>
        <Button
          variant="outline"
          disabled={json.isPending}
          onClick={() => json.mutate()}
        >
          {json.isPending ? <Spinner /> : <DownloadIcon />}
          {t("json")}
        </Button>
      </CardContent>
    </Card>
  );
}
