import type { RouteObject } from "react-router-dom";

import { SuppliersPage } from "../src/pages/suppliers";
import { SupplierDetailPage } from "../src/pages/supplier-detail";
import { DiscoverSuppliersPage } from "../src/pages/supplier-discover";
import { DiscoverSupplierDetailPage } from "../src/pages/supplier-discover-detail";
import { SupplierReportPage } from "../src/pages/supplier-report";

// THE SUPPLIER PAGES AS CHILD ROUTES OF A SHELL — the same paths src/router.tsx gives them, so a shell story's example
// page can be walked: the list, a supplier's page, Discover and its detail, the report (owner: *"halaman pemasok itu
// sampai detailnya kasih routenya juga"*). Shared by the desktop and the phone AppShell stories.
//
// The static paths (`discover`, `report`) outrank `:supplierId` — React Router ranks by specificity, not by order.
export const SUPPLIER_ROUTES: RouteObject[] = [
  { path: "inventories/suppliers", element: <SuppliersPage /> },
  { path: "inventories/suppliers/:supplierId", element: <SupplierDetailPage /> },
  { path: "inventories/suppliers/discover", element: <DiscoverSuppliersPage /> },
  { path: "inventories/suppliers/discover/:supplierId", element: <DiscoverSupplierDetailPage /> },
  { path: "inventories/suppliers/report", element: <SupplierReportPage /> },
];
