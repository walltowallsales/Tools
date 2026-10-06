# Suite v1.45 · Relocate FLOOR Items v1.8

Fixes historical Batch FLOOR entries after an item is listed and moved in Products. Check Again and Find FLOOR Items now resolve an exact-SKU Product and read its current inventory before using the old Batch location. A current Product still at FLOOR replaces the Batch card and enables Product relocation; a verified Product at another location is removed from the FLOOR results and saved cache. Stale Batch index data cannot bring it back on a new verification scan.

Zero-stock Product placeholders do not override unsubmitted Batch inventory. Failed, incomplete, or ambiguous live inventory lookups retain the item for review rather than claiming the move succeeded.

Deploy these extracted files to your existing repository root. Existing persistent disk data is preserved. After deployment, tap Check Again on the stale item, or Find FLOOR Items to verify the list. No shared index rebuild is required for the SKU lookup.

Tested with mock integration scenarios for Batch-to-Product conversion at FLOOR, removal after moving to P401, persistence in saved results and no reappearance on rescan. Existing FLOOR tests cover Waterco placeholders, Batch quantities, positive FLOOR stock, deduplication, verified relocation, and preservation of other locations. No live inventory was changed during development.
