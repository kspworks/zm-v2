"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { useToastError } from "~/hooks/use-toast-error";
import type { ShareEntity } from "~/lib/validators/sharing";
import { useTRPC } from "~/trpc/react";

export function ShareDialog({
  entity,
  target,
  onOpenChange,
}: {
  entity: ShareEntity;
  target: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("sharing");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const [email, setEmail] = useState("");
  const [canWrite, setCanWrite] = useState(false);

  const input = { entity, id: target?.id ?? "" };
  const members = useQuery({
    ...trpc.sharing.list.queryOptions(input),
    enabled: target !== null,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries(trpc.sharing.list.queryFilter(input));
    await queryClient.invalidateQueries(
      entity === "account"
        ? trpc.accounts.pathFilter()
        : trpc.categories.pathFilter(),
    );
  };

  const add = useMutation(
    trpc.sharing.add.mutationOptions({
      onSuccess: async () => {
        toast.success(t("added", { email }));
        setEmail("");
        setCanWrite(false);
        await invalidate();
      },
      onError: toastError,
    }),
  );

  const revoke = useMutation(
    trpc.sharing.revoke.mutationOptions({
      onSuccess: invalidate,
      onError: toastError,
    }),
  );

  return (
    <ResponsiveDialog
      open={target !== null}
      onOpenChange={onOpenChange}
      title={t("title", { name: target?.name ?? "" })}
      description={t("description")}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (target && email.trim()) {
            add.mutate({ ...input, email: email.trim(), canWrite });
          }
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="share-email">{t("email")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="share-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
              />
              <Button type="submit" disabled={add.isPending || !email.trim()}>
                {add.isPending ? <Spinner /> : null}
                {t("add")}
              </Button>
            </div>
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="share-write"
              checked={canWrite}
              onCheckedChange={setCanWrite}
            />
            <FieldLabel htmlFor="share-write" className="font-normal">
              {t("canWrite")}
            </FieldLabel>
          </Field>
        </FieldGroup>
      </form>

      <div className="mt-6 flex flex-col gap-2">
        <h3 className="font-medium text-muted-foreground text-sm">
          {t("members")}
        </h3>
        {members.isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <ItemGroup className="gap-2">
            {members.data?.map((member) => (
              <Item key={member.userId} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    {member.name}
                    {member.isSelf ? (
                      <span className="text-muted-foreground">
                        ({t("you")})
                      </span>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription>{member.email}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {member.isOwner ? (
                    <Badge variant="secondary">{t("owner")}</Badge>
                  ) : (
                    <>
                      <Badge variant="outline">
                        {member.canWrite ? t("readWrite") : t("readOnly")}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("revoke")}
                        disabled={revoke.isPending}
                        onClick={() =>
                          revoke.mutate({ ...input, userId: member.userId })
                        }
                      >
                        <UserMinusIcon />
                      </Button>
                    </>
                  )}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>
    </ResponsiveDialog>
  );
}
