import { createClient } from "@connectrpc/connect";
import { AuthService, UserService } from "../gen/warehouse/user/v1/user_pb";
import { TeamService } from "../gen/warehouse/team/v1/team_pb";
import { ProductService } from "../gen/warehouse/product/v1/product_pb";
import { ShopService } from "../gen/warehouse/selling/v1/selling_pb";
import { OrderService } from "../gen/warehouse/selling/v1/order_pb";
import { OrderDraftService } from "../gen/warehouse/selling/v1/order_draft_pb";
import { ShippingService } from "../gen/warehouse/shipping/v1/shipping_pb";
import { CategoryService } from "../gen/warehouse/category/v1/category_pb";
import { DocumentService } from "../gen/warehouse/document/v1/document_pb";
import { InventoryService } from "../gen/warehouse/inventory/v1/inventory_pb";
import { SupplierService } from "../gen/warehouse/inventory/v1/supplier_pb";
import { SupplierChannelService } from "../gen/warehouse/inventory/v1/supplier_channel_pb";
import { RackService } from "../gen/warehouse/inventory/v1/rack_pb";
import { RestockRequestService } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { RegionService } from "../gen/warehouse/region/v1/region_pb";
import { RevenueService } from "../gen/warehouse/revenue/v1/revenue_pb";
import { ExpenseService } from "../gen/warehouse/expense/v1/expense_pb";
import { SettlementService } from "../gen/warehouse/settlement/v1/settlement_pb";
import { transport } from "../transport";

// One client per service, created once. The transport attaches the bearer token; the CURRENT
// TEAM is never attached automatically — it is a message field, so each caller passes it.
export const authClient = createClient(AuthService, transport);
export const userClient = createClient(UserService, transport);
export const teamClient = createClient(TeamService, transport);
export const productClient = createClient(ProductService, transport);
export const shopClient = createClient(ShopService, transport);
export const orderClient = createClient(OrderService, transport);
// Drafts are PERSONAL as well as team-scoped (#192): the server narrows every call to the caller,
// so a draft never appears for a colleague however the client asks.
export const orderDraftClient = createClient(OrderDraftService, transport);
export const shippingClient = createClient(ShippingService, transport);
export const categoryClient = createClient(CategoryService, transport);
export const documentClient = createClient(DocumentService, transport);
export const inventoryClient = createClient(InventoryService, transport);
export const supplierClient = createClient(SupplierService, transport);
export const supplierChannelClient = createClient(SupplierChannelService, transport);
// Racks belong to ONE warehouse — the team in the request body IS that warehouse (#129).
export const rackClient = createClient(RackService, transport);
export const restockClient = createClient(RestockRequestService, transport);
// Global reference data — regions are the same for everyone, so no team travels with these calls.
export const regionClient = createClient(RegionService, transport);
export const revenueClient = createClient(RevenueService, transport);
export const expenseClient = createClient(ExpenseService, transport);
// The ledger of what teams owe each other (#185). Read-only for now: the payment and terms services
// are declared in the same proto and land with #188/#189 — and the ledger WRITE path is in-process
// by design, so it has no client here and never will.
export const settlementClient = createClient(SettlementService, transport);

// rpcError turns a Connect error into something a human can read.
export function rpcError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
