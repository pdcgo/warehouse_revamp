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
import { rpcError, shopClient } from "../api/clients";
import { Marketplace } from "../gen/warehouse/selling/v1/selling_pb";
import type { Shop } from "../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../team/TeamContext";
import { MarketplaceSelect } from "../components/MarketplaceSelect";
import { toaster } from "../components/Toaster";

// ShopFormDialog creates OR edits a shop in the CURRENT (selling) team. The team is the scope: it
// travels in the message body (the backend's use_scope reads it there, never a header).
//
// Two modes, one form:
//  - create — `shop` undefined; the dialog renders its own "New shop" trigger.
//  - edit — `shop` set; the dialog is controlled (open/onOpenChange), pre-filled, calls ShopUpdate.
export function ShopFormDialog({
  shop,
  onDone,
  open: openProp,
  onOpenChange,
}: {
  shop?: Shop;
  onDone: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { current } = useTeam();

  const editing = shop !== undefined;
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

  const [name, setName] = useState(shop?.name ?? "");
  const [shopCode, setShopCode] = useState(shop?.shopCode ?? "");
  const [marketplace, setMarketplace] = useState<Marketplace>(shop?.marketplace ?? Marketplace.UNSPECIFIED);
  const [description, setDescription] = useState(shop?.description ?? "");

  const canSave = name.trim() !== "" && shopCode.trim() !== "" && marketplace !== Marketplace.UNSPECIFIED;

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!current) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      if (editing && shop) {
        await shopClient.shopUpdate({ teamId: current.teamId, shopId: shop.id, name, shopCode, marketplace, description });
        toaster.create({ type: "success", title: "Shop saved" });
      } else {
        await shopClient.shopCreate({ teamId: current.teamId, name, shopCode, marketplace, description });
        toaster.create({ type: "success", title: `Shop "${name}" created` });

        setName("");
        setShopCode("");
        setMarketplace(Marketplace.UNSPECIFIED);
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
          <Button size="xs" colorPalette="brand" data-testid="open-create-shop">
            New shop
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{editing ? "Edit Shop" : "New Shop"}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="shop-form-error">
                      {error}
                    </Text>
                  )}

                  <Field.Root required>
                    <Field.Label>Name</Field.Label>
                    <Input value={name} data-testid="shop-name" onChange={(e) => setName(e.target.value)} />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Shop code</Field.Label>
                    <Input value={shopCode} data-testid="shop-code" onChange={(e) => setShopCode(e.target.value)} />
                    <Field.HelperText>Unique within the team, up to 32 characters.</Field.HelperText>
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>Marketplace</Field.Label>
                    <MarketplaceSelect value={marketplace} onChange={setMarketplace} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Description</Field.Label>
                    <Input
                      value={description}
                      data-testid="shop-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} disabled={!canSave} data-testid="submit-shop">
                  {editing ? "Save" : "Create"}
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
