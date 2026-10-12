import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Field, Flex, Heading, Icon, Stack, Text, Wrap } from "@chakra-ui/react";
import { Store } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { toaster } from "../../../components/feedback/Toaster";
import { ShopSelect } from "../../../components/pickers/ShopSelect";
import type { FinancialAccount } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { FormDialog } from "../../../features/financialAccount/FormDialog";
import { useAccountOfShop, useShopSet } from "../../../features/financialAccount/queries";
import { withShopNames } from "../../../features/financialAccount/vocab";

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
  canSet,
}: {
  teamId: bigint;
  account: FinancialAccount;
  shopName: (id: bigint) => string;
  nameOf: (id: bigint) => string | undefined;
  /** Admin and up, on an active real account. */
  canSet: boolean;
}) {
  const { t } = useTranslation();
  const [setting, setSetting] = useState(false);

  return (
    <Stack gap="field" data-testid="account-shops">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="sm">{t("financialAccounts.shops.title")}</Heading>
        {canSet && (
          <Button size="xs" variant="outline" data-testid="open-shop-set" onClick={() => setSetting(true)}>
            <Icon as={Store} boxSize="4" />
            {t("financialAccounts.shops.point")}
          </Button>
        )}
      </Flex>

      {account.shopIds.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" data-testid="account-shops-none">
          {t("financialAccounts.shops.none")}
        </Text>
      ) : (
        <Wrap gap="1">
          {account.shopIds.map((id) => (
            <Badge key={id.toString()} variant="surface" data-testid={`account-shops-${id}`}>
              {shopName(id)}
            </Badge>
          ))}
        </Wrap>
      )}

      {setting && (
        <ShopSetDialog teamId={teamId} account={account} shopName={shopName} nameOf={nameOf} onClose={() => setSetting(false)} />
      )}
    </Stack>
  );
}

// A shop names ONE account (a-shop-has-one-account), so pointing it here MOVES it — the dialog names the
// account it leaves before Save, never after.
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
        <ShopSelect teamId={teamId} value={shopId} onChange={setShopId} />
      </Field.Root>

      {shopId > 0n && current.isSuccess && (
        <Text fontSize="sm" color={already ? "fg.muted" : current.data ? "fg.warning" : "fg.muted"} data-testid="shop-set-current">
          {already
            ? t("financialAccounts.shops.already", { shop: shopName(shopId) })
            : current.data
              ? t("financialAccounts.shops.moves", { shop: shopName(shopId), from: withShopNames(current.data.name, nameOf), to: account.name })
              : t("financialAccounts.shops.first", { shop: shopName(shopId) })}
        </Text>
      )}
    </FormDialog>
  );
}
