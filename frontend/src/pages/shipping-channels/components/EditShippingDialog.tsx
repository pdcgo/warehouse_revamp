import { useState } from "react";
import type { FormEvent } from "react";
import { Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { rpcError } from "../../../api/clients";
import type { Shipping } from "../../../gen/warehouse/shipping/v1/shipping_pb";
import { Button, IconButton } from "../../../components/ui/Button";
import { Dialog, Portal } from "../../../components/ui/Dialog";
import { Field } from "../../../components/ui/Field";
import { toaster } from "../../../components/Toaster";
import { useUpdateShipping } from "../queries";

// EditShippingDialog renames a courier. `code` is immutable, so it is shown read-only and never
// sent — only `name` changes here. Active/inactive is toggled from the row, not this form.
//
// `shipping` is the only prop: the `onDone` that used to make the page refetch is gone, because the
// write now declares what it invalidates (#177), and this dialog opens and closes itself.
export function EditShippingDialog({ shipping }: { shipping: Shipping }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(shipping.name);

  // Shared with the row's activate/deactivate — one RPC, one declaration of what it makes stale.
  const save = useUpdateShipping();
  const busy = save.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    setError("");

    save.mutate(
      { shippingId: shipping.id, name },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("catalog.shipping.updatedToast", { name }) });
          setOpen(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
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
          <Pencil className="size-4" />
        </IconButton>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("catalog.shipping.editTitle", { name: shipping.name })}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="flex flex-col gap-card">
                  {error && (
                    <p className="text-red-600 dark:text-red-400" data-testid="edit-shipping-error">
                      {error}
                    </p>
                  )}

                  <Field.Root>
                    <Field.Label>{t("catalog.shipping.code")}</Field.Label>
                    <Field.Input value={shipping.code} readOnly disabled />
                    <Field.HelperText>{t("catalog.shipping.codeHelpEdit")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("catalog.name")}</Field.Label>
                    <Field.Input
                      value={name}
                      data-testid="edit-channel-name"
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
                  data-testid="submit-edit-shipping"
                >
                  {t("catalog.save")}
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
