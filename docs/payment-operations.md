# Checkout and community operations

## Customer workflow

1. Sign in on the main website and open **Wallet** from the account menu. The same account owns the wallet and purchases across website devices.
2. Enter a whole EGP amount and see the exact coins, including any bonus. Accept the payment terms. Each request freezes the price, receiving details, signed-in email and terms version.
3. Only the accepted checkout shows the private QR, receiving address, exact recipient display name and copy buttons. Verify the name in InstaPay, send the quoted amount once, and put the Lightning account email in the transfer note.
4. Enter the sending InstaPay address and receipt reference, then upload the original PNG, JPEG or WebP (maximum 5 MB). A reference or screenshot alone never credits coins.
5. Review the status on the wallet page. Receipt submission hides the transfer instructions to discourage paying twice. Refresh or leave the page open for status updates. Sign-out clears private payment information.
6. After manual reconciliation, the account wallet receives its coins once. Buy a compatible website cosmetic in Marketplace; quoted-price confirmation debits the wallet and creates permanent account inventory atomically. Equip it on supported website surfaces. Native PC/phone rendering and claiming remain a separate release gate; do not sell a native asset until that version and delivery are ready.

## Owner workflow

Open `/admin.html`, sign in with the owner account and verify an authenticator code. The server requires an active AAL2 session for financial and moderation operations. Routine operations use this console; no SQL or Google Sheet editing is needed.

- **Checkout setup:** upload the real QR privately, verify the receiving address and exact displayed name, and save the processing message. Real receiving information is not a public asset or repository file. Turn checkout off to pause new payments; existing requests still resolve.
- **Pricing:** change the rate, allowed range or bonuses here. Existing quotes retain their value. The default is 5 coins per EGP, minimum 10 EGP and maximum 10,000 EGP, with no bundles.
- **Record money received:** independently open the receiving bank/InstaPay app. Record the receiving transaction reference, amount, actual date/time, customer email note and sender address if available. Check the confirmation only after seeing actual funds. If the customer has not supplied a request ID, leave the transfer unmatched and match it later.
- **Reconcile requests:** find the member/request, match sender, email note, timing and amounts, open the private receipt and confirm both review checks. Receiving and sending reference strings may differ. Match every partial incoming transfer to the same request. Approve only when the verified bank total equals the accepted quote. Approval, receipt revision check, reference consumption and wallet credit commit together.
- **Ledger discrepancies:** must remain zero. The immutable Supabase ledger is the balance source; spreadsheets can be exports only. Do not manually edit wallet balances or ledger entries.
- **Manual credits:** use a clear reason for promotional/support credits. Coins are spendable; recognition points affect the leaderboard. This control is not bank reconciliation and must not substitute for approving a real payment.

## Exceptions and privacy

Unpaid requests can be cancelled. A paid request must stay available until resolved; matching uncredited funds prevent rejection/deletion from hiding an unresolved payment. Never tell a customer to send the full amount again while an existing transfer is being checked.

For an underpayment or overpayment, either wait for missing funds or propose an explicit revised amount/coin offer. The member must accept it on their wallet page. Acceptance invalidates the prior receipt review; reload and review again before crediting. Declining does not silently change the quote or consume money.

The no-discretionary-refunds policy is accepted before payment and does not remove mandatory legal rights or correction of payment/delivery errors. **Record completed bank return** only after actually returning the full uncredited funds outside the website. It records evidence and closes the request; it never transfers money and cannot refund a credited request. For credited corrections, escalate for a reviewed, linked financial correction; do not edit history or use another credit to conceal the error.

An incorrect uncredited journal entry can be corrected, matched, unmatched or voided with an audit reason. A void retains its reference reservation. A mistyped reference can receive a verified alias; original and corrected references both remain protected from reuse, including after credit. Incoming/outgoing references share a unique registry. Do not void a genuine transfer merely to bypass a duplicate-reference warning.

Customers can read only their own request/history/receipts and funding totals. The QR endpoint requires an active signed-in session and that customer's accepted pending checkout. General checkout availability reveals no receiving details. Administrators access private bank records and short-lived receipt links; operational audit data excludes receipt images. Real account details and image bytes are provisioned privately after schema deployment. Private checkout limits access, but cannot prevent a legitimate customer saving a QR or taking a screenshot.

Run receipt retention regularly in the console: expired images older than 90 days may be deleted through Storage; pending evidence is protected and the financial ledger remains. Account deletion blocks unresolved payments, removes files through Storage first and scrubs retained sender identity. Contact: hello@lightningeg.com.

## Social coins and community safety

Members save a private title/summary draft, copy its verification code and Lightning backlink into their own LinkedIn or Reddit post, save the URL and submit with community-rule consent. There is no forced disclosure line in the composer or public post cards.

The moderator opens the external source and verifies ownership code, Lightning backlink and content compliance. Only general money-management experience and educational tips are accepted. Solicitation, advertising/offering financial services and personalized financial or investment advice are prohibited. The visible sidebar states removal and community bans, and explains responsibility for interactions on outside platforms, subject to law.

The owner may award up to 500 coins and/or 500 recognition points per post. Source URLs and ledger keys prevent repeated rewards; at most three posts per member earn coins in a rolling 30 days. Withdrawal or editing cannot reset the quota. Suggested starting moderation policy: 50 coins for a useful original post, 100 for a detailed example, no reward for copied, promotional or unverifiable content. Points remain an independent editorial decision. These are operator recommendations, not a guaranteed payout.

Content changes invalidate verification. An outdated moderation screen cannot approve a newer revision. A community ban hides pending/published listings and prevents new submissions; restoration is audited and does not automatically republish removed content. The site never posts to social accounts automatically and never rewards likes, votes or comments.

## Pricing and operational economics

| EGP paid | Base coins | Bonus | Total coins |
| --- | --- | --- | --- |
| 10 | 50 | 0% | 50 |
| 50 | 250 | 0% | 250 |
| 100 | 500 | 5% | 525 |
| 500 | 2,500 | 10% | 2,750 |
| 1,000 | 5,000 | 15% | 5,750 |

Bonuses use the highest qualifying percentage, are not cumulative, and round down to whole coins. The maximum bonus is deliberately bounded at 15%; the owner can change future pricing. At the current 100-coin starter-palette price, a 20 EGP top-up buys one; Mono remains free. Track outstanding coins and reward issuance as obligations to deliver cosmetics, not cash profit.

Illustration only: at an average 50 EGP purchase, two minutes of manual review valued at 100 EGP/hour costs about 3.33 EGP per order. With 2,000 EGP monthly fixed costs and no other variable cost, break-even is about 43 paid orders/month before tax, asset production, payment charges and support. With 1,000 users this requires about 4.3% buying monthly; with 10,000, about 0.43%. Neither user count nor the coin exchange rate guarantees profit. Measure actual conversion, support time, revenue, cosmetic development costs and payment-provider terms before scaling. Manual review becomes a staffing constraint as order volume grows.

## Deployment and acceptance

Apply source migrations 2300, 2400, 2500 and 2600 after the existing core/audit/member-guard migrations. Provision receiving details and private QR through trusted runtime administration, never public source. Deploy versioned frontend assets. Retire legacy unquoted purchases and old receipt-review calls with migration 2100 only after the new frontend is live. Local tests apply migrations in filename order; the deferred retirement is compatible with the newer wrappers.

Run the SQL integration suite, browser-script tests, site checks and phone/desktop browser acceptance. Confirm zero wallet discrepancies and review Supabase security advisors. Then perform one genuine owner-supervised bank transfer, receipt upload, independent bank confirmation, credit, marketplace purchase and cross-device inventory check. Automated tests simulate transfers locally; they are not proof of live bank receipt or native app delivery. No real money is moved by these tests.

Security-advisor review: private QR/reference tables deliberately have RLS enabled with no client policies (deny by default). Public profile projection views retain consent/adult/member filters and safe display-field allowlists; their definer-view notices remain intentional. Definer RPCs explicitly enforce ownership or active owner/MFA access and fixed search paths. The project also reports that leaked-password protection is disabled; this Auth setting is a remaining provider hardening item, not evidence of successful payment acceptance. See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and [definer-view review](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).
