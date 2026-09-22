# Item - Sort Tags by Location v1.4

Searches any exact SellerChamp tag across Products and Batch listings, then sorts matching items naturally by warehouse location. It shares the suite's persistent Product index with Location Mover and maintains a Batch-listing index alongside it.

- Automatic refresh when the index is missing and every 24 hours afterward.
- Manual **Refresh Index** button.
- Filters for Products, Batches, or both.
- Sorts by location, SKU, title, or quantity.
- **Reload Live** fetches the selected Product's current tags, locations, and quantities directly from SellerChamp.
- SellerChamp links use the filtered Products-list URL for Products and the relevant manifest URL for Batch listings.

Version 1.1 fixes the shared Product index to retain `tags_array` and recognizes nested/alternate Batch tag fields.

Version 1.2 prevents simultaneous Product-index scans, spaces SellerChamp requests, retries HTTP 429 responses automatically, and reports progress/errors on screen.

Version 1.3 replaces free-text entry with a dropdown of every indexed tag. Each option reports its Product and Batch counts and displays results immediately when selected.

Version 1.4 exposes tags and search results while the Product index is still building, adds live scanned/tagged/unique-tag counters, and avoids adding status polling calls to the SellerChamp refresh queue.
