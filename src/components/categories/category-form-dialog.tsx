"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormError } from "~/components/app/form-error";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { useToastError } from "~/hooks/use-toast-error";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

type Category = RouterOutputs["categories"]["list"][number];

const NO_PARENT = "__none__";

const formSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    parentId: z.string(),
    isExpense: z.boolean(),
    isIncome: z.boolean(),
  })
  .refine((value) => value.isExpense || value.isIncome, {
    error: "category_kind_required",
    path: ["isIncome"],
  });

type FormValues = z.infer<typeof formSchema>;

export function CategoryFormDialog({
  open,
  category,
  presetParentId,
  categories,
  onOpenChange,
}: {
  open: boolean;
  category: Category | null;
  /** "Add subcategory": preselects the parent of a new category */
  presetParentId: string | null;
  categories: Category[];
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      parentId: NO_PARENT,
      isExpense: true,
      isIncome: false,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: category?.name ?? "",
        parentId: category?.parentId ?? presetParentId ?? NO_PARENT,
        isExpense: category?.isExpense ?? true,
        isIncome: category?.isIncome ?? false,
      });
    }
  }, [open, category, presetParentId, form]);

  // only top-level categories other than this one can be a parent
  const parentOptions = categories.filter(
    (option) => option.parentId === null && option.id !== category?.id,
  );
  const hasChildren = (category?.childCount ?? 0) > 0;

  const onSuccess = async () => {
    toast.success(tc("saved"));
    await queryClient.invalidateQueries(trpc.categories.pathFilter());
    onOpenChange(false);
  };

  const create = useMutation(
    trpc.categories.create.mutationOptions({ onSuccess, onError: toastError }),
  );
  const update = useMutation(
    trpc.categories.update.mutationOptions({ onSuccess, onError: toastError }),
  );
  const pending = create.isPending || update.isPending;

  const submit = form.handleSubmit((values) => {
    const payload = {
      ...values,
      parentId:
        hasChildren || values.parentId === NO_PARENT ? null : values.parentId,
    };

    if (category) {
      update.mutate({ id: category.id, ...payload });
    } else {
      create.mutate(payload);
    }
  });

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={category ? t("editTitle") : t("createTitle")}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {form.formState.isDirty ? tc("cancel") : tc("close")}
          </Button>
          <Button type="submit" form="category-form" disabled={pending}>
            {pending ? <Spinner /> : null}
            {tc("save")}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} noValidate>
        <FieldGroup>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="category-name">{t("name")}</FieldLabel>
                <Input
                  {...field}
                  id="category-name"
                  autoFocus
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FormError error={fieldState.error} />
              </Field>
            )}
          />
          {hasChildren ? (
            <FieldDescription>{t("parentHidden")}</FieldDescription>
          ) : (
            <Controller
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="category-parent">
                    {t("parent")}
                  </FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="category-parent" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PARENT}>{t("noParent")}</SelectItem>
                      {parentOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          )}
          <FieldSet>
            <div className="flex gap-6">
              <Controller
                control={form.control}
                name="isExpense"
                render={({ field }) => (
                  <Field orientation="horizontal" className="w-auto">
                    <Checkbox
                      id="category-expense"
                      checked={field.value}
                      onCheckedChange={(value) =>
                        field.onChange(value === true)
                      }
                    />
                    <FieldLabel
                      htmlFor="category-expense"
                      className="font-normal"
                    >
                      {t("isExpense")}
                    </FieldLabel>
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="isIncome"
                render={({ field }) => (
                  <Field orientation="horizontal" className="w-auto">
                    <Checkbox
                      id="category-income"
                      checked={field.value}
                      onCheckedChange={(value) =>
                        field.onChange(value === true)
                      }
                    />
                    <FieldLabel
                      htmlFor="category-income"
                      className="font-normal"
                    >
                      {t("isIncome")}
                    </FieldLabel>
                  </Field>
                )}
              />
            </div>
            <FormError error={form.formState.errors.isIncome} />
          </FieldSet>
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}
