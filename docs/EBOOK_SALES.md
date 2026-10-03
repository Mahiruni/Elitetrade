# EliteBot Strategy Rulebook ebook

The homepage advertises the 8-page PDF for a one-time **$50 USD** purchase. The
public `/ebook` page provides the description, a one-page preview, sign-in,
payment submission, approval status, and the buyer's download.

## Customer and administrator workflow

1. The customer signs in or creates an account from `/ebook` and returns there.
2. The customer pays $50 USD using an enabled bank/mobile payment method, or
   exactly 50 USDT to the existing merchant destination on the TRC20 network.
   Ebook payments are reviewed manually; membership crypto invoices are separate.
3. The customer submits the completed transfer's transaction reference.
4. Administration → Payments shows a pending `ebook` payment for $50. Verify the
   amount, asset, network, destination, and receipt of funds before approving.
5. The customer refreshes `/ebook` and downloads the full PDF. Approval does not
   activate trading membership or create subscription referral commissions.

Rejected purchases can be resubmitted with a new reference. References cannot be
reused across purchases. One pending or approved purchase per customer prevents
accidental duplicate payment submissions. Disabled accounts cannot download.

## Production storage and deployment

Apply `supabase/migrations/202610030001_ebook_sales.sql` before deploying the new
application. It adds the ebook payment type and private asset table, retains
existing payments, and leaves the membership/pool review behavior intact.

The complete PDF is stored as base64 in
`elitetrade_private.ebook_assets`, with its SHA-256 hash and page count. Upload
the PDF through an authorized database administration connection. The deployed
asset is `EliteBot_Strategy_Rulebook.pdf`, 8 pages, 168649 bytes, SHA-256
`990ce7235907405a7665cb598f842f1fb1ffdc4633520035744879f8d22d3293`.

**Do not add the complete PDF, its base64 bytes, or an unrestricted download URL
to this public repository or the public assets directory.** Only
`public/ebooks/elitebot-strategy-preview.pdf` is public.

The private table grants no asset access to anonymous or authenticated roles.
Public RPC wrappers use caller authority; private helpers check the caller,
account status, MFA assurance where required, and an owned approved $50 ebook
payment before returning the asset. The HTTP download checks approval again,
validates the file hash, and returns a private, non-cacheable PDF attachment.
The price and product are fixed by the server and database, not request fields.

## Local development

The SQLite adapter keeps ebook orders in a separate table so existing payment
and commission foreign keys do not need a destructive rebuild. Set
`EBOOK_PDF_PATH` to the full PDF outside `public/` and outside the repository.
Without a PDF, the local API refuses new ebook payment submissions. Tests inject
fixture bytes directly and never move money.

Run `npm run check` and `npm test`. The ebook tests cover fixed pricing, buyer
ownership, pending/rejected/approved access, duplicate submissions, admin review,
membership separation, protected download headers, and public preview routes.

The ebook distinguishes current demo-only bot rules from proposed refinements.
The refinements require implementation and validation; the product makes no
claim of tested profitability.
