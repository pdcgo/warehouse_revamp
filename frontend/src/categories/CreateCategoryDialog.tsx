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
import { categoryClient, rpcError } from "../api/clients";
import { toaster } from "../components/Toaster";
import { CategorySelect } from "./CategorySelect";

// CreateCategoryDialog adds a category to the GLOBAL taxonomy. A parent of 0n makes it top-level;
// picking a parent in the CategorySelect nests it under that node.
export function CreateCategoryDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<bigint>(0n);

  async function submit(event: FormEvent) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      await categoryClient.categoryCreate({ name, parentId });

      toaster.create({ type: "success", title: `Category "${name}" created` });

      setName("");
      setParentId(0n);
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
        <Button size="xs" colorPalette="brand" data-testid="open-create-category">
          New category
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>New Category</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="create-category-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>Name</Field.Label>
                    <Input
                      value={name}
                      data-testid="new-category-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Parent</Field.Label>
                    <CategorySelect value={parentId} onChange={setParentId} />
                    <Field.HelperText>Leave as top-level for a root category.</Field.HelperText>
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
                  data-testid="submit-create-category"
                >
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
