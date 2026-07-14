import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { productClient, rpcError } from "../api/clients";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../components/Toaster";

// EditProductDialog updates sku/name/description. The fields are optional (presence) on the wire,
// but the form holds the product's current values, so sending all three simply overwrites with
// what is on screen. The CURRENT TEAM travels in the body — it is the scope.
export function EditProductDialog({ product, onDone }: { product: Product; onDone: () => void }) {
  const { current } = useTeam();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [sku, setSku] = useState(product.sku);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await productClient.productUpdate({
        teamId: current?.teamId ?? 0n,
        productId: product.id,
        sku,
        name,
        description,
      });

      toaster.create({ type: "success", title: `Product "${sku}" updated` });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Dialog.Trigger asChild>
        <IconButton size="xs" variant="ghost" aria-label="Edit" data-testid={`edit-${product.sku}`}>
          <Icon as={Pencil} boxSize="4" />
        </IconButton>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>Edit {product.sku}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="edit-product-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>SKU</Field.Label>
                    <Input value={sku} data-testid="edit-product-sku" onChange={(e) => setSku(e.target.value)} />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Name</Field.Label>
                    <Input value={name} data-testid="edit-product-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Description</Field.Label>
                    <Input
                      value={description}
                      data-testid="edit-product-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-edit-product">
                  Save
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
