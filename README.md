# DSM_REPORT

SMRT-inspired DSM Service Request Dashboard with server-side file hosting, shareable public links, multi-select filtering, KPI analytics, and weekly comparison mode.

## Architecture

- `frontend/`: React + TypeScript + Material UI + Recharts
- `backend/`: Express + TypeScript + SQLite + Multer + XLSX parsing

## Key Features Implemented

- Compact professional status legend with tooltip descriptions and multi-row wrapping.
- CSV/XLS/XLSX upload to server storage with progress indicator and notifications.
- Persistent upload sessions in SQLite with version tracking by series.
- Public shareable URL for each uploaded dataset (`/share/:shareId`) with no re-upload required.
- "Copy Share Link" action after upload completion.
- Automatic upload pipeline: store file, parse/validate rows, refresh metrics, update filters, generate link.
- Advanced multi-select filters (module/status) with search, select-all, clear-all, and instant updates.
- SMRT transit-themed modernized UI with animated train workflow bar and railway-style hero section.
- KPI cards for total, open, in progress, closed, average resolution time, and overdue requests.
- Analytics charts for module/status distribution, monthly trend, SLA compliance, and ageing distribution.
- Drill-down by clicking chart segments to apply filters.
- Sticky filter bar, quick search, dark mode, loading skeletons, mobile responsive layout.
- Export filtered results to CSV.
- Column personalization with show/hide toggles.
- Weekly update mode including executive summary cards:
	- Newly created requests
	- Closed requests
	- Status changes
	- SLA risks
	- Delayed requests

## Run Locally

### 1) Start Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs at `http://localhost:4000`.

### 2) Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

## API Endpoints

- `POST /api/uploads` (multipart form-data)
	- fields: `file`, optional `seriesId`, optional `weeklyMode` (`true`/`false`)
- `GET /api/share/:shareId`
- `GET /api/series/:seriesId`
- `GET /uploads/:fileName` (static file access)

## Notes

- Upload files are saved under `backend/uploads/`.
- Session and metrics data are persisted in `backend/data/dsm.db`.
