# Walkthrough - Mobile Stok & Araç Depoları (Satış) Separation

I have completed the separation of the general company-wide **Stok** viewer and the vehicle-depot stock management and **Araç Depoları (Satış)** screen in the mobile app. This matches the page separation found in the web admin panel.

---

## Changes Made

### 1. Administrative API Helpers
* **[MODIFY] [stockApi.ts](file:///C:/projects/B2B-ERP/service-ops-mobile/src/pages/admin/stockApi.ts)**:
  * Registered and exported `fetchTechnicianStockItemsAdmin`, `createTechnicianSaleAdmin`, and `calculateTechnicianSalePricesAdmin` pointing to backend admin-facing endpoints:
    * `/api/erp/admin/technician-stock/{technicianId}`
    * `/api/erp/admin/technician-sale/{technicianId}`
    * `/api/erp/admin/technician-sale/calculate-prices/{technicianId}`

### 2. Mobile Navigation Tabs Setup
* **[MODIFY] [TechnicianTabs.tsx](file:///C:/projects/B2B-ERP/service-ops-mobile/src/app/TechnicianTabs.tsx)**:
  * Restored the `"Stok"` tab label (icon: `Package`).
  * Registered a new tab `"VehicleDepotSale"` with label `"Araç Depoları (Satış)"` (icon: `Warehouse`).
  * Ensured both tabs are unconditionally visible to technicians.
* **[MODIFY] [AdminTabs.tsx](file:///C:/projects/B2B-ERP/service-ops-mobile/src/app/AdminTabs.tsx)**:
  * Restored `"Stok"` tab label (icon: `Package`).
  * Added and registered `"VehicleDepotSale"` tab with label `"Araç Depoları (Satış)"` (icon: `Warehouse`).

### 3. Reverting General Stok Page
* **[MODIFY] [StockScreen.tsx](file:///C:/projects/B2B-ERP/service-ops-mobile/src/pages/admin/StockScreen.tsx)**:
  * Reverted custom technician vehicle warehouse checks, ensuring it always displays the general company-wide product/parts stock using `fetchStockItems`.
  * Removed the `"Satış Yap"` action button and deleted all direct sale modal/calculations markup to keep the screen focused on inventory checks and ordering spare parts.

### 4. Creating Direct Sales & Vehicle Inventory Page
* **[NEW] [VehicleDepotSaleScreen.tsx](file:///C:/projects/B2B-ERP/service-ops-mobile/src/pages/technician/VehicleDepotSaleScreen.tsx)**:
  * Implemented a brand new screen that adapts dynamically depending on the logged-in user's role:
    * **Technician**: Shows their own vehicle warehouse stock (`fetchTechnicianStockItems`) and features a `"Satış Yap"` button.
    * **Admin/SSA**: Displays a searchable technician selection drawer listing technicians mapped to active vehicle warehouses. Selecting a technician loads their vehicle stock using `fetchTechnicianStockItemsAdmin` and enables a `"Doğrudan Satış Yap"` button.
  * Clicking "Satış Yap" opens a modal containing:
    * **Müşteri / Cari Seçimi**: Auto-populates all active customers instantly on mount (using `fetchErpCustomers`), with filtering support as they type in the search box.
    * **Satılacak Ürünler**: Lists products with available quantity > 0 in the vehicle warehouse, complete with +/- counters, unit price display, and line totals.
    * **Fiyat Hesaplama**: Automatically calls B2B ERP price calculation (`calculateTechnicianSalePrices` / `calculateTechnicianSalePricesAdmin`) as soon as a customer is chosen, dynamically updating pricing list items.
    * **Ödeme Tipi & Toplam**: Offers choices for Cash, POS, Bank Transfer, and Open Account, summarizing Subtotal, VAT, and Grand Total.
    * **Submit Action**: Submits direct sales to the ERP API (`createTechnicianSale` / `createTechnicianSaleAdmin`) and refreshes warehouse stock quantities.

---

## Technical Verification

### 1. Code Compilation
Verified that all changes compile cleanly under strict TypeScript conditions:
* **Mobile Project**: Running `npx tsc --noEmit` inside `service-ops-mobile` completed successfully with `exit code 0` (no errors or warnings).

### 2. Verification Steps for Staging
1. Open the mobile app. Check the sidebar menu.
2. Verify that **Stok** and **Araç Depoları (Satış)** appear as two distinct pages.
3. Tap **Stok**: verify it lists general products and parts.
4. Tap **Araç Depoları (Satış)**:
   * **Technician View**: Displays current vehicle depot stock. Click "Satış Yap" to select a customer, verify items, calculate prices, choose payment method, and complete a sale.
   * **Admin/SSA View**: Shows a selector field. Tap it to search and select a technician. Verify their vehicle warehouse inventory loads and you can perform a sale on their behalf.
