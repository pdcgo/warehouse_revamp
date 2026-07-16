import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { restockClient, rpcError } from "../api/clients";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { TeamSelect } from "../components/TeamSelect";
import { ProductSelect } from "../components/ProductSelect";
import type { PickedProduct } from "../components/ProductSelect";
import { ShippingSelect } from "../shipping/ShippingSelect";
import { toaster } from "../components/Toaster";

// Parse a quantity input string to a positive integer, treating blank/invalid as 0.
function toQty(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 0;
  return n;
}

// RestockRequestCreatePage is the selling-side "ask a warehouse to restock" form (#105). It is a
// dedicated PAGE, not a modal: the warehouse and product pickers render their listboxes through a
// Portal, which is inert inside a modal Dialog — a page sidesteps that entirely (same reason
// OrderCreatePage is a page). The product's sku/name are SNAPSHOTTED from the picker onto the
// request, because the product may live in another team's catalogue.
export function RestockRequestCreatePage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const teamId = current?.teamId;

  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [productId, setProductId] = useState<bigint>(0n);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [shippingCode, setShippingCode] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function pickProduct(p: PickedProduct) {
    setProductId(p.id);
    setSku(p.sku);
    setName(p.name);
  }

  const canSave = warehouseId > 0n && productId > 0n && toQty(quantity) >= 1;

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined || !canSave) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await restockClient.restockRequestCreate({
        teamId,
        warehouseId,
        productId,
        sku,
        name,
        quantity: BigInt(toQty(quantity)),
        shippingCode,
      });

      toaster.create({ type: "success", title: t("restock.toast.created") });
      void navigate("/inventories/requests");
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("restock.newRequestTitle")}</Heading>
        <Text color="fg.muted" data-testid="restock-create-no-team">
          {t("restock.selectTeamCreate")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" maxW="2xl" data-testid="restock-create-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("restock.back")}
          data-testid="restock-create-back"
          onClick={() => navigate("/inventories/requests")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{t("restock.newRequestTitle")}</Heading>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="restock-create-error">
          {error}
        </Text>
      )}

      <form onSubmit={save} noValidate>
        <Card.Root>
          <Card.Body>
            <Stack gap="card">
              <Field.Root required>
                <Field.Label>{t("restock.form.warehouse")}</Field.Label>
                <Box w="full" data-testid="restock-warehouse">
                  <TeamSelect
                    teamType={TeamType.WAREHOUSE}
                    value={warehouseId}
                    onChange={setWarehouseId}
                  />
                </Box>
                <Field.HelperText>{t("restock.form.warehouseHelp")}</Field.HelperText>
              </Field.Root>

              <Field.Root required>
                <Field.Label>{t("restock.form.product")}</Field.Label>
                <ProductSelect teamId={teamId ?? 0n} scope="all" value={productId} onChange={pickProduct} />
                {productId > 0n && (
                  <Field.HelperText data-testid="restock-picked-product">
                    {sku} — {name}
                  </Field.HelperText>
                )}
              </Field.Root>

              <Field.Root required>
                <Field.Label>{t("restock.form.quantity")}</Field.Label>
                <Input
                  type="number"
                  min="1"
                  w="32"
                  value={quantity}
                  data-testid="restock-quantity"
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>{t("restock.form.shipment")}</Field.Label>
                <ShippingSelect value={shippingCode} onChange={setShippingCode} />
                <Field.HelperText>{t("restock.form.shipmentHelp")}</Field.HelperText>
              </Field.Root>

              <Flex justify="end">
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={saving}
                  disabled={!canSave}
                  data-testid="submit-restock"
                >
                  {t("restock.form.submit")}
                </Button>
              </Flex>
            </Stack>
          </Card.Body>
        </Card.Root>
      </form>
    </Stack>
  );
}
