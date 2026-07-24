import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserMinus } from "lucide-react";
import { Button, IconButton } from "../../../components/ui/Button";
import { Field } from "../../../components/ui/Field";
import { Spinner } from "../../../components/ui/Spinner";
import { Table } from "../../../components/ui/Table";
import { rpcError, shopClient, userClient } from "../../../api/clients";
import type { PublicUser } from "../../../gen/warehouse/user/v1/user_pb";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { UserItem } from "../../../components/UserItem";
import { UserSelect } from "../../../components/UserSelect";
import { toaster } from "../../../components/Toaster";

// ShopUsersSection manages who may work on a shop (#86). It lists the granted users (resolving the
// opaque ids to names via UserByIDs), adds one via the shared UserSelect (unscoped — grant anyone),
// and removes with a confirm. Scoped to the shop's team; the backend is the real gate.
export function ShopUsersSection({ teamId, shopId }: { teamId: bigint; shopId: bigint }) {
  const { t } = useTranslation();
  const [userIds, setUserIds] = useState<bigint[]>([]);
  const [users, setUsers] = useState<Record<string, PublicUser>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<bigint | undefined>(undefined);
  const [removing, setRemoving] = useState<{ id: bigint; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await shopClient.shopUserList({ teamId, shopId, page: { page: 1, limit: 100 } });
      setUserIds(res.userIds);

      if (res.userIds.length > 0) {
        const resolved = await userClient.userByIDs({ ids: res.userIds });
        setUsers(resolved.data);
      } else {
        setUsers({});
      }
    } catch (err) {
      setError(rpcError(err));
      setUserIds([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (adding === undefined) {
      return;
    }

    setBusy(true);

    try {
      await shopClient.shopUserAdd({ teamId, shopId, userId: adding });
      toaster.create({ type: "success", title: t("shops.users.userAdded") });
      setAdding(undefined);
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.users.addFailed"), description: rpcError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: bigint) {
    try {
      await shopClient.shopUserRemove({ teamId, shopId, userId });
      toaster.create({ type: "success", title: t("shops.users.accessRemoved") });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.users.removeFailed"), description: rpcError(err) });
    }
  }

  return (
    <div className="flex flex-col gap-card" data-testid="shop-users-section">
      <h2 className="text-[15px] font-semibold">{t("shops.users.heading")}</h2>

      <div className="flex items-end gap-card">
        <Field.Root className="flex-1">
          <Field.Label>{t("shops.users.addLabel")}</Field.Label>
          <UserSelect value={adding} onChange={setAdding} placeholder={t("shops.users.searchPlaceholder")} />
        </Field.Root>
        <Button
          colorPalette="brand"
          loading={busy}
          disabled={adding === undefined}
          onClick={() => void add()}
          data-testid="shop-add-user"
        >
          {t("shops.users.add")}
        </Button>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="shop-users-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner className="size-4" />
      ) : userIds.length === 0 ? (
        <p className="text-fg-muted" data-testid="shop-users-empty">
          {t("shops.users.empty")}
        </p>
      ) : (
        <Table.Root data-testid="shop-users-table">
          <Table.Body>
            {userIds.map((id) => {
              const u = users[id.toString()];
              const label = u?.username || id.toString();

              return (
                <Table.Row key={id.toString()} data-testid={`shop-user-row-${label}`}>
                  <Table.Cell>
                    <UserItem user={u ?? { username: label, name: "", avatarUrl: "" }} />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <IconButton
                      size="xs"
                      variant="ghost"
                      colorPalette="red"
                      aria-label={`Remove ${label}`}
                      data-testid={`remove-shop-user-${label}`}
                      onClick={() => setRemoving({ id, label })}
                    >
                      <UserMinus className="size-4" />
                    </IconButton>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setRemoving(null);
          }}
          title={t("shops.users.removeTitle")}
          message={t("shops.users.removeConfirm", { label: removing.label })}
          confirmLabel={t("shops.users.remove")}
          onConfirm={() => remove(removing.id)}
        />
      )}
    </div>
  );
}
