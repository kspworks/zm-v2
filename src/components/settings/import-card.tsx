"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import {
  AlertCircleIcon,
  FileUpIcon,
  HistoryIcon,
  Undo2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "~/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import { Spinner } from "~/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useToastError } from "~/hooks/use-toast-error";
import { isErrorKey } from "~/lib/error-keys";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

const MAX_BYTES = 256 * 1024;

type RowError = { line: number; field: string; key: string };
type ImportItem = RouterOutputs["imports"]["list"][number];

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const rowErrorsOf = (error: unknown): RowError[] | null => {
  if (!(error instanceof TRPCClientError)) {
    return null;
  }

  const rows = (error.data as { importErrors?: RowError[] | null } | undefined)
    ?.importErrors;

  return rows?.length ? rows : null;
};

export function ImportCard() {
  const t = useTranslations("import");
  const te = useTranslations("errors");
  const format = useFormatter();
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rowErrors, setRowErrors] = useState<RowError[] | null>(null);
  const [undoing, setUndoing] = useState<ImportItem | null>(null);

  const history = useQuery(trpc.imports.list.queryOptions());

  const invalidateAll = () => queryClient.invalidateQueries();

  const upload = useMutation(
    trpc.imports.upload.mutationOptions({
      onSuccess: async (summary) => {
        toast.success(t("done", { count: summary.transactions }));
        await invalidateAll();
        router.push("/transactions");
      },
      onError: (error) => {
        const rows = rowErrorsOf(error);

        if (rows) {
          setRowErrors(rows);
        } else {
          toastError(error);
        }
      },
    }),
  );

  const undo = useMutation(
    trpc.imports.undo.mutationOptions({
      onSuccess: async () => {
        toast.success(t("undone"));
        setUndoing(null);
        await invalidateAll();
      },
      onError: toastError,
    }),
  );

  const onFile = async (file: File | undefined) => {
    setRowErrors(null);

    if (!file) {
      return;
    }

    if (file.size > MAX_BYTES) {
      toast.error(t("tooBig"));
      return;
    }

    upload.mutate({ fileName: file.name, content: await readBase64(file) });

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <>
      <Card id="import">
        <CardHeader>
          <CardTitle>{t("upload")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            id="import-file"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          <Button
            className="self-start"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {upload.isPending ? <Spinner /> : <FileUpIcon />}
            {upload.isPending ? t("importing") : t("choose")}
          </Button>

          {rowErrors ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>{t("errorsTitle")}</AlertTitle>
              <AlertDescription className="min-w-0">
                <Table className="mt-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("line")}</TableHead>
                      <TableHead>{t("field")}</TableHead>
                      <TableHead>{t("problem")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowErrors.slice(0, 100).map((row) => (
                      <TableRow key={`${row.line}-${row.field}`}>
                        <TableCell className="tabular-nums">
                          {row.line}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.field}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {isErrorKey(row.key) ? te(row.key) : row.key}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AlertDescription>
            </Alert>
          ) : null}

          <h3 className="font-semibold text-sm">{t("history")}</h3>
          {history.data?.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HistoryIcon />
                </EmptyMedia>
                <EmptyDescription>{t("historyEmpty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {history.data?.map((item) => (
                <Item key={item.id} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="truncate">{item.fileName}</ItemTitle>
                    <ItemDescription>
                      {format.dateTime(item.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}{" "}
                      · {t("counts", item)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUndoing(item)}
                    >
                      <Undo2Icon />
                      {t("undo")}
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={undoing !== null}
        onOpenChange={(open) => !open && setUndoing(null)}
        title={t("undoTitle", { name: undoing?.fileName ?? "" })}
        description={t("undoDescription")}
        pending={undo.isPending}
        onConfirm={() => undoing && undo.mutate({ id: undoing.id })}
      />
    </>
  );
}
