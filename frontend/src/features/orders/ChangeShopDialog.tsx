import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, HStack, Icon, Portal, Spinner, Stack, Text } from "@chakra-ui/react";
import { Store } from "lucide-react";

import { rpcError } from "../../api/clients";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { toaster } from "../../components/feedback/Toaster";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { useShopOptions } from "../shops/queries";
import { useCanWrite } from "../team/TeamContext";
import { useOrder, useUpdateOrderShop } from "./queries";

export const description =
  "Ubah Toko: the selling team moves an order filed under the wrong shop to another shop of the same team and marketplace that the person may write, from handover on. Pick the shop, then confirm — the order's notes name both shops, and the reports count the move today.";

// WHERE THE SHOP MAY BE FIXED — the statuses the server takes (`shopFixable`, selling_v1/order_shop_update.go): every
// status from handover on, where a platform statement may carry the order (customer service sets those statuses by
// hand). Before handover (pending, processed, picked) and a cancelled order are refused there, so the action is absent.
const FIXABLE = new Set([
  OrderStatus.SHIPPING,
  OrderStatus.SHIPPED,
  OrderStatus.PROBLEM,
  OrderStatus.COMPLETED,
  OrderStatus.RETURN,
  OrderStatus.RETURN_COMPLETED,
  OrderStatus.LOST,
]);

/**
 * UBAH TOKO beside the order's shop: the button, and the dialog while it is open. Offered to the order's SELLING team
 * reading it (every selling role may — `selling:all`; the warehouse has its own page and never sees it), while it may
 * write (useCanWrite — never while the admin team monitors), from the order's handover on. Which shops it may
 * pick is the dialog's picker's: the same marketplace, the ones the person may write.
 */
export function ChangeShopAction({
  teamId,
  order,
}: {
  /** The team reading the order. */
  teamId: bigint | undefined;
  order: { id: bigint; teamId: bigint; status: OrderStatus };
}) {
  const { t } = useTranslation();
  const writable = useCanWrite();
  const [open, setOpen] = useState(false);

  if (!writable || teamId === undefined || teamId !== order.teamId || !FIXABLE.has(order.status)) return null;

  return (
    <>
      <Button size="2xs" variant="outline" data-testid="order-change-shop" onClick={() => setOpen(true)}>
        <Icon as={Store} boxSize="3" />
        {t("orders.changeShop.action")}
      </Button>
      {open && <ChangeShopDialog open onOpenChange={setOpen} teamId={teamId} orderId={order.id} />}
    </>
  );
}

// FIX AN ORDER'S SHOP (an-orders-shop-is-fixed-and-counted-on-the-day) — opened from the shop on the seller's order page
// (SellerOrderDetail's Info card), beside the shop it changes. Not in the header's action bar: that bar is the order's
// MOVES (rowActions.ts), and a fix moves no status.
//
// THE PICKER OFFERS ONLY WHAT THE SERVER TAKES: the team's shops of the order's own marketplace
// (a-shops-marketplace-and-team-are-fixed) that this person may write (a-write-needs-a-grant-or-a-manager), closed ones
// after the open — a closed shop refuses only new selling (a-closed-shop-refuses-only-new-selling), and its statements
// still import. The shop the order is in now picks nothing new, so Next stays off on it.
//
// TWO STEPS — pick, then confirm: the move is not walked back by a second click, it is a second fix, and the shop
// reports count each one on its day. The confirm names both shops in the person's words.
//
// ⚠ MOUNT IT ONLY WHILE OPEN — the page does. Mounted, it reads the order and the team's shops.
export function ChangeShopDialog({
  open,
  onOpenChange,
  teamId,
  orderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selling team — the order's own. */
  teamId: bigint;
  orderId: bigint;
}) {
  const { t } = useTranslation();
  const order = useOrder({ teamId, orderId });
  // Every shop of the team, the closed ones too — the order's shop may have been closed since.
  const shops = useShopOptions({ teamId });
  const update = useUpdateOrderShop();

  const [shopId, setShopId] = useState(0n);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = order.data;
  const currentShop = shops.data?.find((shop) => shop.id === current?.shopId);
  const picked = shops.data?.find((shop) => shop.id === shopId);
  const busy = update.isPending;

  // Reset every time it opens, so a cancelled fix never leaks into the next one.
  useEffect(() => {
    if (!open) return;

    setShopId(0n);
    setConfirming(false);
    setError(null);
  }, [open]);

  const changed = shopId !== 0n && current !== undefined && current !== null && shopId !== current.shopId;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!confirming) {
      setConfirming(true);
      return;
    }

    try {
      await update.mutateAsync({ teamId, orderId, shopId });
      toaster.create({ type: "success", title: t("orders.changeShop.saved") });
      onOpenChange(false);
    } catch (err) {
      setConfirming(false);
      setError(rpcError(err));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="change-shop-dialog">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("orders.changeShop.action")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                {!current || !currentShop ? (
                  <Spinner size="sm" />
                ) : (
                  <Stack gap="field">
                    <Text fontSize="sm" color="fg.muted">
                      {t("orders.changeShop.intro")}
                    </Text>

                    <Field.Root>
                      <Field.Label>{t("orders.changeShop.current")}</Field.Label>
                      <HStack gap="2" data-testid="change-shop-current">
                        <Text fontSize="sm">{currentShop.name}</Text>
                        <MarketplaceBadge marketplace={currentShop.marketplace} size="sm" />
                      </HStack>
                    </Field.Root>

                    {confirming && picked ? (
                      <Text fontSize="sm" data-testid="change-shop-confirm-text">
                        {t("orders.changeShop.confirm", {
                          id: orderId.toString(),
                          from: currentShop.name,
                          to: picked.name,
                        })}
                      </Text>
                    ) : (
                      <Field.Root required>
                        <Field.Label>
                          {t("orders.changeShop.newShop")}
                          <Field.RequiredIndicator />
                        </Field.Label>
                        <ShopSelect
                          teamId={teamId}
                          value={shopId}
                          onChange={setShopId}
                          marketplace={currentShop.marketplace}
                          writable
                          withClosed
                          placeholder={t("orders.changeShop.placeholder")}
                          disabled={busy}
                        />
                      </Field.Root>
                    )}

                    {error && (
                      <Text color="fg.error" fontSize="sm" data-testid="change-shop-error">
                        {error}
                      </Text>
                    )}
                  </Stack>
                )}
              </Dialog.Body>

              <Dialog.Footer>
                {confirming ? (
                  <Button variant="outline" disabled={busy} data-testid="change-shop-back" onClick={() => setConfirming(false)}>
                    {t("orders.changeShop.back")}
                  </Button>
                ) : (
                  <Dialog.ActionTrigger asChild>
                    <Button variant="outline" disabled={busy}>
                      {t("common.cancel")}
                    </Button>
                  </Dialog.ActionTrigger>
                )}
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!changed}
                  data-testid={confirming ? "change-shop-save" : "change-shop-next"}
                >
                  {confirming ? t("orders.changeShop.action") : t("orders.changeShop.next")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
