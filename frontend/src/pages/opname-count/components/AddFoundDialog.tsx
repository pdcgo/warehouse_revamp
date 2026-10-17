import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Dialog, Field, Portal, Stack, Text } from "@chakra-ui/react";
import { Code, ConnectError } from "@connectrpc/connect";

import { rpcError } from "../../../api/clients";
import { ProductSelect } from "../../../components/products/ProductSelect";
import { toaster } from "../../../components/feedback/Toaster";
import { useAddFoundOpnameRow } from "../../../features/opname/queries";

// ADD A PRODUCT FOUND HERE — a product on the rack that the list does not name (a-counter-may-add-a-product-found-here).
// It joins the session at a book figure of 0 on this rack, and its other racks join too, so a move nets out.
//
// Except a product its team NEVER HAD in this warehouse: that is not stock here yet. The counter is told to take it off
// the rack and tell the selling team, who brings it in by a restock (a-unit-never-stocked-here-comes-in-by-restock).
export function AddFoundDialog({
  warehouseId,
  sessionId,
  placementId,
  rackCode,
  open,
  onOpenChange,
}: {
  warehouseId: bigint;
  sessionId: bigint;
  placementId: bigint;
  rackCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const add = useAddFoundOpnameRow();

  const [product, setProduct] = useState<{ id: bigint; name: string } | null>(null);
  const [error, setError] = useState("");
  const [neverHere, setNeverHere] = useState(false);

  function close(next: boolean) {
    if (!next) {
      setProduct(null);
      setError("");
      setNeverHere(false);
    }
    onOpenChange(next);
  }

  function submit() {
    if (!product) return;
    setError("");
    setNeverHere(false);
    add.mutate(
      { teamId: warehouseId, sessionId, placementId, productId: product.id },
      {
        onSuccess: (res) => {
          toaster.create({
            type: "success",
            title: t("opnameSession.found.done", { product: product.name, code: rackCode, others: res.rows.length - 1 }),
          });
          close(false);
        },
        onError: (err) => {
          if (ConnectError.from(err).code === Code.FailedPrecondition) setNeverHere(true);
          else setError(rpcError(err));
        },
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => close(e.open)} size={{ base: "full", md: "md" }}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="opname-found-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("opnameSession.found.title", { code: rackCode })}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap="card">
                <Text fontSize="sm" color="fg.muted">
                  {t("opnameSession.found.help")}
                </Text>
                <Field.Root required>
                  <Field.Label>
                    {t("opnameSession.found.product")}
                    <Field.RequiredIndicator />
                  </Field.Label>
                  <ProductSelect
                    teamId={warehouseId}
                    scope="all"
                    portalled={false}
                    value={product?.id ?? 0n}
                    placeholder={t("opnameSession.found.productPlaceholder")}
                    onChange={(p) => {
                      setProduct({ id: p.id, name: p.name });
                      setNeverHere(false);
                    }}
                  />
                </Field.Root>
                {neverHere && (
                  <Alert.Root status="warning" data-testid="opname-found-never-here">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{t("opnameSession.found.neverHereTitle")}</Alert.Title>
                      <Alert.Description>{t("opnameSession.found.neverHereBody")}</Alert.Description>
                    </Alert.Content>
                  </Alert.Root>
                )}
                {error && (
                  <Alert.Root status="error" data-testid="opname-found-error">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                  </Alert.Root>
                )}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline" data-testid="opname-found-cancel">
                  {t("opnameSession.create.dismiss")}
                </Button>
              </Dialog.ActionTrigger>
              <Button colorPalette="brand" disabled={!product || neverHere} loading={add.isPending} onClick={submit} data-testid="opname-found-submit">
                {t("opnameSession.found.submit")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
