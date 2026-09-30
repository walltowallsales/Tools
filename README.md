# SellerChamp Tools Suite v1.28

One Render service and one persistent disk containing seven independently routed modules:

1. **Item - Move or Update Qty** (`/move/`) — Location Mover v2.40
2. **Item - Inventory Verify** (`/inventory/`) — Inventory Checker v1.5
3. **Item - Local Auction** (`/auction/`) — Auction Inventory v1.13
4. **Item - Sort Tags by Location** (`/tags/`) — Tag Location Sorter v1.11
5. **Shipping - Pick List** (`/shipping/`) — Pick Batch v33
6. **Orders - Returns** (`/returns/`) — Returns v2.48

7. **Orders - Consignment** — `/consignment/`

The original module source is kept in separate folders under `modules/`. The gateway gives each module its own path and process, so module-specific changes remain isolated. Shared environment settings are normalized by the gateway. One suite-level PIN login covers the dashboard and all seven modules for 30 days.

Version 1.20 indexes all marketplace listing titles, including active listings without tags and not-submitted batches. The Location Mover searches these titles alongside Product titles; the shared index automatically rebuilds after deployment. Version 1.18 added the persistent freight workflow to Shipping - Pick List.

## Deploy on Render

Do not delete or change the six existing Render services yet.

1. Create a new GitHub repository named `sellerchamp-tools`.
2. Upload **the contents of this folder** to that repository. `package.json`, `gateway.js`, and `render.yaml` must be at the repository root.
3. In Render choose **New + → Blueprint** and connect the new repository.
4. Render will read `render.yaml` and propose one paid web service with one 1 GB disk. Apply the Blueprint.
5. Enter these secret environment values when prompted:
   - `SELLERCHAMP_TOKEN` — the same SellerChamp API token used by the current apps
   - `APP_PIN` — the PIN you want all modules to use
   - `PUBLIC_BASE_URL` — initially leave blank; after Render assigns the URL, set it to the full URL such as `https://sellerchamp-tools.onrender.com`
   - `DELETE_BATCH_PIN` — copy from the current Pick List service if you use it
   - `SC_SHIP_FROM_ADDRESS_ID` and `SC_EBAY_TEMPLATE_ID` — copy from the current Returns service
6. Deploy and open the service URL. Test every module before moving any data or cancelling old services.

## Persistent disk layout

The one mounted disk is deliberately divided so the two stateful modules cannot overwrite each other:

```text
/var/data/
├── move-product-search-index.json
├── tag-batch-search-index.json
├── pick/pick-batches.json
└── returns/
    ├── returns.json
    └── uploads/
```

## Preserved data

Pick and Returns history stays on the mounted persistent disk during this update. The dashboard no longer displays the completed recovery tool.

## Local test

```bash
npm install
npm run check
npm start
```

Open `http://localhost:10000`. Set values from `.env.example` in the shell or development environment before testing live SellerChamp operations.

## Updating one module later

Make changes only inside that module's folder and update its version label. The seven module folders are:

```text
modules/location
modules/inventory
modules/auction
modules/tag-sort
modules/pick
modules/returns
modules/consignment
```

The gateway should need changes only when adding/removing a module or changing a module's displayed name/path.

## Pick Batch v33

Use **Skip** (centered below Back and Next) for rack items. The shelf pass advances to the next normal item. Outstanding forklift stops remain in the active batch and are listed together under **Forklift Pass**. Open each stop there and complete it in the pick guide; the batch cannot archive until all forklift stops are picked. Freight remains a separate shipping follow-up workflow.

## v1.25
- Pick List Version 32: renamed freight choices to `Picked — Already Packed` and `Picked — Needs to be Packed`.
- Renamed `Never mind` to `Cancel`.
- Renamed the main freight button to `Freight / Waiting` and moved it below the centered `Skip` button.
- Freight workflow behavior is unchanged.

Version 1.25 adds direct batch links to Sort Tags results. Batch rows show their originating batch, and Product rows include matching batch links when the shared index can identify them. Links open the named manifest filtered by SKU.


## v1.26 — Orders - Consignment

Adds a seventh module, Orders - Consignment v1.0, at `/consignment/`. Uses the existing SellerChamp token and suite PIN. Stores the shared ledger at `DATA_ROOT/consignment/consignment.json`, on the existing persistent disk. No new environment variables are needed.

Start with a short date range or an exact order number you know contains a Glen sale. Scans paid order items, checks the associated Product for the exact Glen tag (case insensitive), and records the consigner at import. Repeated scans do not duplicate identified order items. Existing ledger entries remain associated with Glen even if the tag is later removed. A scan runs in the background and reports lookup errors; an incomplete scan must not be considered a complete statement. Requests are serialized with a default 3-second gap and retry on HTTP 429. Other services using the same token still contribute to its account quota. Scans are manual; none starts on deployment.

Calculation in USD cents: (unit price × sold quantity + buyer shipping allocated to this line − marketplace selling fees − advertising fees not already included − shipping cost − refunds) / 2. Glen's share rounds to the nearest cent, with any remainder belonging to Stuff2Sell. Marketplace fees are imported from the order item, never from a Product fee estimate. Missing values stay blank. Multi-item order shipping totals are not assigned automatically to Glen's line. Sales tax and product purchase cost are excluded. Separate advertising fees are entered manually because the documented order response does not identify them separately. Review the marketplace fees for overlap before adding advertising fees.

Shipping is entered manually as Estimated or Actual. ShipStation is not connected in this version. Shows package weight and dimensions when supplied, with item weight/dimensions as fallback. All amounts are per order item, including its full sold quantity. Enter 0 for no advertising, free shipping, or no refund. Use Refunds for the amount returned to the buyer, excluding tax, and adjust fees for any fee credits. Cancelled/refunded orders need manual review; an order status change resets review but does not infer a refund amount. Currency other than USD cannot be settled in this version.

Review all amounts before recording payment. The Record Payment action only records a payment already made; it does not transfer money. Payments preserve the amounts used at the time, reference, timestamp, and shipping estimate/actual label. Later corrections create a positive or negative balance against previously recorded payments. Negative adjustments record amounts recovered from Glen or offset against future payments; they do not erase the original payment. Stale/double payment submissions are rejected.

Download CSV for reporting and JSON ledger backup for a complete copy including change/payment history. Keep the existing Render disk and DATA_ROOT setting during deployment.

SellerChamp API reference used for order and Product fields: https://apidocs.sellerchamp.com/


## v1.27 — Recover a missed pick batch

Shipping - Pick List is now Version 33. The smaller amber **I Forgot to Create the Pick Batch** button sits below eBay Orders. It opens a separate recovery screen rather than immediately creating a batch.

Enter a From / Through date and time in Central time (America/Chicago). The default start is five minutes before the latest non-deleted saved batch; if there is no batch it defaults to yesterday. The through time includes the entire displayed minute. Date ranges are limited to 90 days; invalid daylight-saving times and the repeated fall-back hour are rejected with an explanation. The order timestamp uses SellerChamp purchased_at, with order_date and other order date fields as fallbacks.

Find Orders to Recover includes paid eBay orders regardless of shipped/unshipped status, excluding cancelled/refunded/returned, on-hold, and orders already in non-deleted batches or non-cancelled freight tracking. The preview shows order number, placed time, items and shipped status. Nothing is selected by default. Check orders that still physically need picking, or use Select All / Clear All. Create Batch from Selected Orders requires confirmation. A shipped order means its label/status was updated; it does not establish that an item was pulled.

Previews expire after 15 minutes or a service restart. Re-search if a preview expires. Creation checks again for orders captured since the preview, and prevents simultaneous batch creation and replaying a successful creation. Snapshot creation reads the current saved data before writing, preserving edits made while SellerChamp lookups ran. Recovered batches carry their source time window and show Already marked shipped beside applicable orders in the printable list and pick guide. Inventory details are current at snapshot time and may reflect quantities already deducted for sold items.

The normal Create Pick Batch button keeps its qualifying unshipped-order workflow. No scheduled batches are created. Existing batch, freight, forklift/Skip and consignment data remain in the same persistent disk locations. No new environment variables are required. Deploy the extracted suite files to the existing repository root.


## v1.28 — Consignment photos, scan coverage and check payouts

Orders - Consignment v1.1 adds product photos to newly scanned items; older entries can use Load photo without rescanning orders. Photos are displayed when SellerChamp supplies a usable URL.

Scan ranges, completion times and results persist on the existing disk. A full-month badge requires complete successful date coverage; adjacent successful partial scans can cover a month together. Errors, stopped scans, exact-order searches and interrupted scans do not establish full-month coverage. Running scans interrupted by deployment/restart are marked Interrupted on startup. Scans made before this version were not logged, so previous coverage is unknown. Coverage describes orders checked as of that scan, and does not guarantee that later refunds, new orders or tag changes have been refreshed. Date ranges now use Central-time day boundaries.

Age labels and optional filters use calendar days in America/Chicago: 0–36, 37–60 and 61+ days. These labels do not prevent payment; the operator chooses which reviewed items to pay.

Select individual eligible items or select eligible items in the current view. Pay selected items opens a form with the unpaid balance and an editable Pay now amount for each. Amounts must be positive and cannot exceed the current unpaid balance. The form displays the combined check total and balances left unpaid. Enter the check number, payment date and optional note. Record check payment saves all allocations atomically. Requests with stale balances, duplicate items or reused check numbers are rejected. An identical retry of a successfully recorded request returns the existing payment without paying again.

Preview PDF does not record payment. Saved payment PDFs are available under Check payments and in individual payment histories. Statements include SKU, title, order number, quantity, age group, fee/shipping calculation, Glen's share, previously paid, amount on this check, unpaid remainder, check number/date and total. Payment snapshots remain unchanged after later ledger edits. Legacy payments remain in item history; they cannot be retroactively combined into a check statement because their original check/date allocations were not recorded.

The separate advertising fee entry is removed. Include any applicable additional fees in Selling / marketplace fees. Previously entered advertising-fee deductions remain on existing records so balances do not change; they are identified as prior extra fees on the ledger/PDF/CSV. No actual funds are transferred. No ShipStation credentials or integration are required. Existing consignment ledger data and the Pick recovery workflow are retained.
