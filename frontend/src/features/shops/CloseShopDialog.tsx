import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Icon, List, Stack, Text } from "@chakra-ui/react";
import { Check, X } from "lucide-react";

import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import type { Shop } from "../../gen/warehouse/selling/v1/selling_pb";
import { useCloseShop } from "./queries";

export const description =
  "Close Shop's confirmation — what closing stops and what keeps working, from the owner's decisions (a-closed-shop-refuses-only-new-selling, a-close-leaves-the-drafts-waiting, a-shop-code-is-unique-among-open-shops, a-closed-shop-locks-all-but-its-grants, a-closed-shop-takes-no-new-account-link), plus a warning when the shop has no primary CS. Closes through ShopClose and toasts.";

// CLOSING CONFIRMS FIRST (destructive → ConfirmDialog), and the
// dialog says what the close does, since the person is about to stop a storefront that still has money coming:
//
//   Close Shop
//   Close Melati Store? You can reopen it later.
//   ✕ It stops                              ✓ It keeps working
//     new orders, and drafts pushed in        placed orders, to their end
//     the order form's shop list              its statements import; settlement, account, expenses
//     its waiting drafts becoming orders      who has access, and its primary CS
//     a new withdrawal account link
//     edits to its name, code, description
//   Its code MEL-TOK is freed for a new shop.
//   ⚠ It has no primary CS — choose one, or its last statements cannot be imported.     (only when it has none)
//                                                           [Cancel] [Close Shop]
//
// The close is never refused for drafts (a-close-leaves-the-drafts-waiting), so the dialog warns and never blocks.
export function CloseShopDialog({
  teamId,
  shop,
  open,
  onOpenChange,
  trigger,
  onClosed,
}: {
  teamId: bigint;
  shop: Shop;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  onClosed?: () => void;
}) {
  const { t } = useTranslation();
  const closeShop = useCloseShop();

  // `mutateAsync`: ConfirmDialog awaits it to hold its button. A refusal toasts — the same shape as the list's delete.
  async function close() {
    try {
      await closeShop.mutateAsync({ teamId, shopId: shop.id });
      toaster.create({ type: "success", title: t("shops.close.done", { name: shop.name }) });
      onClosed?.();
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.close.failed"), description: rpcError(err) });
    }
  }

  const line = (icon: typeof Check, tone: string, text: string, id: string) => (
    <List.Item key={id} data-testid={`close-shop-${id}`}>
      <HStack gap="2" align="start">
        <Icon as={icon} boxSize="4" color={tone} mt="0.5" flexShrink={0} />
        <Text>{text}</Text>
      </HStack>
    </List.Item>
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title={t("shops.close.title")}
      message={t("shops.close.message", { name: shop.name })}
      confirmLabel={t("shops.close.confirm")}
      onConfirm={close}
    >
      <Stack gap="card" fontSize="sm" data-testid="close-shop-explained">
        <Stack gap="1.5">
          <Text fontWeight="bold">{t("shops.close.stopsTitle")}</Text>
          <List.Root gap="1" variant="plain">
            {line(X, "error.fg", t("shops.close.stops.orders"), "stops-orders")}
            {line(X, "error.fg", t("shops.close.stops.picker"), "stops-picker")}
            {line(X, "error.fg", t("shops.close.stops.drafts"), "stops-drafts")}
            {line(X, "error.fg", t("shops.close.stops.account"), "stops-account")}
            {line(X, "error.fg", t("shops.close.stops.edit"), "stops-edit")}
          </List.Root>
        </Stack>
        <Stack gap="1.5">
          <Text fontWeight="bold">{t("shops.close.keepsTitle")}</Text>
          <List.Root gap="1" variant="plain">
            {line(Check, "success.fg", t("shops.close.keeps.orders"), "keeps-orders")}
            {line(Check, "success.fg", t("shops.close.keeps.money"), "keeps-money")}
            {line(Check, "success.fg", t("shops.close.keeps.access"), "keeps-access")}
          </List.Root>
        </Stack>
        <Text color="fg.muted" data-testid="close-shop-code">
          {t("shops.close.codeFreed", { code: shop.shopCode })}
        </Text>
        {shop.primaryUserId === 0n && (
          <Text color="warning.fg" data-testid="close-shop-no-primary">
            {t("shops.close.noPrimary")}
          </Text>
        )}
      </Stack>
    </ConfirmDialog>
  );
}
