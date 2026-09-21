# SellerChamp Tools Suite v1.3

One Render service and one persistent disk containing five independently routed modules:

1. **Item - Move or Update Qty** (`/move/`) — Location Mover v2.32
2. **Item - Inventory Verify** (`/inventory/`) — Inventory Checker v1.5
3. **Item - Local Auction** (`/auction/`) — Auction Inventory v1.13
4. **Shipping - Pick List** (`/shipping/`) — Pick Batch v27
5. **Orders - Returns** (`/returns/`) — Returns v2.48

The original module source is kept in separate folders under `modules/`. The gateway gives each module its own path and process, so module-specific changes remain isolated. Shared environment settings are normalized by the gateway. One suite-level PIN login covers the dashboard and all five modules for 30 days.

Version 1.3 adds a one-time **Recover Existing Data** screen. It imports Pick batches from the original Pick app, then imports Returns records and their stored photos from the original Returns app. Existing combined-app data is preserved, duplicates are skipped, and the current data file is backed up before imports are committed.

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
├── pick/pick-batches.json
└── returns/
    ├── returns.json
    └── uploads/
```

## Recover existing Pick List and Returns history

The two existing disks cannot both be attached directly to the new service. Suite v1.3 includes a guided recovery screen instead:

1. Open **Recover Existing Data** from the suite dashboard.
2. Enter the original Pick app's Render URL and PIN, then recover and verify Pick batches.
3. Enter the original Returns app's Render URL and PIN, then recover and verify Returns records and photos.

The source URLs and PINs are used only during the transfer and are not stored. Keep the old paid services and disks until the recovered data has been verified in the combined app.

## Local test

```bash
npm install
npm run check
npm start
```

Open `http://localhost:10000`. Set values from `.env.example` in the shell or development environment before testing live SellerChamp operations.

## Updating one module later

Make changes only inside that module's folder and update its version label. The five module folders are:

```text
modules/location
modules/inventory
modules/auction
modules/pick
modules/returns
```

The gateway should need changes only when adding/removing a module or changing a module's displayed name/path.
