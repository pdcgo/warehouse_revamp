import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, CloseButton, Dialog, Portal, Stack, Text, Wrap } from "@chakra-ui/react";

import { marketplaceKey } from "../../components/badges/MarketplaceBadge";
import { ShopItem } from "../../components/entity/ShopItem";
import type { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";


interface LinkedAccount {
  id: bigint;
  name: string;
  operational: boolean;
  shopIds: bigint[];
}

// WHAT AN ACCOUNT IS LINKED TO (owner, `the-linked-column-shows-three-then-more`) — Operasional (it pays for
// operations) and the shops that withdraw into it. Three badges at most, so a busy account does not
// stretch its row; the rest behind a "+N" that opens them all in a dialog.
//
// SHARED BY TWO PAGES — the accounts list's Terhubung ke column and phone block, and the account page's Toko terhubung
// panel (`linked-shops-sit-beside-the-cards`), which says Operasional in its header already and so passes
// `withOperational={false}`. One component, so an account's shops read the same on the list and on its page.
//
// ⚠ THE CELL'S CLICKS STOP HERE. The row opens the account's page, and React bubbles a click from a portalled
// dialog up the component tree — without the stops, closing the dialog would also open the page.
export function AccountLinks({
  account,
  shopOf,
  withOperational = true,
  shown = 3,
}: {
  account: LinkedAccount;
  /** How many links before "+N" — three on the list's row; the account page's card, a fifth of a row, takes two. */
  shown?: number;
  /** Badge Operasional among the links — off where the page says it already. */
  withOperational?: boolean;
  /** The team's shop by id — its name and marketplace. Undefined while the shops load or for a stray id. */
  shopOf: (shopId: bigint) => { name: string; marketplace: Marketplace } | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = account.id.toString();

  const links = [
    ...(withOperational && account.operational ? [{ key: "operational" as const }] : []),
    ...account.shopIds.map((shopId) => ({ key: "shop" as const, shopId })),
  ];
  const hidden = links.length - shown;
  const nameOf = (shopId: bigint) => shopOf(shopId)?.name ?? `#${shopId}`;
  // A SHOP'S CHIP IN ITS MARKETPLACE'S COLOUR (owner: *"toko ada badgenya?"*) — the theme's `marketplace.<key>` pair, the
  // one MarketplaceBadge wears, so Melati Official reads as a Shopee shop at a glance and two storefronts with one name
  // are told apart. The dialog keeps the full ShopItem, the marketplace written out.
  const tint = (shopId: bigint) => {
    const shop = shopOf(shopId);
    if (!shop) return {};
    const key = marketplaceKey(shop.marketplace);

    return { bg: `marketplace.${key}.bg`, color: `marketplace.${key}.fg` };
  };

  return (
    <Wrap gap="1">
      {links.slice(0, shown).map((link) =>
        link.key === "operational" ? (
          <Badge key="operational" colorPalette="brand" variant="outline" data-testid={`account-operational-${id}`}>
            {t("financialAccounts.operational")}
          </Badge>
        ) : (
          <Badge key={link.shopId.toString()} variant="surface" {...tint(link.shopId)} data-testid={`account-shop-${id}-${link.shopId}`}>
            {nameOf(link.shopId)}
          </Badge>
        ),
      )}

      {hidden > 0 && (
        <Button
          size="2xs"
          variant="outline"
          h="auto"
          px="1.5"
          aria-label={t("financialAccounts.links.showAll")}
          data-testid={`account-links-more-${id}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          +{hidden}
        </Button>
      )}

      {open && (
        <Box display="contents" onClick={(e) => e.stopPropagation()}>
          <Dialog.Root open onOpenChange={(e) => setOpen(e.open)} size="sm">
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content data-testid={`account-links-dialog-${id}`}>
                  <Dialog.Header>
                    <Stack gap="0">
                      <Dialog.Title>{account.name}</Dialog.Title>
                      <Dialog.Description>{t("financialAccounts.col.linkedTo")}</Dialog.Description>
                    </Stack>
                  </Dialog.Header>
                  <Dialog.CloseTrigger asChild>
                    <CloseButton size="sm" />
                  </Dialog.CloseTrigger>
                  <Dialog.Body pb="6">
                    <Stack gap="section">
                      {account.operational && (
                        <Stack gap="1">
                          <Badge alignSelf="flex-start" colorPalette="brand" variant="outline">
                            {t("financialAccounts.operational")}
                          </Badge>
                          <Text fontSize="sm" color="fg.muted">
                            {t("financialAccounts.links.operationalHelp")}
                          </Text>
                        </Stack>
                      )}
                      {account.shopIds.length > 0 && (
                        <Stack gap="2">
                          <Text fontSize="sm" fontWeight="bold" color="fg.label">
                            {t("financialAccounts.shops.title")}
                          </Text>
                          {account.shopIds.map((shopId) => {
                            const shop = shopOf(shopId);
                            return (
                              <Box key={shopId.toString()} data-testid={`account-links-shop-${shopId}`}>
                                <ShopItem shop={{ name: shop?.name ?? `#${shopId}`, marketplace: shop?.marketplace, shopId }} />
                              </Box>
                            );
                          })}
                        </Stack>
                      )}
                    </Stack>
                  </Dialog.Body>
                </Dialog.Content>
              </Dialog.Positioner>
            </Portal>
          </Dialog.Root>
        </Box>
      )}
    </Wrap>
  );
}
