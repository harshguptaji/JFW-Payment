# JFW Live Payment Celebration

Requires Node.js 20+, MongoDB (local or Atlas), and Cloudinary account.

## Backend
```
cd backend
npm install
cp .env.example .env
```
Fill MongoDB URI, Cloudinary credentials in `.env`. Run `npm run dev`.

## Frontend (second terminal)
```
cd frontend
npm install
cp .env.example .env
npm run dev
```
Open http://localhost:5173/ on the display. Double-click the display to toggle fullscreen. Open http://localhost:5173/payment-entry on an employee device. Submit a confirmed payment with a photo. The connected display shows it for ten seconds, then returns to the logo or shows the next queued payment. `/admin` shows the latest 200 records.

Replace frontend/public/logo.svg with the official logo (or change the Logo component path). The supplied SVG is a placeholder. The background is #FDF2F1. No actual payment processing is performed. Sound is not included in this version.

For LAN testing, run `npm run dev -- --host 0.0.0.0` in frontend, change VITE_API_URL to the backend computer's LAN IP and port, and CLIENT_ORIGIN to the frontend LAN URL. Restart both servers. For deployment use HTTPS, configure the exact frontend origin and SPA fallback to index.html, and keep backend secrets out of Git. All routes and APIs are unauthenticated. Use only on a trusted local network with demo or consented data. Anyone with access can submit records, view history and receive live events. Do not expose this version to the public internet with real personal data. Obtain consent for displaying photos, especially children's photos, and define a retention policy. Live events are delivered only to connected displays; offline replay and submission idempotency are not implemented. Check history before retrying uncertain submissions.
