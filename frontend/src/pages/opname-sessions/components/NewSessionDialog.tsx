import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Dialog, Field, Portal, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../../api/clients";
import { OpnamePlan } from "../../../gen/warehouse/inventory/v1/opname_pb";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { RadioPills } from "../../../components/inputs/RadioPills";
import { RackSelect } from "../../../components/pickers/RackSelect";
import { ProductSelect } from "../../../components/products/ProductSelect";
import { TeamSelect } from "../../../components/teams/TeamSelect";
import { toaster } from "../../../components/feedback/Toaster";
import { useCreateOpnameSession } from "../../../features/opname/queries";

type PlanChoice = "all" | "team" | "product" | "placement";

const PLAN: Record<PlanChoice, OpnamePlan> = {
  all: OpnamePlan.ALL,
  team: OpnamePlan.TEAM,
  product: OpnamePlan.PRODUCT,
  placement: OpnamePlan.PLACEMENT,
};

// NEW SESSION — the warehouse admin plans a count (opname.md §Stock Opname Flow: Plan Opname All Rack · Specific Team ·
// Specific Product · Specific Placement). The team, product or rack is only a FILTER on the snapshot, never stored
// (the-plan-target-is-only-a-filter). Creating it snapshots the shelf book and LOCKS those rows until finalize or cancel
// — said on the dialog, because it stops goods moving on those racks.
export function NewSessionDialog({
  warehouseId,
  open,
  onOpenChange,
  onCreated,
}: {
  warehouseId: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (sessionId: bigint) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateOpnameSession();

  const [plan, setPlan] = useState<PlanChoice>("all");
  const [teamId, setTeamId] = useState(0n);
  const [productId, setProductId] = useState(0n);
  const [rack, setRack] = useState("");
  const [error, setError] = useState("");

  const placementId = rack !== "" ? BigInt(rack) : 0n;
  const targetMissing =
    (plan === "team" && teamId === 0n) ||
    (plan === "product" && productId === 0n) ||
    (plan === "placement" && placementId === 0n);
  const canSubmit = !targetMissing && !create.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setError("");
    create.mutate(
      {
        teamId: warehouseId,
        plan: PLAN[plan],
        filterTeamId: plan === "team" ? teamId : 0n,
        filterProductId: plan === "product" ? productId : 0n,
        filterPlacementId: plan === "placement" ? placementId : 0n,
      },
      {
        onSuccess: (res) => {
          toaster.create({ type: "success", title: t("opnameSession.create.done", { id: res.session?.id.toString() ?? "" }) });
          onOpenChange(false);
          if (res.session) onCreated(res.session.id);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size={{ base: "full", md: "md" }} scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="opname-new-session-dialog">
            <form onSubmit={submit} style={{ display: "contents" }}>
              <Dialog.Header>
                <Dialog.Title>{t("opnameSession.create.title")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Alert.Root status="error" data-testid="opname-new-session-error">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Content>
                    </Alert.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>
                      {t("opnameSession.create.plan")}
                      <Field.RequiredIndicator />
                    </Field.Label>
                    <RadioPills
                      value={plan}
                      onChange={setPlan}
                      ariaLabel={t("opnameSession.create.plan")}
                      testId="opname-plan"
                      options={(["all", "team", "product", "placement"] as const).map((v) => ({
                        value: v,
                        label: t(`opnameSession.plan.${v}`),
                        testId: `opname-plan-${v}`,
                      }))}
                    />
                  </Field.Root>

                  {plan === "team" && (
                    <Field.Root required>
                      <Field.Label>
                        {t("opnameSession.create.team")}
                        <Field.RequiredIndicator />
                      </Field.Label>
                      <TeamSelect
                        value={teamId > 0n ? teamId : undefined}
                        teamType={TeamType.SELLING}
                        portalled={false}
                        placeholder={t("opnameSession.create.teamPlaceholder")}
                        onChange={setTeamId}
                      />
                    </Field.Root>
                  )}

                  {plan === "product" && (
                    <Field.Root required>
                      <Field.Label>
                        {t("opnameSession.create.product")}
                        <Field.RequiredIndicator />
                      </Field.Label>
                      <ProductSelect
                        teamId={warehouseId}
                        scope="all"
                        portalled={false}
                        value={productId}
                        placeholder={t("opnameSession.create.productPlaceholder")}
                        onChange={(p) => setProductId(p.id)}
                      />
                    </Field.Root>
                  )}

                  {plan === "placement" && (
                    <Field.Root required>
                      <Field.Label>
                        {t("opnameSession.create.rack")}
                        <Field.RequiredIndicator />
                      </Field.Label>
                      <RackSelect
                        warehouseId={warehouseId}
                        value={rack}
                        onChange={setRack}
                        placeholder={t("opnameSession.create.rackPlaceholder")}
                        testId="opname-plan-rack"
                      />
                      <Field.HelperText>{t("opnameSession.create.rackHelp")}</Field.HelperText>
                    </Field.Root>
                  )}

                  <Text fontSize="sm" color="fg.muted" data-testid="opname-new-session-lock">
                    {t(`opnameSession.create.scope.${plan}`)} {t("opnameSession.create.lock")}
                  </Text>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" data-testid="opname-new-session-cancel">
                    {t("opnameSession.create.dismiss")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  type="submit"
                  colorPalette="brand"
                  disabled={!canSubmit}
                  loading={create.isPending}
                  data-testid="opname-new-session-submit"
                >
                  {t("opnameSession.create.submit")}
                </Button>
              </Dialog.Footer>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
