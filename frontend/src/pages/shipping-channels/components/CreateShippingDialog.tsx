import { useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import { Button, IconButton } from "../../../components/ui/Button";
import { Dialog, Portal } from "../../../components/ui/Dialog";
import { Field } from "../../../components/ui/Field";
import { toaster } from "../../../components/Toaster";
import { useCreateShipping } from "../queries";

// CreateShippingDialog adds a courier to the GLOBAL catalogue. `code` is the stable machine key a
// shipment stores and is immutable once created, so it is only settable here (never in Edit).
//
// It takes no props at all: it used to take an `onDone` so the page could refetch, and the write now
// says what it invalidates itself (#177). Nothing outside needs to know this dialog closed either —
// it triggers itself and it closes itself.
export function CreateShippingDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  // The write, and the caches it drops, declared together in queries.ts. `busy` is the mutation's own
  // state rather than a `useState` beside it — two flags for one question are two answers, free to
  // disagree.
  const save = useCreateShipping();
  const busy = save.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { code, name },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("catalog.shipping.createdToast", { name }) });

          setCode("");
          setName("");
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
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
                <div className="flex flex-col gap-card">
                  {error && (
                    <p className="text-red-600 dark:text-red-400" data-testid="create-shipping-error">
                      {error}
                    </p>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("catalog.shipping.code")}</Field.Label>
                    <Field.Input
                      value={code}
                      data-testid="new-channel-code"
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <Field.HelperText>{t("catalog.shipping.codeHelpCreate")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("catalog.name")}</Field.Label>
                    <Field.Input
                      value={name}
                      data-testid="new-channel-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>
                </div>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.CloseTrigger asChild>
                  <Button type="button" variant="outline" colorPalette="gray">
                    {t("catalog.cancel")}
                  </Button>
                </Dialog.CloseTrigger>

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
                <IconButton type="button" size="sm" aria-label="Close" className="absolute right-3 top-3">
                  <X className="size-4" />
                </IconButton>
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
