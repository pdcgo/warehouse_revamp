import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { productClient, rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useSaveProduct } from "../../features/products/queries";
import { CategorySelect } from "../../components/CategorySelect";
import { toaster } from "../../components/Toaster";
import { ProductImagesInput } from "./components/ProductImagesInput";
import type { ProductImageValue } from "./components/ProductImagesInput";

// ProductEditPage is the create/edit surface for a product as a DEDICATED PAGE, not a popup
// (issue #60) — because it now carries a category and a gallery of up to 5 images, which need room.
// One component serves both /products/new (create) and /products/:productId/edit (edit); the
// presence of :productId decides which.
export function ProductEditPage() {
  const { productId } = useParams<{ productId: string }>();
  const editing = productId !== undefined;
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  // The write and its invalidation, declared together (#177).
  const saveProduct = useSaveProduct();

  const teamId = current?.teamId;

  // A warehouse team cannot create products (#101) — block the create form even by direct URL.
  useEffect(() => {
    if (!editing && current?.teamType === TeamType.WAREHOUSE) {
      void navigate("/products", { replace: true });
    }
  }, [editing, current?.teamType, navigate]);

  const [loading, setLoading] = useState(editing);
  const saving = saveProduct.isPending;
  const [error, setError] = useState("");

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<bigint>(0n);
  const [images, setImages] = useState<ProductImageValue[]>([]);

  // On edit, load the full product (including its ordered gallery) so the form is pre-filled and the
  // page is deep-linkable.
  useEffect(() => {
    if (!editing || teamId === undefined) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await productClient.productDetail({ teamId, productId: BigInt(productId) });
        const p = res.product;

        if (!cancelled && p) {
          setSku(p.sku);
          setName(p.name);
          setDescription(p.description);
          setCategoryId(p.categoryId);
          setImages(p.images.map((im) => ({ url: im.url, thumbnailUrl: im.thumbnailUrl })));
        }
      } catch (err) {
        if (!cancelled) {
          setError(rpcError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editing, productId, teamId]);

  async function save(event: FormEvent) {
    event.preventDefault();

    if (teamId === undefined) {
      return;
    }

    setError("");

    try {
      // The invalidation travels WITH the write now (#177), which matters most on a page like this
      // one: it writes and then leaves, so the list it returns to is a different component with no
      // callback to hand a refetch to. Arriving there is a cache hit, not a fetch — and without the
      // invalidation the product just created is simply missing from the list that opens a moment
      // later. That failure does not announce itself: the save succeeded and the toast appeared.
      await saveProduct.mutateAsync(
        editing
          ? {
              productId: BigInt(productId),
              fields: {
                teamId,
                sku,
                name,
                description,
                categoryId,
                // A present wrapper REPLACES the gallery with exactly this set.
                images: { items: images },
              },
            }
          : { fields: { teamId, sku, name, description, categoryId, images } },
      );

      toaster.create({
        type: "success",
        title: editing ? t("products.toast.saved") : t("products.toast.created", { sku }),
      });

      void navigate("/products");
    } catch (err) {
      setError(rpcError(err));
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("products.heading")}</Heading>
        <Text color="fg.muted" data-testid="product-edit-no-team">
          {t("products.noTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  // Category is required; SKU and name too. The backend enforces all three regardless.
  const canSave = sku.trim() !== "" && name.trim() !== "" && categoryId > 0n;

  return (
    <Stack gap="section" maxW="2xl" data-testid="product-edit-page">
      <Flex align="center" gap="card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back"
          data-testid="product-edit-back"
          onClick={() => navigate("/products")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Heading size="md">{editing ? t("products.form.editTitle") : t("products.form.newTitle")}</Heading>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="product-edit-error">
          {error}
        </Text>
      )}

      <form onSubmit={save} noValidate>
        <Stack gap="section">
          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Field.Root required>
                  <Field.Label>{t("products.field.sku")}</Field.Label>
                  <Input value={sku} data-testid="product-edit-sku" onChange={(e) => setSku(e.target.value)} />
                </Field.Root>

                <Field.Root required>
                  <Field.Label>{t("products.field.name")}</Field.Label>
                  <Input value={name} data-testid="product-edit-name" onChange={(e) => setName(e.target.value)} />
                </Field.Root>

                <Field.Root>
                  <Field.Label>{t("products.field.description")}</Field.Label>
                  <Textarea
                    value={description}
                    data-testid="product-edit-description"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field.Root>

                <Field.Root required>
                  <Field.Label>{t("products.field.category")}</Field.Label>
                  <CategorySelect
                    value={categoryId}
                    onChange={setCategoryId}
                    placeholder={t("products.form.categoryPlaceholder")}
                    leafOnly
                  />
                  <Field.HelperText>{t("products.form.categoryHelp")}</Field.HelperText>
                </Field.Root>
              </Stack>
            </Card.Body>
          </Card.Root>

          <Card.Root>
            <Card.Body>
              <Stack gap="card">
                <Text fontWeight="medium">{t("products.images")}</Text>
                <ProductImagesInput teamId={teamId ?? 0n} value={images} onChange={setImages} />
              </Stack>
            </Card.Body>
          </Card.Root>

          <Flex justify="end">
            <Button
              type="submit"
              colorPalette="brand"
              loading={saving}
              disabled={!canSave}
              data-testid="product-edit-save"
            >
              {editing ? t("products.save") : t("products.create")}
            </Button>
          </Flex>
        </Stack>
      </form>
    </Stack>
  );
}
