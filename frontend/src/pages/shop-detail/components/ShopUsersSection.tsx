import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Field,
  Flex,
  HStack,
  Icon,
  IconButton,
  Stack,
  StackSeparator,
} from "@chakra-ui/react";
import { Star, UserMinus, UserPlus, Users } from "lucide-react";
import { rpcError, shopClient, userClient } from "../../../api/clients";
import { publicUsersByIds, userByIdsRowData } from "../../../features/users/adapt";
import type { PublicUser } from "../../../gen/warehouse/user/v1/user_pb";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { UserItem } from "../../../components/entity/UserItem";
import { UserSelect } from "../../../components/pickers/UserSelect";
import { toaster } from "../../../components/feedback/Toaster";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../../components/feedback/ListSkeleton";
import { useIsMobile } from "../../../layouts/shell";

// ShopUsersSection manages who may work on a shop (#86). It lists the granted users (resolving the
// opaque ids to names via UserByIDs), adds one via the shared UserSelect SCOPED TO THE TEAM — a shop is
// granted to one of the team's members, never to anyone in the system
// (a-shop-grant-picks-from-the-teams-members) — and removes with a confirm. Scoped to the shop's team; the backend is the real gate.
//
// ⚠ AND IT SHOWS THE PRIMARY CS (the-primary-cs-is-a-flag-on-a-grant) — a badge on that user's row, *Utama* (the card
// says whose shop it is, so "CS" is not repeated), and
// Make primary on every other. The first user granted becomes it and removing its grant leaves none,
// both on the server — so every change here asks the page to re-read the shop. A shop with none cannot
// import its statements, and says so.
//
// ITS OWN CARD (`the-shop-screens-follow-the-screen-rules`) — titled, described, the page does not wrap it in another
// (never a card inside a card); the warning in the warning role, an empty list as a hint, the first load as its shape,
// the people a plain list — a row each, a line between, lighting up under the pointer. On a phone the picker and Add
// stack, full width.
export function ShopUsersSection({
  teamId,
  shopId,
  primaryUserId,
  onChanged,
}: {
  teamId: bigint;
  shopId: bigint;
  primaryUserId: bigint;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [userIds, setUserIds] = useState<bigint[]>([]);
  const [users, setUsers] = useState<Record<string, PublicUser>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<bigint | undefined>(undefined);
  const [removing, setRemoving] = useState<{ id: bigint; label: string } | null>(null);
  // MAKE PRIMARY CONFIRMS FIRST (owner: *"utama ada confirmnya"*) — it moves whose name the shop's no-order rows carry.
  const [promoting, setPromoting] = useState<{ id: bigint; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // A person as a sentence names them — the name, else the username, else the id.
  const nameOf = (id: bigint) => {
    const u = users[id.toString()];
    return u?.name || u?.username || `#${id}`;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await shopClient.shopUserList({
        teamId,
        filter: { shopId },
        page: { page: 1, limit: 100 },
      });
      // The user ids now live in the guideline `ids` channel.
      setUserIds(res.ids);

      if (res.ids.length > 0) {
        const resolved = publicUsersByIds(
          await userClient.userByIDs({
            filter: { ids: res.ids },
            dataRequest: userByIdsRowData(),
          }),
        );
        setUsers(resolved);
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
      onChanged();
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
      onChanged();
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.users.removeFailed"), description: rpcError(err) });
    }
  }

  async function makePrimary(userId: bigint) {
    try {
      await shopClient.shopUserSetPrimary({ teamId, shopId, userId });
      toaster.create({ type: "success", title: t("shops.users.primaryChanged") });
      onChanged();
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.users.makePrimaryFailed"), description: rpcError(err) });
    }
  }

  return (
    <Card.Root data-testid="shop-users-section">
      <Card.Header>
        <Card.Title>{t("shops.users.title")}</Card.Title>
        <Card.Description>{t("shops.users.description")}</Card.Description>
      </Card.Header>
      <Card.Body>
        <Stack gap="card">
          {/* NO PRIMARY CS — a status, so its role colour; it is what stops the shop importing its statements. */}
          {primaryUserId === 0n && (
            <Alert.Root status="warning" size="sm" data-testid="shop-no-primary">
              <Alert.Indicator />
              <Alert.Title>{t("shops.users.noPrimary")}</Alert.Title>
            </Alert.Root>
          )}

          <Flex gap="card" align={isMobile ? "stretch" : "end"} direction={isMobile ? "column" : "row"}>
            <Field.Root flex="1">
              <Field.Label>{t("shops.users.addLabel")}</Field.Label>
              <UserSelect
                teamId={teamId}
                value={adding}
                onChange={setAdding}
                placeholder={t("shops.users.searchPlaceholder")}
              />
            </Field.Root>
            <Button
              colorPalette="brand"
              loading={busy}
              disabled={adding === undefined}
              onClick={() => void add()}
              flexShrink={0}
              data-testid="shop-add-user"
            >
              <Icon as={UserPlus} boxSize="4" />
              {t("shops.users.add")}
            </Button>
          </Flex>

          {error && (
            <Box color="error.fg" fontSize="sm" data-testid="shop-users-error">
              {error}
            </Box>
          )}

          {loading ? (
            <ListSkeleton rows={2} testId="shop-users-loading" />
          ) : userIds.length === 0 ? (
            // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint).
            <EmptyHint
              icon={Users}
              size="sm"
              title={t("shops.users.empty")}
              description={t("shops.users.emptyHint")}
              testId="shop-users-empty"
            />
          ) : (
            // A PLAIN LIST, NOT A TABLE (owner: *"oke"* to one person per row, a line between) — it had no headings, so it
            // was a list already: the person, the primary marked *Utama*, the two actions at the end. A row lights up
            // under the pointer, as the table's did.
            <Stack gap="0" separator={<StackSeparator />} data-testid="shop-users-list">
              {userIds.map((id) => {
                const u = users[id.toString()];
                const label = u?.username || id.toString();
                const primary = id === primaryUserId;

                return (
                  <Flex
                    key={id.toString()}
                    align="center"
                    gap="2"
                    py="2"
                    px="2"
                    mx="-2"
                    borderRadius="l2"
                    _hover={{ bg: "bg.muted" }}
                    data-testid={`shop-user-row-${label}`}
                  >
                    <HStack gap="2" flex="1" minW="0">
                      <UserItem user={u ?? { username: label, name: "", avatarUrl: "" }} />
                      {primary && (
                        <Badge colorPalette="brand" flexShrink={0} data-testid={`shop-user-primary-${label}`}>
                          {t("shops.users.primaryBadge")}
                        </Badge>
                      )}
                    </HStack>
                    <HStack gap="1" flexShrink={0}>
                      {!primary && (
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t("shops.users.makePrimaryLabel", { label })}
                          title={t("shops.users.makePrimaryLabel", { label })}
                          data-testid={`make-primary-${label}`}
                          onClick={() => setPromoting({ id, name: nameOf(id) })}
                        >
                          <Icon as={Star} boxSize="4" />
                        </IconButton>
                      )}
                      <IconButton
                        size="xs"
                        variant="ghost"
                        colorPalette="error"
                        aria-label={t("shops.users.removeLabel", { label })}
                        title={t("shops.users.removeLabel", { label })}
                        data-testid={`remove-shop-user-${label}`}
                        onClick={() => setRemoving({ id, label })}
                      >
                        <Icon as={UserMinus} boxSize="4" />
                      </IconButton>
                    </HStack>
                  </Flex>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Card.Body>

      {promoting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setPromoting(null);
          }}
          // Not destructive — it is undone the same way — but it changes who the shop's rows are counted for.
          destructive={false}
          title={t("shops.users.makePrimaryTitle")}
          message={
            primaryUserId === 0n
              ? t("shops.users.makePrimaryConfirmNone", { name: promoting.name })
              : t("shops.users.makePrimaryConfirm", { name: promoting.name, current: nameOf(primaryUserId) })
          }
          confirmLabel={t("shops.users.makePrimary")}
          onConfirm={() => makePrimary(promoting.id)}
        />
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
    </Card.Root>
  );
}
