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
import { rpcError, shippingClient } from "../api/clients";
import type { Shipping } from "../gen/warehouse/shipping/v1/shipping_pb";
import { toaster } from "../components/Toaster";

// EditShippingDialog renames a courier. `code` is immutable, so it is shown read-only and never
// sent — only `name` changes here. Active/inactive is toggled from the row, not this form.
export function EditShippingDialog({
  shipping,
  onDone,
}: {
  shipping: Shipping;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(shipping.name);

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await shippingClient.shippingUpdate({ shippingId: shipping.id, name });

      toaster.create({ type: "success", title: `Channel "${name}" updated` });
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
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Edit"
          data-testid={`edit-channel-${shipping.id}`}
        >
          <Icon as={Pencil} boxSize="4" />
        </IconButton>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>Edit {shipping.name}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="edit-shipping-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root>
                    <Field.Label>Code</Field.Label>
                    <Input value={shipping.code} readOnly disabled />
                    <Field.HelperText>The code cannot be changed.</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Name</Field.Label>
                    <Input
                      value={name}
                      data-testid="edit-channel-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  data-testid="submit-edit-shipping"
                >
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
