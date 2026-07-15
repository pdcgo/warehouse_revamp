import { createClient } from "@connectrpc/connect";
import { AuthService, UserService } from "../gen/warehouse/user/v1/user_pb";
import { TeamService } from "../gen/warehouse/team/v1/team_pb";
import { ProductService } from "../gen/warehouse/product/v1/product_pb";
import { ShippingService } from "../gen/warehouse/shipping/v1/shipping_pb";
import { CategoryService } from "../gen/warehouse/category/v1/category_pb";
import { DocumentService } from "../gen/warehouse/document/v1/document_pb";
import { InventoryService } from "../gen/warehouse/inventory/v1/inventory_pb";
import { transport } from "../transport";

// One client per service, created once. The transport attaches the bearer token; the CURRENT
// TEAM is never attached automatically — it is a message field, so each caller passes it.
export const authClient = createClient(AuthService, transport);
export const userClient = createClient(UserService, transport);
export const teamClient = createClient(TeamService, transport);
export const productClient = createClient(ProductService, transport);
export const shippingClient = createClient(ShippingService, transport);
export const categoryClient = createClient(CategoryService, transport);
export const documentClient = createClient(DocumentService, transport);
export const inventoryClient = createClient(InventoryService, transport);

// rpcError turns a Connect error into something a human can read.
export function rpcError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
