import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Flex, Heading, Icon, SimpleGrid, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Pencil } from "lucide-react";
import { rpcError } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { useShop, useInvalidateShops } from "./queries";
import { MarketplaceBadge } from "../components/MarketplaceBadge";
import { ShopFormDialog } from "./ShopFormDialog";
import { ShopUsersSection } from "./ShopUsersSection";

function parseShopId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// ShopDetailPage is the dedicated detail route for a shop (#85) — a PAGE, not a dialog. It shows the
// shop's read-only info (name, code, marketplace, description), scoped to the current selling team,
// with an Edit shortcut. Reached by clicking a shop row in ShopsPage.
export function ShopDetailPage() {
  const { shopId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseShopId(shopId);

  const [editing, setEditing] = useState(false);

  const teamId = current?.teamId;

  const query = useShop({ teamId, shopId: id });
  const invalidateShops = useInvalidateShops();

  const shop = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  // A malformed id in the URL is not a failed request — the query never runs for it (`enabled`), so
  // its message is produced here rather than by an error the server never saw.
  const error = id === 0n ? t("shops.detail.invalidId") : query.isError ? rpcError(query.error) : "";

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("shops.title")}</Heading>
        <Text color="fg.muted" data-testid="shop-detail-no-team">
          {t("shops.detail.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !shop) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="shop-detail-back"
          onClick={() => navigate("/shops")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("shops.detail.back")}
        </Button>
        <Text color="red.fg" data-testid="shop-detail-error">
          {error || t("shops.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="shop-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="shop-detail-back"
        onClick={() => navigate("/shops")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("shops.detail.back")}
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md">{t("shops.detail.title")}</Heading>
        <Spacer />
        <Button size="xs" variant="outline" data-testid="shop-detail-edit" onClick={() => setEditing(true)}>
          <Icon as={Pencil} boxSize="4" />
          {t("shops.detail.edit")}
        </Button>
      </Flex>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Flex align="center" gap="card">
              <Heading size="sm" data-testid="shop-detail-name">
                {shop.name}
              </Heading>
              <MarketplaceBadge marketplace={shop.marketplace} />
            </Flex>

            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field label={t("shops.detail.code")} value={shop.shopCode} />
              <Field label={t("shops.detail.description")} value={shop.description} />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <ShopUsersSection teamId={current.teamId} shopId={shop.id} />
        </Card.Body>
      </Card.Root>

      {editing && (
        <ShopFormDialog
          shop={shop}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(false);
          }}
          onDone={() => void invalidateShops()}
        />
      )}
    </Stack>
  );
}
