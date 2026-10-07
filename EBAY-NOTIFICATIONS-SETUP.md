# Suite v1.46 — eBay account deletion setup

1. Extract this ZIP. Upload its contents to your existing GitHub repository root, replacing the matching files. Keep your existing Render disk and environment variables.
2. In Render Environment add the values below, plus your Production eBay App ID and Cert ID. Save and deploy.

| Render key | Value |
| --- | --- |
| EBAY_CLIENT_ID | Production App ID (Client ID) from eBay |
| EBAY_CLIENT_SECRET | Production Cert ID (Client Secret) from eBay |
| EBAY_NOTIFICATION_ENDPOINT | https://sellerchamp-tools.onrender.com/ebay/account-deletion |
| EBAY_NOTIFICATION_VERIFICATION_TOKEN | Your own random secret, 32–80 characters using letters, numbers, hyphens or underscores. A password manager can generate it. Do not use your APP_PIN or SellerChamp token. |
| EBAY_SELLER_USERNAME | Stuff2SellThree |

3. After Render says Live, return to the eBay screen. Keep Marketplace Account Deletion selected, exemption OFF, and your already-saved email.
4. Notification endpoint: `https://sellerchamp-tools.onrender.com/ebay/account-deletion`
5. Verification token: copy the exact value you entered for EBAY_NOTIFICATION_VERIFICATION_TOKEN.
6. Click Save. eBay calls the challenge endpoint and verifies the SHA-256 response. Then click Send Test Notification.
7. While signed into your tools, open https://sellerchamp-tools.onrender.com/api/ebay-notifications/status. configured should be true. last_received confirms receipt; last_processed confirms a signature-verified event; pending should return to 0. If error is not null, send its text without any secrets.
8. Once your Production keyset is enabled, continue the seller OAuth token setup. Notification verification uses an application access token obtained automatically from App ID + Cert ID; it does not require the seller refresh token yet.

## Behavior

The public GET/POST notification endpoint bypasses the suite PIN, while setup status remains PIN-protected. Incoming notifications are durably queued before HTTP 202 acknowledgment, verified against eBay's public key, and retried every minute if eBay or the Freight Audit is unavailable. Forged signatures never perform cleanup. The queue survives deployment when DATA_ROOT is on your persistent disk. No token or notification payload is printed in logs.

Freight Audit only reads your own listings, with no buyer records or buyer personal data. A signed notification for a different named user therefore has no matching directly stored eBay records. For your seller account (or an event without a username, whose ownership cannot be excluded), all Freight Audit results are cleared and further audit calls are paused to prevent restoring deleted data. A paused audit is deliberately not automatically resumed. Contact us before removing the `freight-audit/ebay-deletion-block.json` marker; account-deletion events must be reviewed first. An eBay test using your seller identity can also trigger that pause. Existing SellerChamp module data is not deleted by this listing-only callback. If direct eBay order/buyer integrations are added later, their deletion handling must be added too.

Live eBay validation must be completed after deployment; automated tests use mocked eBay credentials and generated signing keys.

References:
https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion
https://github.com/eBay/event-notification-nodejs-sdk
