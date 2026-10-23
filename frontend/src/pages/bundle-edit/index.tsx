import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Spacer,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, Lock, PackagePlus } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useAuth } from "../../features/auth/AuthContext";
import { lineState, unavailable } from "../../features/bundles/adapt";
import { readPrefill } from "../../features/bundles/prefill";
import { useBundle, useBundleProducts, useSaveBundle } from "../../features/bundles/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useActors } from "../../features/users/queries";
import { formatUnixRelative } from "../../lib/datetime";
import { canChangeBundle, canCreateBundle } from "../../lib/roles";
import { AllProductPicker } from "../../components/products/AllProductPicker";
import type { PickedProduct } from "../../components/products/ProductSelect";
import { toaster } from "../../components/feedback/Toaster";
import { BundleLineCard } from "./components/BundleLineCard";

// A route param is a string from the URL bar — a non-numeric one is a thing to land on, not a crash. 0n = unusable.
function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/** One line while the form holds it — the quantity as typed, so an emptied box is not 0. */
interface LineDraft {
  productId: bigint;
  quantity: string;
}

const toQty = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 9999 ? n : 0;
};

function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <Flex align="center" gap="card" wrap="wrap">
      <Heading size="sm">{children}</Heading>
      <Spacer />
      {aside}
    </Flex>
  );
}

// BundleEditPage — the form that makes or changes a bundle (docs/business/product/product_bundle.md).
//
//   /products/bundles/new        → BundleCreate → the new bundle's page
//   /products/bundles/:id/edit   → BundleUpdate → the bundle's page. Its creator or an Admin and up; anyone else who
//                                  lands here by URL gets it READ-ONLY (the-creator-or-an-admin-edits-a-bundle)
//
// READING a bundle is its own page, with Delete (a-bundle-has-a-detail-page-that-counts-what-stock-can-make).
//
//   [←] Paket Hemat
//       Created by Ani Rahayu · changed yesterday
//   LEFT (2/3)                                       RIGHT (1/3)
//   ┌ Products                  [＋ Add Products] ┐  ┌ Details ─ name, description ┐
//   │ Beras Pandan Wangi 5kg       Per bundle [1] │  [Save Changes]
//   │ Gula Pasir 1kg · Toko Kenanga          [2] │  still missing: …
//   └─────────────────────────────────────────────┘
//
// One form for both, because BundleUpdate replaces every field BundleCreate sets.
export function BundleEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { identity } = useAuth();
  const { bundleId: rawId } = useParams<{ bundleId: string }>();

  const isEdit = rawId !== undefined;
  const id = parseId(rawId);
  const isSelling = current?.teamType === TeamType.SELLING;
  const teamId = isSelling ? current?.teamId : undefined;

  const detail = useBundle({ teamId, bundleId: isEdit ? id : 0n });
  const loaded = detail.data ?? null;
  const save = useSaveBundle();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState("");

  // A NEW bundle may arrive with a recipe to start from — Make It a Bundle on the draft page (features/bundles/prefill).
  // Read once, on the first render, so a person's edits are never overwritten by the URL.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (isEdit) return;

    const prefill = readPrefill(searchParams);
    if (prefill.name) setName(prefill.name);
    if (prefill.lines.length > 0) setLines(prefill.lines);
  }, []); // once, on arrival — deliberately not on every change of the URL

  // Seed the form ONCE per bundle — a refetch must not overwrite what is being typed.
  const [seededFor, setSeededFor] = useState<bigint | null>(null);
  useEffect(() => {
    if (loaded && seededFor !== loaded.id) {
      setName(loaded.name);
      setDescription(loaded.description);
      setLines(loaded.lines.map((l) => ({ productId: l.productId, quantity: String(l.quantity) })));
      setSeededFor(loaded.id);
    }
  }, [loaded, seededFor]);

  const products = useBundleProducts({ teamId, productIds: lines.map((l) => l.productId) });
  const ownerIds = [...(products.data?.values() ?? [])].filter((p) => p.teamId !== teamId).map((p) => p.teamId);
  const owners = useTeamsByIds({ ids: ownerIds });
  const actors = useActors(loaded ? [loaded.createdByUserId] : []);

  const me = identity?.identityId;
  const mayEdit = isEdit
    ? !!loaded && canChangeBundle({ role: current?.role, createdByUserId: loaded.createdByUserId, me })
    : canCreateBundle(current?.role);
  const readOnly = !mayEdit;

  const creator = loaded ? (actors.data?.get(loaded.createdByUserId.toString())?.name ?? `#${loaded.createdByUserId}`) : "";
  // BACK undoes the step that got you here: an edit was opened from the bundle's page, a create from the list.
  const backTo = isEdit ? `/products/bundles/${rawId}` : "/products/bundles";

  // The picker hands back the WHOLE ticked set. A product still ticked keeps its line and its typed quantity; a new one
  // starts at 1; an unticked one goes. A line the picker cannot show (another team's, since locked) stays ticked — it is
  // only ever removed by its own button.
  function pick(picked: PickedProduct[]) {
    setLines((prev) =>
      picked.map((p) => prev.find((l) => l.productId === p.id) ?? { productId: p.id, quantity: "1" }),
    );
  }

  const states = lines.map((l) => lineState(products.data?.get(l.productId.toString()), teamId ?? 0n));
  const blocked = states.filter(unavailable).length;

  const missing: string[] = [];
  if (name.trim() === "") missing.push("name");
  if (lines.length === 0) missing.push("lines");
  if (lines.some((l) => toQty(l.quantity) === 0)) missing.push("quantity");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (teamId === undefined || missing.length > 0 || readOnly) return;

    setError("");
    try {
      const saved = await save.mutateAsync({
        teamId,
        bundleId: isEdit ? id : undefined,
        fields: { name, description, lines: lines.map((l) => ({ productId: l.productId, quantity: toQty(l.quantity) })) },
      });
      toaster.create({
        type: "success",
        title: isEdit ? t("bundles.form.saved") : t("bundles.form.created", { name: name.trim() }),
      });
      // To the bundle's page — a new one too: what its stock can make is the first thing worth knowing about it.
      void navigate(saved ? `/products/bundles/${saved.id}` : "/products/bundles");
    } catch (err) {
      setError(rpcError(err));
    }
  }

  const title = isEdit ? (loaded?.name ?? t("bundles.form.editTitle")) : t("bundles.form.newTitle");

  const back = (
    <IconButton size="xs" variant="ghost" aria-label={t("bundles.form.back")} data-testid="bundle-edit-back" onClick={() => navigate(backTo)}>
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  if (!current || !isSelling) {
    return (
      <Stack gap="section">
        <Flex align="center" gap="card">
          {back}
          <Heading size="md">{title}</Heading>
        </Flex>
        <Text color="fg.muted" data-testid="bundle-edit-selling-only">
          {current ? t("bundles.sellingOnly") : t("bundles.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (isEdit && !loaded) {
    const loadError =
      id === 0n
        ? t("bundles.form.notFound")
        : detail.isError
          ? rpcError(detail.error)
          : detail.isSuccess
            ? t("bundles.form.notFound")
            : "";

    if (!loadError) return <Spinner colorPalette="brand" />;

    return (
      <Stack gap="section">
        <Flex align="center" gap="card">
          {back}
          <Heading size="md">{title}</Heading>
        </Flex>
        <Text color="error.fg" data-testid="bundle-edit-load-error">
          {loadError}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" maxW="7xl" data-testid={isEdit ? "bundle-edit-page" : "bundle-create-page"}>
      <Stack gap="1">
        <Flex align="center" gap="card">
          {back}
          {/* The form only — Delete is the bundle page's, beside Edit, as on a product. */}
          <Heading size="md" lineClamp={1} data-testid="bundle-edit-title">
            {title}
          </Heading>
        </Flex>
        {loaded && (
          <Text fontSize="sm" color="fg.muted" data-testid="bundle-edit-creator">
            {t("bundles.form.createdBy", { name: creator, when: formatUnixRelative(loaded.updatedAtUnix) })}
          </Text>
        )}
      </Stack>

      {readOnly && loaded && (
        <Alert.Root status="info" data-testid="bundle-edit-read-only">
          <Alert.Indicator>
            <Icon as={Lock} boxSize="4" />
          </Alert.Indicator>
          <Alert.Description>{t("bundles.form.readOnly", { name: creator })}</Alert.Description>
        </Alert.Root>
      )}

      {blocked > 0 && (
        <Alert.Root status="warning" data-testid="bundle-edit-unavailable">
          <Alert.Indicator />
          <Alert.Description>{t("bundles.form.unavailableBanner", { count: blocked })}</Alert.Description>
        </Alert.Root>
      )}

      {error && (
        <Text color="error.fg" data-testid="bundle-edit-error">
          {error}
        </Text>
      )}

      <form onSubmit={submit} noValidate>
        <Flex direction={{ base: "column", lg: "row" }} align="start" gap="section">
          {/* ─── The lines ─────────────────────────────────────────────────────────────────────────── */}
          <Stack flex="2" minW="0" w="full" gap="section">
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <CardTitle
                    aside={
                      readOnly ? null : (
                        <AllProductPicker
                          teamId={current.teamId}
                          value={lines.map((l) => l.productId)}
                          onChange={pick}
                          trigger={
                            <Button type="button" size="xs" variant="outline" data-testid="bundle-pick-products">
                              <Icon as={PackagePlus} boxSize="4" />
                              {t("bundles.form.addProducts")}
                            </Button>
                          }
                        />
                      )
                    }
                  >
                    {t("bundles.form.products")}
                  </CardTitle>

                  <Text fontSize="sm" color="fg.muted">
                    {t("bundles.form.productsHelp")}
                  </Text>

                  {lines.length === 0 && (
                    <Text fontSize="sm" color="fg.muted" data-testid="bundle-no-products">
                      {t("bundles.form.noProducts")}
                    </Text>
                  )}

                  <Stack gap="card">
                    {lines.map((line, i) => {
                      const product = products.data?.get(line.productId.toString());

                      return (
                        <BundleLineCard
                          key={line.productId.toString()}
                          index={i}
                          productId={line.productId}
                          product={product}
                          state={states[i]!}
                          ownerName={product ? owners.data?.[product.teamId.toString()]?.name : undefined}
                          quantity={line.quantity}
                          readOnly={readOnly}
                          onQuantity={(quantity) =>
                            setLines((prev) => prev.map((l) => (l.productId === line.productId ? { ...l, quantity } : l)))
                          }
                          onRemove={() => setLines((prev) => prev.filter((l) => l.productId !== line.productId))}
                        />
                      );
                    })}
                  </Stack>
                </Stack>
              </Card.Body>
            </Card.Root>
          </Stack>

          {/* ─── The details, and Save ─────────────────────────────────────────────────────────────── */}
          <Stack flex="1" minW="0" w="full" maxW={{ lg: "sm" }} gap="section">
            <Card.Root>
              <Card.Body>
                <Stack gap="card">
                  <CardTitle>{t("bundles.form.details")}</CardTitle>

                  {/* Read-only drops the `*` too: a required mark on a field nobody can type in asks for nothing. */}
                  <Field.Root required={!readOnly} readOnly={readOnly}>
                    <Field.Label>
                      {t("bundles.form.name")}
                      <Field.RequiredIndicator />
                    </Field.Label>
                    <Input
                      value={name}
                      maxLength={100}
                      placeholder={t("bundles.form.namePlaceholder")}
                      data-testid="bundle-name"
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Field.HelperText>{t("bundles.form.nameHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root readOnly={readOnly}>
                    <Field.Label>{t("bundles.form.description")}</Field.Label>
                    <Textarea
                      value={description}
                      rows={4}
                      maxLength={2000}
                      placeholder={readOnly ? undefined : t("bundles.form.descriptionPlaceholder")}
                      data-testid="bundle-description"
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Card.Body>
            </Card.Root>

            {!readOnly && (
              <>
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={save.isPending}
                  disabled={missing.length > 0}
                  data-testid="bundle-save"
                >
                  {isEdit ? t("bundles.form.saveChanges") : t("bundles.form.create")}
                </Button>

                {/* A disabled button says nothing about WHY — so what is missing is listed under it. */}
                {missing.length > 0 && (
                  <Stack gap="1" data-testid="bundle-form-missing">
                    <Text fontSize="xs" color="fg.muted">
                      {t("bundles.form.missing.title")}
                    </Text>
                    {missing.map((m) => (
                      <Text key={m} fontSize="xs" color="fg.muted" data-testid={`bundle-form-missing-${m}`}>
                        · {t(`bundles.form.missing.${m}`)}
                      </Text>
                    ))}
                  </Stack>
                )}
              </>
            )}
          </Stack>
        </Flex>
      </form>
    </Stack>
  );
}
