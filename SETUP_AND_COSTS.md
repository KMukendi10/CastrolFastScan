# Castrol FastScan setup and cost guide

**Prepared:** 14 October 2026  
**Currency:** Prices below are listed in USD where providers publish a public USD price. Your South African billing currency, exchange rate, VAT, carrier charges, and provider price changes can affect the final amount.

## What you need

| Service | Needed for | Cost to budget |
|---|---|---:|
| Supabase | Castrol FastScan database, rep sign-in, and saved registrations | Free for testing; Pro starts at **$25/month** for a production project. Free projects may pause after a week of low activity. [Pricing](https://supabase.com/pricing) |
| Vercel | Hosting the live Next.js application | Free Hobby is limited to personal, non-commercial use. For a business deployment, Pro is **$20/month for one user**, with more for additional paid seats or usage. [Plans](https://vercel.com/pricing), [Hobby terms](https://vercel.com/docs/plans/hobby) |
| Resend | Optional email verification (not used by the current registration forms) | No Resend subscription is needed for the current form flow. If enabled later: Free **3,000 emails/month**, with a **100/day** limit; Pro is **$20/month** for 50,000 emails/month. [Pricing](https://resend.com/pricing) |
| Twilio Verify | Sending and checking SMS OTP codes | Usage-based. Verify is **$0.05 per successful verification**, plus the SMS delivery charge. Twilio lists outbound SMS to South Africa at **$0.1355 per SMS segment**; one successful OTP sent in one SMS is therefore about **$0.1855**, before carrier charges and tax. Each resend can add another SMS charge. [Verify pricing](https://www.twilio.com/en-us/verify/pricing), [South Africa SMS pricing](https://www.twilio.com/en-us/sms/pricing/za) |
| Google Sheets + Apps Script | The shared registration workbook and its sync receiver | **$0** with a Google account, within Apps Script quotas. No Google Workspace subscription or paid Google Cloud plan is required for this setup. Consumer accounts have 20,000 URL Fetch calls/day and a six-minute maximum per script execution. [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) |
| ChatGPT | Castrol FastScan operation | **Not required.** Your ChatGPT plan does not control Castrol FastScan’s Google Sheets connection. |
| Custom domain | Optional email sender identity and/or a branded app URL | Not needed for the current form flow. A domain must be verified with Resend before sending production email OTPs if email verification is enabled later. |

Google Workspace is optional. A personal Google account can own the test workbook and Apps Script deployment. If you want business email, managed accounts, or organization administration, Workspace is an extra subscription; its public US Business Starter price is $7/user/month with an annual commitment or $8.40/user/month on a flexible plan. Local prices and offers can differ. [Workspace plans](https://knowledge.workspace.google.com/admin/getting-started/editions/business-editions)

The current forms use Twilio Verify for SMS OTP. Email addresses are required and confirmed with a second entry, but are not OTP-verified. Resend can be configured later if the business wants email OTP; Twilio Verify's $0.05 fee applies to successful SMS OTP verification, plus the SMS delivery charge.

## Monthly budget examples

### Local testing

**$0/month in subscriptions** is possible with Supabase Free, Resend Free, a personal Google account, and the development-only OTP bypass. Keep `CONTACT_VERIFICATION_BYPASS=true` only in local development. The bypass does not send codes and is disabled by the app in production. Twilio usage is $0 while SMS delivery is not used.

Supabase Free can pause after a week of low activity, so this is suitable for development and trials, not dependable public service.

### Small live business pilot

Starting subscription estimate for one paid Vercel user and one Supabase production project:

- Vercel Pro: **$20/month**
- Supabase Pro: **from $25/month**
- Resend: **$0/month** while under its free limits
- Google Sheets and Apps Script: **$0/month** within quotas
- Twilio: usage-based; about **$0.1855 per successful SMS verification** sent as one SMS, before carrier charges/tax
- Domain: extra if you need to buy one

**Estimated base: from $45/month plus SMS usage, domain cost if applicable, tax, and any usage overages.** Vercel Pro pricing is per paid team member. Vercel Hobby is not licensed for commercial use.

For example, 100 successful SMS OTP verifications with one SMS each would be approximately **$18.55** in Twilio list charges before any carrier charges or tax. Resends add message charges. SMS prices can vary by country, carrier, and message segmentation; check the account console before launch.

## Required account and setup checklist

### 1. Supabase

- Create the project and apply `db/001_schema.sql`, `db/002_reps_and_rls.sql`, `db/003_contact_verification.sql`, `db/004_profile_service_access.sql`, and `db/005_email_confirmation_without_otp.sql` in order.
- Disable public sign-ups. Create the rep and manager users yourself.
- Keep the Supabase URL, public/publishable key, and server secret key from the same project.
- For a live business deployment, use a plan that meets the required uptime, backup, and data-retention expectations; the Free plan can pause after inactivity.

### 2. Optional email OTP with Resend

Email OTP is not required for the current registration flow. Client forms require an email address and a matching confirmation entry, while mechanics must verify their phone number by SMS.

- If you later decide to enable email OTP, create a Resend account and verify a domain you control. Add the DNS records Resend provides (typically SPF and DKIM; configure DMARC for the domain as well).
- Add `RESEND_API_KEY` and a sender on that verified domain in the server environment.
- The free plan's limit is 3,000 emails/month and 100/day; budget for Pro if expected OTP traffic exceeds either cap.

### 3. SMS OTP with Twilio

- Create a Twilio account and a Verify service.
- Enable SMS verification and make sure South Africa is allowed for sending in your Verify service/Geo Permissions.
- Put the Account SID, Auth Token, and Verify Service SID in the server environment. Do not put them in client-side variables.
- Add a spend alert and monitor retries/resends. Failed or uncompleted verifications do not incur the $0.05 successful-verification fee, but SMS delivery attempts may still be charged.

### 4. Google Sheets sync

- Import the final Quorum workbook into Google Sheets and use a copy for testing. The current integration targets only its `WhatsApp Import` tab for eligible mechanic records; spares sync is not configured yet.
- Paste `google-apps-script/Code.gs` into **Extensions → Apps Script**.
- In **Project Settings → Script Properties**, create `FASTSCAN_SYNC_SECRET` with a long random secret.
- Add `FASTSCAN_SPREADSHEET_ID` in Script Properties, using the ID from the Google Sheets URL.
- Deploy a new **Web app** deployment that executes as the sheet owner. Copy the `/exec` URL.
- Put that URL in `GOOGLE_APPS_SCRIPT_URL` and the same secret in `GOOGLE_SHEETS_SYNC_SECRET` on the Castrol FastScan server. These are server-only settings.
- Make sure the workbook has a `WhatsApp Import` tab with its 15 headings in row 1. The script locates fields by heading, upserts by Mechanic ID, and checks consent and WhatsApp-number eligibility.
- Use the manager dashboard's **Sync mechanics to WhatsApp Import** button to send eligible saved mechanic records. New eligible mechanic registrations sync after save. The dashboard's **Open live sheet** button opens the configured workbook.
- Share the workbook only with staff authorized to view client details.

### 5. Vercel production deployment

- Deploy the Castrol FastScan repository to Vercel and add all server variables from `.env.example` to the Vercel project's Production environment.
- Set `CONTACT_VERIFICATION_BYPASS=false` in production. Never copy a live Twilio, Resend, Supabase service-role, or Sheets sync secret into a `NEXT_PUBLIC_` variable.
- For commercial Castrol FastScan use, select Vercel Pro rather than Hobby.
- If using a custom app domain, configure it in Vercel; its registration/renewal is a separate registrar cost.

## Environment variables to configure

The complete variable list is in `.env.example`. For live use, the important groups are:

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Email OTP (optional, not used by current forms): `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- SMS OTP and verification security: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `CONTACT_OTP_SECRET`
- Google Sheet sync: `GOOGLE_APPS_SCRIPT_URL`, `GOOGLE_SHEETS_SYNC_SECRET`, plus `FASTSCAN_SPREADSHEET_ID` in Apps Script properties
- Production security: `CONTACT_VERIFICATION_BYPASS=false`

Use separate secrets for `CONTACT_OTP_SECRET` and `GOOGLE_SHEETS_SYNC_SECRET`. Do not send credentials in chat or commit `.env.local`; it is ignored by Git.

## Items with no separate subscription

- ChatGPT Free or Plus is unrelated to the Castrol FastScan app's Google integration.
- The app's existing Excel/CSV downloads do not need Excel installed by clients; users can open exported files in compatible spreadsheet software.
- No ChatGPT Google Drive connector is needed.
- This Apps Script integration does not require a service account or a paid Google Sheets API project.

Prices checked on **14 October 2026** from the linked provider pages. Providers can change pricing, allowances, availability, and country-specific charges; check the linked pages and account billing screens before purchase.
