# Manual payment policy — manual-final-v1

Proposed checkout text, to be displayed before showing payment instructions and accepted explicitly:

> Top-ups and cosmetic purchases are final. We do not offer discretionary refunds at this time. This does not limit rights required by applicable law. For a duplicate transfer, incorrect payment or failed delivery, contact support for manual review. Do not send another payment while an existing one is being checked.

The terms checkbox must be unchecked initially. Save the request ID, policy version and acceptance timestamp using `accept_topup_terms`. Show the InstaPay address/QR, amount and order reference only after acceptance. Do not label the agreement as a donation if it purchases coins/items. App and item compatibility must be shown before spending.

Checkout copies the signed-in Lightning email for the InstaPay transfer note. After transferring, the customer confirms the date paid, the amount and the InstaPay address or wallet phone they paid from on `topup.html` (2026-10-26: no receipt image is asked for). Payment support is available at hello@lightningeg.com. Nothing the customer types credits coins. Never collect bank passwords or recovery keys.

The owner checks the incoming transfer in their own banking/InstaPay app, then types the amount that arrived (and its reference, if any) on the ticket in the MFA-protected console; it credits only when the money on the ticket equals the quote. Older tickets that carry a receipt image must have it shown first. Sender and receiver references can differ: reconcile amount, time, email note and sender address. Suspicious payments stay pending or are rejected. Duplicate references are blocked; replacement images require a fresh review.

Receipt storage (older tickets only) is private, limited to 5 MB JPEG/PNG/WebP. Owners see their own images; MFA administrators use short-lived signed URLs. Images never enter public profiles or the coin ledger. Establish official payment details, processing hours, retention and exception handling before enabling paid top-ups. This remains a manual verification process.

Refund UI stays absent. Linked corrections and reconciliation remain necessary for mistakes, duplicate credits, mandatory remedies and fraud investigation; do not erase history or silently remove unrelated owned items. This policy does not make a pending payment “approved” and does not guarantee a submitted screenshot is genuine.
