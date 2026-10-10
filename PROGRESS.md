# Project Progress

Last updated: 2026-10-11

## Current State

- Next.js app is in `app/page.tsx`; most dashboard UI and state are currently implemented in this single client component.
- The latest `npm run build` passed (compile, TypeScript, static generation).
- Data is held in React state only. There is no backend or persistence layer, so refreshing the page resets records to initial data.
- Chinese UI text uses Simplified Chinese; Japanese and English labels are preserved.
- Login management currently supports temporary in-page account records with name, login ID, company, position, and an optional password update while editing. It is not real authentication, and records reset on refresh.

## Completed Work

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
- Use `npm run build` to verify changes.
- Several `npm run dev` attempts reported port 3000 already in use and an existing Next dev server. Reuse the existing `http://localhost:3000/` session if it is still running; avoid starting another server on the same port.
