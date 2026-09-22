# SellerChamp Tools Suite v1.10

One Render service and one persistent disk containing six independently routed modules:

1. **Item - Move or Update Qty** (`/move/`) — Location Mover v2.37
2. **Item - Inventory Verify** (`/inventory/`) — Inventory Checker v1.5
3. **Item - Local Auction** (`/auction/`) — Auction Inventory v1.13
4. **Item - Sort Tags by Location** (`/tags/`) — Tag Location Sorter v1.2
5. **Shipping - Pick List** (`/shipping/`) — Pick Batch v27
6. **Orders - Returns** (`/returns/`) — Returns v2.48

The original module source is kept in separate folders under `modules/`. The gateway gives each module its own path and process, so module-specific changes remain isolated. Shared environment settings are normalized by the gateway. One suite-level PIN login covers the dashboard and all six modules for 30 days.

Version 1.10 makes the Tag module the sole shared-index owner inside the combined suite. SellerChamp requests are paced and serialized, and HTTP 429 rate limits are retried automatically with increasing delays. The screen now shows active progress, rate-limit waits, and refresh failures instead of appearing idle.

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

Make changes only inside that module's folder and update its version label. The six module folders are:

```text
modules/location
modules/inventory
modules/auction
modules/tag-sort
modules/pick
modules/returns
```

The gateway should need changes only when adding/removing a module or changing a module's displayed name/path.
