import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Flex, Heading, Icon, SimpleGrid, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Pencil } from "lucide-react";
import { rpcError, shopClient } from "../api/clients";
import type { Shop } from "../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../team/TeamContext";
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

  const id = parseShopId(shopId);

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined || id === 0n) {
      setError(id === 0n ? "Invalid shop id." : "");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await shopClient.shopDetail({ teamId, shopId: id });
      setShop(res.shop ?? null);
    } catch (err) {
      setError(rpcError(err));
      setShop(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">Shops</Heading>
        <Text color="fg.muted" data-testid="shop-detail-no-team">
          Select a team to view its shops.
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
          Back to Shops
        </Button>
        <Text color="red.fg" data-testid="shop-detail-error">
          {error || "Shop not found."}
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
        Back to Shops
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md">Shop Details</Heading>
        <Spacer />
        <Button size="xs" variant="outline" data-testid="shop-detail-edit" onClick={() => setEditing(true)}>
          <Icon as={Pencil} boxSize="4" />
          Edit
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
              <Field label="Code" value={shop.shopCode} />
              <Field label="Description" value={shop.description} />
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
          onDone={() => void load()}
        />
      )}
    </Stack>
  );
}
