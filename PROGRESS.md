# Project Progress

Last updated: 2026-10-15

## Current State

- Latest balance requirement: profit is request total plus manually entered other income minus manually entered expenses. Entire order request remains attributed to its first actual service month (excluding rest dates), including base price once and all dates' request extras. Page and A4 share company/request/other income/expense/net totals. Income and expense entries are saved separately per company/month and retain operation history; the income-classification migration preserves existing entries as expenses. Other financial reports are unchanged.

- Corrected the reservation calendar's all-vehicles filter to include outsourced vehicles; model-only and outsourced-only filters retain their existing scopes.
- Replaced balance CSV with a portrait A4 report. The formula is request total plus manual other income minus manual expense total, with no automatic wage/vehicle/operating-cost deductions. Invalid drafts/unavailable manual entries show an explicit error and block export. Positive/zero net remains black monthly profit, negative net red monthly loss.

- Added invoice-status filtering immediately before deposit status in order accounting; list, totals and A4 metadata use the combined filters and reset on region changes.
- Added optional company seal upload/preview/removal and company-list entry; PNG/JPEG/WebP input is normalized to bounded PNG and stored with company data under existing region/RLS policies. Development migration `20261024000000_company_seal.sql` executed and seal save/removal/constraint checks passed in a rolled-back transaction. Invoices place the issuer's seal beside its name; the shared printer waits for image decoding. Synthetic invoice image decoding and A4 layout checked; authenticated upload/save and physical printing remain unverified. Production is unchanged.

- Next.js dashboard is in `app/page.tsx`; business data uses Supabase and the API routes in `app/api`.
- `npm.cmd run lint` and `npm.cmd run build` passed on 2026-10-15 (compile, TypeScript, static generation).
- Supabase Auth provides sign-in and password recovery. Database migrations include region isolation for Tokyo, Osaka, and Hokkaido; see `README.md` for setup.
- Chinese UI text uses Simplified Chinese; Japanese and English labels are preserved.
- Basic runtime checks passed: `/login` and `/forgot-password` return 200; unauthenticated requests to `/` and `/reset-password` redirect to login; `/api/data` and `/api/admin/accounts` return 401.
- Authenticated business operations and region permissions have not been verified end-to-end in this session. They require an authorized user to sign in.
- Recovered the finance-enabled historical Vercel deployment `4hda3GvGqnhEr4juQi5ybr7wdi5L` and saved its source separately before three-way merging it with local region isolation.
- Restored order accounting, driver wages, vehicle monthly finances, balance expenses, and their original migrations. Added `20261020000000_finance_region_isolation.sql` for both financial tables and same-region vehicle references.
- Order names in the order accounting report now open the existing order financial statistics dialog.
- The financial statistics dialog includes invoice status and an optional sent date below accounting status, with API validation and migration `20261021000000_order_invoice_status.sql`.
- The order accounting table shows invoice status and deposit status immediately before request amount: pending invoices are red and completed invoices are green. CSV exports use the same column order, with aligned monthly totals.
- The order accounting table and CSV now show `車両番号` after the driver, resolving the vehicle plate by both vehicle name and order region; unavailable plates display `-`.
- The order accounting table and CSV omit order status after the order name; the driver follows directly. Stored order status and other views are unchanged.
- All dashboard dialog backdrops dismiss their dialog without saving; interior clicks do not dismiss. Delete confirmation preserves its in-progress lock and clears password/error on dismissal.
- Multi-day accounting daily summaries omit request/profit and show ETC, fuel cost, liters, and calculated JPY/L instead; whole-order totals are unchanged.
- Added expense-only A4 print/PDF export from the accounting editor, including daily wages/advances and signature lines while excluding request/price/profit/invoice/deposit fields. Output uses current unsaved editor values and automatically scales for one page. Browser layout bounds checked with 7, 31, and 90 sample days; actual printer/PDF pagination still needs user confirmation.
- Revised A4 export to ascending-date blocks, grouping each day's driver/plate, costs, and wages together instead of separating fuel and wage tables. Kept detailed whole-order expense totals. Grouping/totals tests, lint, and type checks passed; revised browser layout fits A4 bounds with 7 and 31 sample days.
- Added one-driver monthly A4 wage sheets in `給料統計`, requiring a specific region and driver. Includes wage components, separate advances, totals, recorded-day count and signature lines; excludes request/price/profit. Existing CSV retained; shared A4 print helper extracted. Wage/totals/escaping tests, lint and type checks passed. A 31-row browser sample fits A4 layout bounds; actual print/PDF output and authenticated UI remain to be confirmed.
- Added order-company filtering to wages and replaced the wage CSV button with an A4 portrait all-driver company summary. Export ignores individual driver selection, groups same-name drivers separately by region, and includes only drivers with saved records. Individual wage sheets remain available and respect company selection. Filter/aggregation tests, lint and TypeScript passed; 30-driver sample fits single-page A4 bounds.
- Unified the wage dashboard and both wage exports: driver advances, wage components, wage total, then payment total (driver advances + wages). Advances remain outside wages and company advances are excluded. Updated per-row amounts, monthly totals and summary cards without changing wage calculations. Render/total checks, lint and TypeScript passed; both 31-row print samples fit A4 bounds.
- Replaced `経理統計` CSV with portrait A4 monthly financial report preserving current filters, amounts and status colors. Added source after order name in both list and export. Totals/escaping tests, lint and TypeScript passed; 31-order browser sample fits A4 bounds.
- Added Japanese A4 invoice export to the accounting dialog and company bank/T-number registration throughout domain, API, DB types, forms and list. Development migration `20261022000000_company_invoice_details.sql` executed and both columns confirmed; production unchanged. User confirmed tax-inclusive 10% on all four requested items. Invoice sums order price plus three trip-report categories, calculates included tax once with whole-yen truncation, and excludes overtime. Tests passed for same-region recipient/issuer, multi-day sums, input validation, tax rounding, escaping and company API round-trip. Lint/TypeScript passed; invoice sample fits A4 bounds. Authenticated save/print remains to be confirmed.
- Invoice item labels now omit the trip-report suffix. Added persistent per-company serial numbers via `POST /api/invoices/number` and locked database allocation; same order/company reuses its number. Migration `20261023000000_invoice_serial_numbers.sql` executed only in development. Rollback-only DB tests passed for sequential numbers, independent companies, reprints, mismatched company rejection, anonymous/profile-less rejection and direct-table privilege restrictions. No test records or numbers retained. API tests, invoice amounts/labels, lint and TypeScript passed; concurrent stress and authenticated end-to-end printing remain untested.
- Replaced vehicle statistics CSV with portrait A4 vehicle/month report. Selected-vehicle reports include operational details/totals, monthly fees, supplies, odometers, distance and net/per-km profit from current inputs. Invalid monthly inputs and ambiguous same-name vehicle selection block export. Calculation, input validation and binding tests plus lint/TypeScript passed; 31-row browser sample fits A4 bounds. Actual print/PDF pagination remains to be confirmed.
- All-vehicle mode now shares one monthly aggregation between the eight-column dashboard and A4 report, with one row per vehicle and bottom profit totals after fixed costs/supplies. Includes inactive vehicles' costs, saved zero overrides, default parking/insurance for unregistered months, separate regions and explicitly labeled unmatched historical vehicle records. Same-region ambiguous names block aggregation rather than guessing. Single-vehicle daily details and unsaved-input printing remain unchanged.
- Regression checks cover invoice defaults, saving/reopening/clearing, API date/status validation, rendered status colors, and table/CSV column alignment.
- Local environment settings were preserved; production code and business records have not been changed. Development database finance and invoice migrations completed successfully in the SQL editor; authenticated dashboard persistence and region access checks remain pending.

## Earlier UI Work

The following describes the earlier prototype work. Account management and data storage have since moved to Supabase as described above.

- Calendar shows an 11-day window and uses a bottom-floating date slider; the selected date is positioned third from the left.
- Reservations render as continuous date-range bars. Rest days can be added/removed in the order form, get an orange `休运` segment, and show only the rest label on those dates.
- Appointment cards support drag-and-drop; multi-day reservations support selecting a contiguous date range and dragging that segment to another vehicle.
- Same-day single-day reservations stack in one date cell. Card height/layout adapts to booking density, and order name/source/driver content is centered. One-booking cards are taller and vertically centered.
- Order form is ordered as requested and stores a start date, end date, and rest dates.
- Order name and vehicle name in the order list each open a different details dialog. The order-name dialog is titled `行程指示書` and contains plate, driver, source, ownership, start date/location, end date/location, and notes. The vehicle-name dialog shows plate, driver name, phone, WhatsApp, and WeChat.
- Calendar reservation card backgrounds use the selected order-source color; text colors are unchanged.
- Driver records have optional license expiry; expired driver names render red in the driver list and appointment cards. Driver creation requires only a name.
- Vehicle records have optional inspection and self-liability expiry dates. An expired date derives the displayed status `休运` in the vehicle list and calendar; the saved manual status remains available when the expiry date is corrected. New vehicle creation requires only the plate and falls back to the plate as vehicle name.
- Driver, vehicle, order-source, and company lists have batch-add dialogs with validation. Batch vehicle/source formats were extended for optional dates/color while preserving supported legacy rows.
- Vehicle and order-source forms have save actions; all four management forms use accessible, sticky save footers.
- Login management lists user name, login ID, company, position, and masked password status. Creating an account does not request a password; editing allows an optional password update.
- Removed the subtitle beneath the application title and its matching metadata description.

## Resume Notes

- Start from `app/page.tsx` and follow its existing state/handler patterns for small UI changes.
- Read `AGENTS.md` before implementation. It notes this Next.js version differs from common conventions and requires consulting the local guide in `node_modules/next/dist/docs/` before coding.
- In Windows PowerShell, use `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run dev` if script execution policy blocks `npm.ps1`; no policy change is necessary.
- A local development server was started and verified at `http://localhost:3000/` on 2026-10-15. Reuse it if it is still running; check the port before starting another server.
- Continue authenticated checks after the user signs in. Do not ask for passwords or keys in chat, and do not modify real business records without agreement on test data.
