# SellerChamp Tools Suite v1.26

One Render service and one persistent disk containing seven independently routed modules:

1. **Item - Move or Update Qty** (`/move/`) — Location Mover v2.40
2. **Item - Inventory Verify** (`/inventory/`) — Inventory Checker v1.5
3. **Item - Local Auction** (`/auction/`) — Auction Inventory v1.13
4. **Item - Sort Tags by Location** (`/tags/`) — Tag Location Sorter v1.11
5. **Shipping - Pick List** (`/shipping/`) — Pick Batch v31
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

## Pick Batch v31

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
