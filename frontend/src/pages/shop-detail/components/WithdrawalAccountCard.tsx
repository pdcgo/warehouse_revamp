import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Card, Flex, HStack, Icon, Skeleton, Stack, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import { rpcError } from "../../../api/clients";
import type { Shop } from "../../../gen/warehouse/selling/v1/selling_pb";
import { useFinancialAccounts } from "../../../features/financialAccount/queries";
import { ProviderBadge } from "../../../features/financialAccount/badges";
import { accountName } from "../../../features/financialAccount/vocab";
import { CopyText } from "../../../components/chrome/CopyText";

// AKUN PENARIKAN — the account this shop's marketplace withdrawals land in, under the shop's details (owner: *"di bawah
// detail ada akun penarikan, jika tidak ada kasih link ke rekeningnya"*). At most one (a-shop-has-one-account): the
// accounts list's `shop_id` filter answers it, no new read.
//
//   ┌ Akun Penarikan ──────────────────────────────┐     ┌ Akun Penarikan ─────────────────────────┐
//   │ [BCA] BCA Operasional          [Buka Akun ›] │     │ Belum ada akun penarikan                │
//   │ 1234567890 ⧉ · PT Melati Sejahtera           │     │ Hubungkan toko ini ke rekening …        │
//   └──────────────────────────────────────────────┘     │ [Buka Akun Keuangan ›]                  │
//                                                         └─────────────────────────────────────────┘
//
// None is a status — the warning role — and the way out is the accounts page, where a shop is linked to an account.
// An archived account is still the shop's link, so it is read too.
export function WithdrawalAccountCard({ teamId, shop }: { teamId: bigint; shop: Shop }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const query = useFinancialAccounts({ teamId, q: "", includeArchived: true, shopId: shop.id, page: 1, pageSize: 1 });
  const account = query.data?.accounts[0];

  function body() {
    if (query.isPending) {
      return (
        <Stack gap="2" data-testid="shop-withdrawal-loading">
          <Skeleton h="4" w="60%" />
          <Skeleton h="3" w="40%" />
        </Stack>
      );
    }

    if (query.isError) {
      return (
        <Text color="error.fg" fontSize="sm" data-testid="shop-withdrawal-error">
          {rpcError(query.error)}
        </Text>
      );
    }

    if (!account) {
      return (
        <Stack gap="2" align="start" data-testid="shop-withdrawal-none">
          <Text color="warning.fg" fontWeight="bold">
            {t("shops.withdrawal.none")}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            {t("shops.withdrawal.noneHint")}
          </Text>
          <Button
            size="xs"
            variant="outline"
            onClick={() => navigate("/financial-accounts")}
            data-testid="shop-withdrawal-open-accounts"
          >
            {t("shops.withdrawal.openAccounts")}
            <Icon as={ArrowRight} boxSize="4" />
          </Button>
        </Stack>
      );
    }

    // The account's name as the accounts screens write it — an unknown account reads as this shop's name.
    const name = accountName(account, (id) => (id === shop.id ? shop.name : undefined));

    return (
      <Flex align="center" gap="card" data-testid="shop-withdrawal-account">
        <Stack gap="1" flex="1" minW="0">
          <HStack gap="2" minW="0">
            <ProviderBadge provider={account.provider} />
            <Text fontWeight="bold" truncate data-testid="shop-withdrawal-name">
              {name}
            </Text>
          </HStack>
          {(account.accountNumber || account.holderName) && (
            <HStack gap="1.5" fontSize="sm" color="fg.muted" wrap="wrap">
              {account.accountNumber && <CopyText value={account.accountNumber} testId="shop-withdrawal-number" />}
              {account.accountNumber && account.holderName && <Text>·</Text>}
              {account.holderName && <Text>{account.holderName}</Text>}
            </HStack>
          )}
        </Stack>
        <Button
          size="xs"
          variant="outline"
          flexShrink={0}
          onClick={() => navigate(`/financial-accounts/${account.id}`)}
          data-testid="shop-withdrawal-open"
        >
          {t("shops.withdrawal.openAccount")}
          <Icon as={ArrowRight} boxSize="4" />
        </Button>
      </Flex>
    );
  }

  return (
    <Card.Root data-testid="shop-withdrawal-card">
      <Card.Header>
        <Card.Title>{t("shops.withdrawal.title")}</Card.Title>
        <Card.Description>{t("shops.withdrawal.description")}</Card.Description>
      </Card.Header>
      <Card.Body>{body()}</Card.Body>
    </Card.Root>
  );
}
