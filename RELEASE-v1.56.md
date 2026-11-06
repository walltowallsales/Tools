# Suite v1.56 — Returns V2-50

Returns now reads Product detail from the same .json endpoint used by the reserve controls in Tag Sort, including when resolving a product by SKU. This avoids relying on summary fields for reserve counts. Missing or malformed inventory responses remain blocked, with separate stock/reserve error messages; missing counts are never silently treated as zero.

The retry button says Try Again if no update was saved, and Recheck Saved Update only when an action journal exists. Previous verification, archiving and duplicate-add protections remain in place.

Tested normal/reserve HTTP processing with a starting reserve of 7, preserving and increasing it to 9, with no reserve field on the summary endpoint. Verification, retry, popup handler and suite checks passed with simulated SellerChamp responses.

Upload the extracted files to the existing GitHub repository, commit and deploy. Confirm Returns V2-50. No new environment settings. All v1.55 FLOOR and other module changes are included.
