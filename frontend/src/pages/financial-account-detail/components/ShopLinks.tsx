import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Field, Flex, Icon, Text } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { ShopSelect } from "../../../components/pickers/ShopSelect";
import type { FinancialAccount } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import type { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { AccountLinks } from "../../../features/financialAccount/AccountLinks";
import { FormDialog } from "../../../features/financialAccount/FormDialog";
import { useAccountOfShop, useShopSet } from "../../../features/financialAccount/queries";
import { accountName } from "../../../features/financialAccount/vocab";

// The shops that WITHDRAW INTO this account — their `shop_accounts` rows
// (a-shop-names-the-account-it-withdraws-into).
//
// ⚠ Placed on the ACCOUNT's page in this prototype, where the clarify had it on the shop's detail page —
// the shop page belongs to another context, and here the question "where does this money come from?" is
// answered beside the money. Accepted or moved at design_accept.
export function ShopLinks({
  teamId,
  account,
  shopName,
  nameOf,
  shopOf,
  canSet,
}: {
  teamId: bigint;
  account: FinancialAccount;
  shopName: (id: bigint) => string;
  nameOf: (id: bigint) => string | undefined;
  /** The team's shop by id — its name and marketplace, for the badges. */
  shopOf: (id: bigint) => { name: string; marketplace: Marketplace } | undefined;
  /** Admin and up, on an active real account. */
  canSet: boolean;
}) {
  const { t } = useTranslation();
  const [setting, setSetting] = useState(false);

  return (
    // TOKO TERHUBUNG, THE THIRD CARD (owner, `linked-shops-sit-beside-the-cards`) — one column, a card as wide as the
    // other two (owner: *"kalau toko terhubung cuma 1/5"*), so the row is three equal cards; the whole row on a tablet
    // and a phone, where a column is too narrow for two names. Drawn as a summary card is (grey ground, thin line), but
    // not a SummaryCard: its body is a row of shops, not one figure.
    <Box
      gridColumn={{ base: "1 / -1", lg: "auto" }}
      borderWidth="1px"
      borderColor="border"
      bg="bg.muted"
      borderRadius="l2"
      px="3"
      py="2.5"
      minW="0"
      data-testid="account-shops"
    >
      <Flex gap="1" align="center">
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {t("financialAccounts.shops.linked")}
        </Text>
        {/* "ARAHKAN ›" AT THE END OF THE LABEL ROW — the report cards' "Rincian ›": only the word is pressed. */}
        {canSet && (
          <Button
            variant="plain"
            size="2xs"
            h="auto"
            p="0"
            ms="auto"
            color="brand.fg"
            fontWeight="bold"
            data-testid="open-shop-set"
            onClick={() => setSetting(true)}
          >
            {t("financialAccounts.shops.pointShort")}
            <Icon as={ChevronRight} boxSize="3" />
          </Button>
        )}
      </Flex>

      {account.shopIds.length === 0 ? (
        <Text fontSize="sm" color="fg.subtle" mt="1.5" data-testid="account-shops-none">
          {t("financialAccounts.shops.none")}
        </Text>
      ) : (
        <>
          {/* TWO, THEN +N — the accounts list's rule by its own component (the-linked-column-shows-three-then-more), at two:
              three names do not fit a fifth of a row on one line, and a second line would stretch the cards beside it. */}
          <Box mt="1.5">
            <AccountLinks account={account} shopOf={shopOf} withOperational={false} shown={2} />
          </Box>
          <Text fontSize="xs" color="fg.muted" mt="1" data-testid="account-shops-count">
            {t("financialAccounts.shops.count", { count: account.shopIds.length })}
          </Text>
        </>
      )}

      {setting && (
        <ShopSetDialog teamId={teamId} account={account} shopName={shopName} nameOf={nameOf} onClose={() => setSetting(false)} />
      )}
    </Box>
  );
}

function ShopSetDialog({
  teamId,
  account,
  shopName,
  nameOf,
  onClose,
}: {
  teamId: bigint;
  account: FinancialAccount;
  shopName: (id: bigint) => string;
  nameOf: (id: bigint) => string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const shopSet = useShopSet();

  const [error, setError] = useState("");
  const [shopId, setShopId] = useState(0n);
  const current = useAccountOfShop(teamId, shopId);

  const already = current.data?.id === account.id;

  function submit() {
    setError("");
    shopSet.mutate(
      { teamId, shopId, accountId: account.id },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("financialAccounts.toast.shopSet", { shop: shopName(shopId), name: account.name }),
          });
          onClose();
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("financialAccounts.shops.dialogTitle", { name: account.name })}
      error={error}
      busy={shopSet.isPending}
      canSave={shopId > 0n && !already && !current.isPending}
      testId="shop-set"
      onSubmit={submit}
    >
      <Field.Root required>
        <Field.Label>{t("financialAccounts.shops.shop")}</Field.Label>
        <ShopSelect teamId={teamId} value={shopId} onChange={setShopId} placeholder={t("financialAccounts.shops.shopPlaceholder")} />
      </Field.Root>

      {shopId > 0n && current.isSuccess && (
        <Text fontSize="sm" color={already ? "fg.muted" : current.data ? "fg.warning" : "fg.muted"} data-testid="shop-set-current">
          {already
            ? t("financialAccounts.shops.already", { shop: shopName(shopId) })
            : current.data
              ? t("financialAccounts.shops.moves", { shop: shopName(shopId), from: accountName(current.data, nameOf), to: account.name })
              : t("financialAccounts.shops.first", { shop: shopName(shopId) })}
        </Text>
      )}
    </FormDialog>
  );
}
