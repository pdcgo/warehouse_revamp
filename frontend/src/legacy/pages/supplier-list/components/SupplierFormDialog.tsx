import { useEffect, useState } from "react";
import { HStack, Stack } from "@chakra-ui/react";
import { Button } from "../../../components/inputs/Button";
import { Field } from "../../../components/inputs/Field";
import { Modal } from "../../../components/feedback/Modal";
import { TextInput } from "../../../components/inputs/TextInput";
import type { SupplierRow } from "../../../fixtures";

// Create and edit are ONE dialog, not two.
//
// The fields are identical and the only difference is whether they start empty, so two components
// would be two copies of the same form drifting apart — one gaining a validation rule or a field the
// other never gets. The title and the submit label carry the distinction, which is the whole of it
// from the reader's side.
export const description =
  "The supplier create/edit dialog — ONE form for both, because the fields are identical and two copies would drift. Title Case titles, per the app's dialog rule.";

export interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  // Present = editing that supplier; absent = creating a new one.
  supplier?: SupplierRow;
  onSubmit?(values: { name: string; code: string }): void;
}

export function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
  onSubmit,
}: SupplierFormDialogProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  // Re-seeded whenever the dialog OPENS or the subject changes — not once at mount. Without this,
  // editing supplier A, closing, then editing B would show A's values in B's form.
  useEffect(() => {
    if (!open) return;
    setName(supplier?.name ?? "");
    setCode(supplier?.code ?? "");
  }, [open, supplier]);

  const editing = supplier !== undefined;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      // Title Case, per the app's dialog rule.
      title={editing ? "Edit Supplier" : "New Supplier"}
      size="sm"
      footer={
        <HStack gap="2" justify="flex-end">
          <Button tone="plain" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSubmit?.({ name, code });
              onOpenChange(false);
            }}
            data-testid="supplier-form-submit"
          >
            {editing ? "Save" : "Create"}
          </Button>
        </HStack>
      }
    >
      <Stack gap="card">
        <Field label="Name" required>
          <TextInput value={name} onChange={setName} data-testid="supplier-name" />
        </Field>
        <Field
          label="Code"
          required
          hint="The short code quoted on purchase orders. Must be unique."
        >
          <TextInput value={code} onChange={setCode} data-testid="supplier-code-input" />
        </Field>
      </Stack>
    </Modal>
  );
}
