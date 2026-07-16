import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Flex, Heading, Icon, Image, SimpleGrid, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";
import { ArrowLeft, Pencil } from "lucide-react";
import { categoryClient, productClient, rpcError } from "../api/clients";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import type { Category } from "../gen/warehouse/category/v1/category_pb";
import { useTeam } from "../team/TeamContext";
import { pathToRoot } from "../categories/categoryTree";

function parseProductId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// ProductDetailPage is the read-only detail route for a product (#83) — a PAGE, not a dialog. It
// shows the SKU, name, description, its category as a breadcrumb (Parent › Child), and the image
// gallery, scoped to the current team, with an Edit shortcut. Reached by clicking a product row.
export function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseProductId(productId);
  const teamId = current?.teamId;

  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (teamId === undefined || id === 0n) {
      setError(id === 0n ? "Invalid product id." : "");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [detail, cats] = await Promise.all([
        productClient.productDetail({ teamId, productId: id }),
        categoryClient.categoryList({}),
      ]);
      setProduct(detail.product ?? null);
      setCategories(cats.categories);
    } catch (err) {
      setError(rpcError(err));
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("products.heading")}</Heading>
        <Text color="fg.muted" data-testid="product-detail-no-team">
          {t("products.detail.noTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !product) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="product-detail-back"
          onClick={() => navigate("/products")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("products.backToProducts")}
        </Button>
        <Text color="red.fg" data-testid="product-detail-error">
          {error || t("products.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const categoryLabel =
    product.categoryId > 0n ? pathToRoot(categories, product.categoryId).map((c) => c.name).join(" › ") : "";

  return (
    <Stack gap="section" data-testid="product-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="product-detail-back"
        onClick={() => navigate("/products")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        Back to Products
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md">{t("products.detail.heading")}</Heading>
        <Spacer />
        <Button
          size="xs"
          variant="outline"
          data-testid="product-detail-edit"
          onClick={() => navigate(`/products/${product.id}/edit`)}
        >
          <Icon as={Pencil} boxSize="4" />
          {t("products.edit")}
        </Button>
      </Flex>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Heading size="sm" data-testid="product-detail-name">
              {product.name}
            </Heading>

            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field label={t("products.field.sku")} value={product.sku} />
              <Field label={t("products.field.category")} value={categoryLabel} />
            </SimpleGrid>

            <Field label={t("products.field.description")} value={product.description} />
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontWeight="medium">{t("products.images")}</Text>
            {product.images.length === 0 ? (
              <Text color="fg.muted" fontSize="sm" data-testid="product-detail-no-images">
                {t("products.detail.noImages")}
              </Text>
            ) : (
              <SimpleGrid columns={{ base: 3, md: 5 }} gap="card" data-testid="product-detail-images">
                {product.images.map((img, i) => (
                  <Image
                    key={`${img.url}-${i}`}
                    src={img.thumbnailUrl || img.url}
                    alt={`${product.name} image ${i + 1}`}
                    aspectRatio={1}
                    objectFit="cover"
                    w="full"
                    borderWidth="1px"
                    borderRadius="md"
                    data-testid={`product-detail-image-${i}`}
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
