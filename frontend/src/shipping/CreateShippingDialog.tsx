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
import { useTranslation } from "react-i18next";
import { rpcError, shippingClient } from "../api/clients";
import { toaster } from "../components/Toaster";

// CreateShippingDialog adds a courier to the GLOBAL catalogue. `code` is the stable machine key a
// shipment stores and is immutable once created, so it is only settable here (never in Edit).
export function CreateShippingDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await shippingClient.shippingCreate({ code, name });

      toaster.create({ type: "success", title: t("catalog.shipping.createdToast", { name }) });

      setCode("");
      setName("");
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
        <Button size="xs" colorPalette="brand" data-testid="open-create-shipping">
          {t("catalog.shipping.newChannel")}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("catalog.shipping.newTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-shipping-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("catalog.shipping.code")}</Field.Label>
                    <Input
                      value={code}
                      data-testid="new-channel-code"
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <Field.HelperText>
                      {t("catalog.shipping.codeHelpCreate")}
                    </Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("catalog.name")}</Field.Label>
                    <Input
                      value={name}
                      data-testid="new-channel-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("catalog.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  data-testid="submit-create-shipping"
                >
                  {t("catalog.create")}
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
