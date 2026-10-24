# Manual payment policy — manual-final-v1

Proposed checkout text, to be displayed before showing payment instructions and accepted explicitly:

> Top-ups and cosmetic purchases are final. We do not offer discretionary refunds at this time. This does not limit rights required by applicable law. For a duplicate transfer, incorrect payment or failed delivery, contact support for manual review. Do not send another payment while an existing one is being checked.

The terms checkbox must be unchecked initially. Save the request ID, policy version and acceptance timestamp using `accept_topup_terms`. Show the InstaPay address/QR, amount and order reference only after acceptance. Do not label the agreement as a donation if it purchases coins/items. App and item compatibility must be shown before spending.

After transferring, the customer submits their payment reference with `submit_topup_reference` and sends the receipt from their own payment app to the official WhatsApp Business number, with the request ID. Neither a screenshot nor a typed reference credits coins. Do not collect bank passwords or recovery keys.

The owner reads the WhatsApp image and calls `admin_record_topup_proof` with a review note. They separately check the actual incoming transfer in their own banking/InstaPay app and call `admin_review_topup` with the received amount and the receiving account's transaction reference. Sender/receiver references can differ; reconcile them using the amount, time and payment context rather than requiring identical strings. Suspicious/ambiguous payments remain pending or are rejected. Reference duplicates are blocked and both checks require an MFA-verified administrator.

No receipt image is made public or written into the coin ledger. Keep it in private WhatsApp support handling under a retention policy; the database records the customer reference and the owner's evidence-review audit. Do not announce payment verification as automated. Establish official contact details, processing hours, retention and exception handling before enabling paid top-ups.

Refund UI stays absent. Linked corrections and reconciliation remain necessary for mistakes, duplicate credits, mandatory remedies and fraud investigation; do not erase history or silently remove unrelated owned items. This policy does not make a pending payment “approved” and does not guarantee a submitted screenshot is genuine.
