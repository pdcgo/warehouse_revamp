import { useState } from "react";
import type { FormEvent } from "react";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { productClient, rpcError } from "../api/clients";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../components/Toaster";

// CreateProductDialog adds a product to the CURRENT TEAM's catalogue. The team is the scope: it
// travels in the message body (the backend's (use_scope) option reads it from there, never a
// header), so a product can only ever land in the team you are looking at.
export function CreateProductDialog({ onDone }: { onDone: () => void }) {
  const { current } = useTeam();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await productClient.productCreate({
        teamId: current?.teamId ?? 0n,
        sku,
        name,
        description,
      });

      toaster.create({ type: "success", title: `Product "${sku}" created` });

      setSku("");
      setName("");
      setDescription("");
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
        <Button size="xs" colorPalette="brand" data-testid="open-create-product">
          New product
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>New Product</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-product-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>SKU</Field.Label>
                    <Input
                      value={sku}
                      data-testid="new-product-sku"
                      onChange={(e) => setSku(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Name</Field.Label>
                    <Input
                      value={name}
                      data-testid="new-product-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Description</Field.Label>
                    <Input
                      value={description}
                      data-testid="new-product-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-create-product">
                  Create
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
