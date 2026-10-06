# Item - Freight Shipping Audit · v1.0

Deploy the complete Suite v1.44 package using your existing Render service and persistent disk. Existing module versions and data locations are preserved. The new module has its own saved audit file under DATA_ROOT/freight-audit.

## eBay access

SellerChamp discovery uses your existing SELLERCHAMP_TOKEN. Live eBay checks require separate production eBay seller authorization. In Render Environment add:

- EBAY_CLIENT_ID — production eBay App ID / Client ID
- EBAY_CLIENT_SECRET — production eBay Cert ID / Client Secret
- EBAY_REFRESH_TOKEN — OAuth refresh token obtained after your selling account consents, including https://api.ebay.com/oauth/api_scope
- EBAY_SITE_ID — optional; default 0 (US)

The server renews short-lived access tokens automatically. For an initial test you can instead set EBAY_USER_ACCESS_TOKEN to a production seller OAuth access token, but that token expires and must be replaced. Do not use an application-only client-credentials token. Keep credentials in Render, never source files.

Official authorization instructions: https://developer.ebay.com/develop/guides/sell/authorization
GetItem reference: https://developer.ebay.com/Devzone/xml/docs/reference/ebay/GetItem.html
Negotiated freight definition: https://developer.ebay.com/devzone/xml/docs/reference/ebay/types/ShippingTypeCodeType.html

## Use

Open Item - Freight Shipping Audit and tap Scan Freight Shipping. The server reads the SellerChamp catalog through the shared rate-limited queue, then checks candidate eBay listing IDs sequentially. You can close the page; another device sees the same saved job/results. Only one job runs at a time. Stop Audit retains partial results. A service restart retains results but stops the job; manually scan again to restart it.

The module selects known SellerChamp weights strictly greater than 80 pounds. Item weight is preferred; package weight is a fallback. Explicit kg/oz units are converted. Missing weights are counted, not assumed to be zero. Recognized non-eBay channels and inactive/draft SellerChamp records are excluded. Live eBay listing status is authoritative for remaining candidates. The API may omit weight, channel, listing ID, location or shipping fields: such omissions limit completeness. Review the missing-weight count; a completed scan is not a guarantee every heavy listing was discoverable. Missing eBay listing IDs can be entered per item. Listing ID and, when supplied, eBay SKU are checked before classifying shipping.

Freight confirmed requires active eBay ShippingType FreightFlat with no free shipping option. Other freight types are shown as needing attention because the requested workflow is negotiated freight. FreeShipping flags trigger the Free Shipping warning; explicit zero-cost services also trigger it outside FreightFlat, whose negotiated price may be a placeholder. Failures and missing shipping status remain Needs Review.

The first catalog scan may take several minutes, or longer if other modules are busy. Catalog requests share the existing SellerChamp queue; eBay checks run no faster than one per second and honor HTTP 429 delays. Original standalone apps using the same SellerChamp token still have independent traffic. There is no automatic audit at startup.

## Corrections

Use Open in SellerChamp, change the Product's shipping configuration there, allow synchronization, then Recheck eBay. This release deliberately does not send shipping mutations to either service: SellerChamp's exact freight-setting API has not been verified. A one-tap correction requires a supported shipping endpoint and the appropriate freight profile for your account. Results stay visible until a recheck actually confirms negotiated freight; no cosmetic success messages.

## Validation

Automated tests use mock data. Production SellerChamp field mapping and your eBay credential access must be tested after deployment. No live inventory or listing was changed while building this release.
