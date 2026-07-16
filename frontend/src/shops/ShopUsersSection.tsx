import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, HStack, Heading, Icon, IconButton, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { UserMinus } from "lucide-react";
import { rpcError, shopClient, userClient } from "../api/clients";
import type { PublicUser } from "../gen/warehouse/user/v1/user_pb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { UserItem } from "../components/UserItem";
import { UserSelect } from "../components/UserSelect";
import { toaster } from "../components/Toaster";

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
    <Stack gap="card" data-testid="shop-users-section">
      <Heading size="sm">{t("shops.users.heading")}</Heading>

      <HStack gap="card" align="end">
        <Field.Root>
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
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="shop-users-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner size="sm" colorPalette="brand" />
      ) : userIds.length === 0 ? (
        <Text color="fg.muted" data-testid="shop-users-empty">
          {t("shops.users.empty")}
        </Text>
      ) : (
        <Table.Root size="sm" data-testid="shop-users-table">
          <Table.Body>
            {userIds.map((id) => {
              const u = users[id.toString()];
              const label = u?.username || id.toString();

              return (
                <Table.Row key={id.toString()} data-testid={`shop-user-row-${label}`}>
                  <Table.Cell>
                    <UserItem user={u ?? { username: label, name: "", avatarUrl: "" }} />
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <IconButton
                      size="xs"
                      variant="ghost"
                      colorPalette="red"
                      aria-label={`Remove ${label}`}
                      data-testid={`remove-shop-user-${label}`}
                      onClick={() => setRemoving({ id, label })}
                    >
                      <Icon as={UserMinus} boxSize="4" />
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
    </Stack>
  );
}
