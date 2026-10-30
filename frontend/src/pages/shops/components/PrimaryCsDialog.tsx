import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Button, CloseButton, Dialog, Icon, Portal, RadioCard, Stack, Text } from "@chakra-ui/react";
import { ArrowRight, Users } from "lucide-react";
import { rpcError } from "../../../api/clients";
import type { Shop } from "../../../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../../../features/team/TeamContext";
import { useSetShopPrimary, useShopUsers } from "../../../features/shops/queries";
import { UserItem } from "../../../components/entity/UserItem";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../../components/feedback/ListSkeleton";
import { toaster } from "../../../components/feedback/Toaster";

// PrimaryCsDialog changes — or, on a shop with none, chooses — a shop's PRIMARY CS from the shops list (owner: *"kasih
// cs utamanya di bawah toko, dan ada aksi untuk mengubahnya"*).
//
// It offers ONLY the shop's granted users (the-primary-cs-is-a-flag-on-a-grant: a primary is never someone without a
// grant, and ShopUserSetPrimary refuses one). A shop nobody holds has no one to offer, so the dialog says so and opens
// the shop's page, where access is given — the first grant becomes the primary there.
//
//   Ganti CS Utama
//   Melati Official
//   Baris laporan impor yang tidak punya pesanan … dicatat atas nama CS utama.
//   ( ) Ani Rahayu  @ani   [Saat ini]
//   (•) Budi Santoso @budi
//                                                   [Batal] [Simpan]
export function PrimaryCsDialog({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const teamId = current?.teamId;
  const users = useShopUsers({ teamId, shopId: shop.id });
  const setPrimary = useSetShopPrimary();

  const none = shop.primaryUserId === 0n;
  const [picked, setPicked] = useState(none ? "" : shop.primaryUserId.toString());
  const [error, setError] = useState("");

  const people = users.data ?? [];
  const canSave = picked !== "" && picked !== shop.primaryUserId.toString();

  function save() {
    if (teamId === undefined || !canSave) {
      return;
    }

    setError("");
    const person = people.find((p) => p.id.toString() === picked);

    setPrimary.mutate(
      { teamId, shopId: shop.id, userId: BigInt(picked) },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("shops.primary.saved", { user: person?.name || person?.username || `#${picked}`, shop: shop.name }),
          });
          onClose();
        },
        onError: (err) => setError(`${t("shops.primary.failed")}: ${rpcError(err)}`),
      },
    );
  }

  function body() {
    if (users.isPending) {
      return <ListSkeleton rows={2} testId="primary-cs-loading" />;
    }

    if (users.isError) {
      return (
        <Text color="error.fg" fontSize="sm" data-testid="primary-cs-error">
          {rpcError(users.error)}
        </Text>
      );
    }

    if (people.length === 0) {
      // NOBODY TO OFFER — access is given on the shop's page, and the first grant becomes the primary there.
      return (
        <EmptyHint
          icon={Users}
          size="sm"
          title={t("shops.primary.nobody")}
          description={t("shops.primary.nobodyHint")}
          action={
            <Button variant="outline" onClick={() => navigate(`/shops/${shop.id}`)} data-testid="primary-cs-open-shop">
              {t("shops.primary.openShop")}
              <Icon as={ArrowRight} boxSize="4" />
            </Button>
          }
          testId="primary-cs-nobody"
        />
      );
    }

    // One person per card, the chosen one in the main tone (a-chosen-option-is-in-the-main-tone); the current primary
    // says so, so moving it is a deliberate pick of somebody else.
    return (
      <RadioCard.Root
        size="sm"
        value={picked}
        onValueChange={(e) => e.value && setPicked(e.value)}
        aria-label={t("shops.primary.pick")}
        data-testid="primary-cs-options"
      >
        <Stack gap="2">
          {people.map((person) => {
            const id = person.id.toString();

            return (
              <RadioCard.Item key={id} value={id} data-testid={`primary-cs-option-${person.username}`}>
                <RadioCard.ItemHiddenInput />
                <RadioCard.ItemControl alignItems="center" gap="3">
                  <RadioCard.ItemContent>
                    <UserItem user={person} />
                  </RadioCard.ItemContent>
                  {id === shop.primaryUserId.toString() && (
                    <Badge colorPalette="brand" flexShrink={0}>
                      {t("shops.primary.current")}
                    </Badge>
                  )}
                  <RadioCard.ItemIndicator />
                </RadioCard.ItemControl>
              </RadioCard.Item>
            );
          })}
        </Stack>
      </RadioCard.Root>
    );
  }

  return (
    <Dialog.Root open onOpenChange={(e) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="primary-cs-dialog">
            <Dialog.Header>
              <Stack gap="0.5">
                <Dialog.Title>{none ? t("shops.primary.chooseTitle") : t("shops.primary.changeTitle")}</Dialog.Title>
                <Text color="fg.muted" fontSize="sm">
                  {shop.name}
                </Text>
              </Stack>
            </Dialog.Header>

            <Dialog.Body>
              <Stack gap="card">
                {/* What the choice is FOR — the owner asked; the person picking should not have to. */}
                <Text fontSize="sm" color="fg.muted">
                  {t("shops.primary.why")}
                </Text>
                {error && (
                  <Text color="error.fg" fontSize="sm" data-testid="primary-cs-save-error">
                    {error}
                  </Text>
                )}
                {body()}
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("common.cancel")}</Button>
              </Dialog.ActionTrigger>
              {people.length > 0 && (
                <Button
                  colorPalette="brand"
                  loading={setPrimary.isPending}
                  disabled={!canSave}
                  onClick={save}
                  data-testid="primary-cs-save"
                >
                  {t("shops.primary.save")}
                </Button>
              )}
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
