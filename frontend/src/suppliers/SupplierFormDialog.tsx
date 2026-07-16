import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
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
import { rpcError, supplierClient } from "../api/clients";
import type { Supplier } from "../gen/warehouse/inventory/v1/supplier_pb";
import { useTeam } from "../team/TeamContext";
import { toaster } from "../components/Toaster";

// SupplierFormDialog creates OR edits a supplier in the CURRENT team. The team is the scope: it
// travels in the message body (the backend's use_scope reads it there, never a header).
//
// Two modes, one form:
//  - create — `supplier` undefined; the dialog renders its own "New supplier" trigger.
//  - edit — `supplier` set; the dialog is controlled (open/onOpenChange), pre-filled, calls
//    SupplierUpdate.
export function SupplierFormDialog({
  supplier,
  onDone,
  open: openProp,
  onOpenChange,
}: {
  supplier?: Supplier;
  onDone: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { current } = useTeam();
  const { t } = useTranslation();

  const editing = supplier !== undefined;
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [code, setCode] = useState(supplier?.code ?? "");
  const [name, setName] = useState(supplier?.name ?? "");
  const [contact, setContact] = useState(supplier?.contact ?? "");
  const [province, setProvince] = useState(supplier?.province ?? "");
  const [city, setCity] = useState(supplier?.city ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [description, setDescription] = useState(supplier?.description ?? "");

  const canSave = code.trim() !== "" && name.trim() !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      if (editing && supplier) {
        await supplierClient.supplierUpdate({
          teamId: current.teamId,
          supplierId: supplier.id,
          code,
          name,
          contact,
          province,
          city,
          address,
          description,
        });
        toaster.create({ type: "success", title: t("suppliers.form.saved") });
      } else {
        await supplierClient.supplierCreate({
          teamId: current.teamId,
          code,
          name,
          contact,
          province,
          city,
          address,
          description,
        });
        toaster.create({ type: "success", title: t("suppliers.form.created", { name }) });

        setCode("");
        setName("");
        setContact("");
        setProvince("");
        setCity("");
        setAddress("");
        setDescription("");
      }

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
      {!isControlled && (
        <Dialog.Trigger asChild>
          <Button size="xs" colorPalette="brand" data-testid="open-create-supplier">
            {t("suppliers.form.newSupplier")}
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>
                  {editing ? t("suppliers.form.editTitle") : t("suppliers.form.createTitle")}
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="supplier-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>{t("suppliers.form.code")}</Field.Label>
                    <Input value={code} data-testid="supplier-code" onChange={(e) => setCode(e.target.value)} />
                    <Field.HelperText>{t("suppliers.form.codeHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("suppliers.form.name")}</Field.Label>
                    <Input value={name} data-testid="supplier-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("suppliers.form.contact")}</Field.Label>
                    <Input
                      value={contact}
                      data-testid="supplier-contact"
                      onChange={(e) => setContact(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("suppliers.form.province")}</Field.Label>
                    <Input
                      value={province}
                      data-testid="supplier-province"
                      onChange={(e) => setProvince(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("suppliers.form.city")}</Field.Label>
                    <Input value={city} data-testid="supplier-city" onChange={(e) => setCity(e.target.value)} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("suppliers.form.address")}</Field.Label>
                    <Input
                      value={address}
                      data-testid="supplier-address"
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("suppliers.form.description")}</Field.Label>
                    <Input
                      value={description}
                      data-testid="supplier-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("suppliers.form.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!canSave}
                  data-testid="submit-supplier"
                >
                  {editing ? t("suppliers.form.save") : t("suppliers.form.create")}
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
