"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BanIcon,
  CopyIcon,
  KeyRoundIcon,
  LogOutIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldIcon,
  ShieldOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "~/components/app/confirm-dialog";
import { PageHeader } from "~/components/app/page-header";
import { ResponsiveDialog } from "~/components/app/responsive-dialog";
import { RowMenu } from "~/components/transactions/row-menu";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { useToastError } from "~/hooks/use-toast-error";
import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/types";

type User = RouterOutputs["admin"]["users"][number];
type Invite = RouterOutputs["admin"]["invites"][number];
type Scope = "password" | "twoFactor" | "both";

const copy = async (text: string, done: string) => {
  await navigator.clipboard.writeText(text);
  toast.success(done);
};

function RecoveryDialog({
  user,
  onClose,
}: {
  user: User | null;
  onClose: () => void;
}) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const format = useFormatter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const [scope, setScope] = useState<Scope>("both");
  const [url, setUrl] = useState<string | null>(null);

  const input = { userId: user?.id ?? "" };
  const links = useQuery({
    ...trpc.admin.recoveryLinks.queryOptions(input),
    enabled: user !== null,
  });
  const invalidate = () =>
    queryClient.invalidateQueries(trpc.admin.recoveryLinks.queryFilter(input));

  const create = useMutation(
    trpc.admin.createRecoveryLink.mutationOptions({
      onSuccess: async (result) => {
        setUrl(result.url);
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const revoke = useMutation(
    trpc.admin.revokeRecoveryLink.mutationOptions({
      onSuccess: invalidate,
      onError: toastError,
    }),
  );

  return (
    <ResponsiveDialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          setUrl(null);
          onClose();
        }
      }}
      title={t("recoveryTitle", { name: user?.name ?? "" })}
      description={t("recoveryDescription")}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <Field className="flex-1">
            <FieldLabel htmlFor="recovery-scope">{t("scope")}</FieldLabel>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger id="recovery-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["password", "twoFactor", "both"] as const).map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`scopes.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            disabled={create.isPending}
            onClick={() => user && create.mutate({ userId: user.id, scope })}
          >
            {create.isPending ? <Spinner /> : null}
            {t("createLink")}
          </Button>
        </div>

        {url ? (
          <div className="flex gap-2">
            <Input readOnly value={url} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              aria-label={tc("copy")}
              onClick={() => void copy(url, t("linkCopied"))}
            >
              <CopyIcon />
            </Button>
          </div>
        ) : null}

        {links.data?.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium text-muted-foreground text-sm">
              {t("activeLinks")}
            </h3>
            {links.data.map((link) => (
              <Item key={link.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{t(`scopes.${link.scope}`)}</ItemTitle>
                  <ItemDescription>
                    {t("expires", {
                      date: format.dateTime(link.expiresAt, {
                        dateStyle: "short",
                        timeStyle: "short",
                      }),
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ id: link.id })}
                  >
                    {t("revokeLink")}
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </div>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

export function UsersView({ currentUserId }: { currentUserId: string }) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const format = useFormatter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();

  const invites = useQuery(trpc.admin.invites.queryOptions());
  const users = useQuery(trpc.admin.users.queryOptions());

  const [inviteOpen, setInviteOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [deletingInvite, setDeletingInvite] = useState<Invite | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [recoveryFor, setRecoveryFor] = useState<User | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries(trpc.admin.pathFilter());
  const done = (message?: string) => async () => {
    if (message) {
      toast.success(message);
    }
    await invalidate();
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const inviteLink = (id: string) =>
    `${origin}/auth/register/invite?id=${encodeURIComponent(id)}`;

  const createInvite = useMutation(
    trpc.admin.createInvite.mutationOptions({
      onSuccess: async (invite) => {
        setInviteOpen(false);
        setComment("");
        await invalidate();

        if (invite) {
          await copy(inviteLink(invite.id), t("linkCopied"));
        }
      },
      onError: toastError,
    }),
  );
  const deleteInvite = useMutation(
    trpc.admin.deleteInvite.mutationOptions({
      onSuccess: async () => {
        setDeletingInvite(null);
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const setRole = useMutation(
    trpc.admin.setRole.mutationOptions({
      onSuccess: done(),
      onError: toastError,
    }),
  );
  const setBanned = useMutation(
    trpc.admin.setBanned.mutationOptions({
      onSuccess: done(),
      onError: toastError,
    }),
  );
  const deleteUser = useMutation(
    trpc.admin.deleteUser.mutationOptions({
      onSuccess: async () => {
        setDeletingUser(null);
        await invalidate();
      },
      onError: toastError,
    }),
  );
  const restoreUser = useMutation(
    trpc.admin.restoreUser.mutationOptions({
      onSuccess: done(),
      onError: toastError,
    }),
  );
  const revokeSessions = useMutation(
    trpc.admin.revokeSessions.mutationOptions({
      onSuccess: done(t("sessionsRevoked")),
      onError: toastError,
    }),
  );

  const dateTime = (date: Date) =>
    format.dateTime(date, { dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <PageHeader
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <PlusIcon />
            <span className="max-sm:sr-only">{t("newInvite")}</span>
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 sm:p-6">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">{t("people")}</h2>
          <ItemGroup className="gap-2">
            {users.data?.map((user) => (
              <Item
                key={user.id}
                variant="outline"
                className={cn(user.deletedAt && "opacity-60")}
              >
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full flex-wrap">
                    <span className="truncate">{user.name}</span>
                    {user.id === currentUserId ? (
                      <span className="text-muted-foreground">
                        ({t("you")})
                      </span>
                    ) : null}
                    <Badge
                      variant={user.role === "admin" ? "default" : "secondary"}
                    >
                      {t(`roles.${user.role === "admin" ? "admin" : "user"}`)}
                    </Badge>
                    {user.banned ? (
                      <Badge variant="destructive">{t("banned")}</Badge>
                    ) : null}
                    {user.deletedAt ? (
                      <Badge variant="outline">{t("deleted")}</Badge>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription className="truncate">
                    {user.email} · {t("created")} {dateTime(user.createdAt)} ·{" "}
                    {t("updated")} {dateTime(user.updatedAt)}
                  </ItemDescription>
                  <ItemDescription className="font-mono text-xs">
                    {user.id}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <RowMenu>
                    {user.deletedAt ? (
                      <DropdownMenuItem
                        onSelect={() => restoreUser.mutate({ userId: user.id })}
                      >
                        <RotateCcwIcon />
                        {t("restore")}
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem
                          onSelect={() =>
                            setRole.mutate({
                              userId: user.id,
                              role: user.role === "admin" ? "user" : "admin",
                            })
                          }
                        >
                          {user.role === "admin" ? (
                            <ShieldOffIcon />
                          ) : (
                            <ShieldIcon />
                          )}
                          {user.role === "admin"
                            ? t("makeUser")
                            : t("makeAdmin")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setRecoveryFor(user)}>
                          <KeyRoundIcon />
                          {t("recovery")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            revokeSessions.mutate({ userId: user.id })
                          }
                        >
                          <LogOutIcon />
                          {t("revokeSessions")}
                        </DropdownMenuItem>
                        {user.id === currentUserId ? null : (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                setBanned.mutate({
                                  userId: user.id,
                                  banned: !user.banned,
                                })
                              }
                            >
                              <BanIcon />
                              {user.banned ? t("unban") : t("ban")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeletingUser(user)}
                            >
                              <Trash2Icon />
                              {t("delete")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </>
                    )}
                  </RowMenu>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">{t("invites")}</h2>
          <ItemGroup className="gap-2">
            {invites.data?.map((invite) => (
              <Item key={invite.id} variant="outline" size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle className="truncate">
                    {invite.comment || invite.id.slice(0, 12)}
                  </ItemTitle>
                  <ItemDescription className="truncate">
                    {invite.userId
                      ? t("claimedBy", {
                          name: invite.userName ?? invite.userId,
                        })
                      : t("unclaimed")}{" "}
                    ·{" "}
                    {t("createdBy", {
                      name: invite.creatorName ?? invite.createdBy,
                    })}{" "}
                    · {dateTime(invite.createdAt)}
                  </ItemDescription>
                </ItemContent>
                {invite.userId ? null : (
                  <ItemActions>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copy(inviteLink(invite.id), t("linkCopied"))
                      }
                    >
                      <CopyIcon />
                      <span className="max-sm:sr-only">{t("copyLink")}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tc("delete")}
                      onClick={() => setDeletingInvite(invite)}
                    >
                      <Trash2Icon />
                    </Button>
                  </ItemActions>
                )}
              </Item>
            ))}
          </ItemGroup>
        </section>
      </div>

      <ResponsiveDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title={t("newInvite")}
        footer={
          <>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              form="invite-form"
              disabled={createInvite.isPending || !comment.trim()}
            >
              {createInvite.isPending ? <Spinner /> : null}
              {tc("create")}
            </Button>
          </>
        }
      >
        <form
          id="invite-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (comment.trim()) {
              createInvite.mutate({ comment });
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor="invite-comment">
              {t("inviteComment")}
            </FieldLabel>
            <Input
              id="invite-comment"
              maxLength={255}
              autoFocus
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
        </form>
      </ResponsiveDialog>

      <ConfirmDialog
        open={deletingInvite !== null}
        onOpenChange={(open) => !open && setDeletingInvite(null)}
        title={t("deleteInviteTitle")}
        pending={deleteInvite.isPending}
        onConfirm={() =>
          deletingInvite && deleteInvite.mutate({ id: deletingInvite.id })
        }
      />
      <ConfirmDialog
        open={deletingUser !== null}
        onOpenChange={(open) => !open && setDeletingUser(null)}
        title={t("deleteTitle", { name: deletingUser?.name ?? "" })}
        description={t("deleteDescription")}
        pending={deleteUser.isPending}
        onConfirm={() =>
          deletingUser && deleteUser.mutate({ userId: deletingUser.id })
        }
      />
      <RecoveryDialog user={recoveryFor} onClose={() => setRecoveryFor(null)} />
    </>
  );
}
