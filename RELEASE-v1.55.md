# Suite v1.55 — Returns v2.49 and FLOOR v1.9

## Orders — Returns
- Process Returns now filters instantly by case-insensitive partial SKU or title, with matching and total counts.
- Opening a return displays its details and processing form in a popup.
- Inventory and reserve actions display progress, errors, before/after quantities, and completion in a prominent result popup.
- Normal inventory and reserve are read back from SellerChamp. Only matching saved targets are archived automatically.
- A persistent action journal prevents an addition from being applied twice after retries, lost responses, or server restarts. An uncertain write remains open for a read-only recheck instead of repeating the addition.
- Saved pending updates are marked in the queue and can be rechecked from the original action.
- Completion history is kept in Archived Returns. Signal message preparation remains available.
- Listing activation is not changed by adding inventory; the completion popup shows its current status and a SellerChamp link.

## Item — Relocate FLOOR Items
- Saved results stay visible while the server refreshes them. New candidates are labelled as checking; always open one for current SellerChamp stock/location before moving.
- Recent checks are reused for five minutes across devices on the same server. Product reads and same-SKU batch promotion lookups are shared during a scan.
- Duplicate-SKU Products stay separate by Product ID. An ambiguous Batch does not silently select a Product.
- Existing verified moves, positive FLOOR stock checks, and Batch-to-Product handling are preserved.
- The page refreshes shared results in the background without restarting a scan. An open item is left undisturbed while being edited.

## Deploy
Extract the complete ZIP, upload its contents to the existing GitHub repository, commit, and deploy in Render. Keep the existing persistent disk and environment settings. Confirm Returns V2-49 and FLOOR v1.9. Pick List remains Version 39.

## Validation
Returns HTTP integration, verification/journal recovery, filtering and popup handlers; FLOOR caching/deduplication/duplicate-SKU checks and existing FLOOR regressions; existing Tag Sort and tag-transfer regressions; suite structure and JavaScript syntax checks.
Live SellerChamp credentials were not used for these checks.
