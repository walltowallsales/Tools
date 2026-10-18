# Connect eBay — Suite v1.52

1. Upload this build and deploy in Render. Keep all existing environment values and the existing persistent disk mounted at /var/data (DATA_ROOT=/var/data).
2. In Render Environment, keep EBAY_CLIENT_ID and EBAY_CLIENT_SECRET from the Production keyset. Set PUBLIC_BASE_URL=https://sellerchamp-tools.onrender.com (use your actual app address if different).
3. In eBay Developer > User Tokens > Production > Get a Token from eBay via Your Application, expand the existing SellerChamp Tools redirect entry.
4. Set Your auth accepted URL to:
   https://sellerchamp-tools.onrender.com/freight-audit/oauth/callback
   Set Your auth declined URL to that same address. Leave the account-deletion notification URL unchanged. Keep your existing valid privacy policy URL.
5. Enable OAuth for this redirect entry if needed. Copy the complete RuName (eBay Redirect URL name) from the entry. This is a name, not the HTTPS callback address.
6. Add EBAY_RUNAME in Render with that exact RuName. Save and deploy. No EBAY_REFRESH_TOKEN entry is needed with the Connect button. Existing temporary token may remain as a fallback before connection.
7. Open Freight Shipping Audit using the exact PUBLIC_BASE_URL. Click Connect eBay, sign into Stuff2SellThree and approve. Start from the app button, not eBay Test Sign-In or the preview.
8. You should return to the audit with Automatic renewal enabled. Click Retry eBay Checks. The 27 missing listing IDs remain a separate issue.

The app requests only https://api.ebay.com/oauth/api_scope for GetItem. It does not write eBay listings. Tokens are stored encrypted in DATA_ROOT/freight-audit/ebay-oauth.enc with server-only permissions, never included in the browser or a download. Encryption uses the Client Secret; changing that secret requires reconnecting. Keep the existing persistent disk to retain authorization across deployments. Account deletion notifications clear saved tokens. Refresh authorization is long-lived, not everlasting; reconnect if eBay revokes or expires it.
