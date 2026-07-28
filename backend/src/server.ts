import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { customAlphabet } from 'nanoid';
import XLSX from 'xlsx';
import { z } from 'zod';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_PATH = path.join(ROOT, 'data', 'dsm.db');
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id TEXT NOT NULL UNIQUE,
  series_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  previous_upload_id INTEGER,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  weekly_mode INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  weekly_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL,
  req_no TEXT NOT NULL,
  description TEXT,
  module TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT,
  creation_age_days INTEGER,
  update_age_days INTEGER,
  resolution_days REAL,
  overdue INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  FOREIGN KEY(upload_id) REFERENCES uploads(id)
);

CREATE INDEX IF NOT EXISTS idx_requests_upload_id ON requests(upload_id);
CREATE INDEX IF NOT EXISTS idx_requests_module ON requests(module);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
`);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${stamp}_${nanoid()}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only CSV/XLS/XLSX files are supported.'));
  }
});

type ParsedRow = {
  reqNo: string;
  description: string;
  module: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  creationAgeDays: number;
  updateAgeDays: number;
  resolutionDays: number;
  overdue: boolean;
  raw: Record<string, unknown>;
};

type WeeklyDiff = {
  newRequests: number;
  closedRequests: number;
  statusChanges: number;
  slaRisks: number;
  delayedRequests: number;
};

type Metrics = {
  totalRequests: number;
  openRequests: number;
  inProgress: number;
  closedRequests: number;
  averageResolutionTime: number;
  overdueRequests: number;
  requestsByModule: { name: string; value: number }[];
  requestsByStatus: { name: string; value: number }[];
  monthlyTrend: { month: string; created: number; closed: number }[];
  ageingDistribution: { bucket: string; value: number }[];
  slaCompliance: { compliant: number; breached: number; percent: number };
};

const uploadBodySchema = z.object({
  seriesId: z.string().min(3).max(120).optional(),
  weeklyMode: z.union([z.literal('true'), z.literal('false')]).optional()
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

app.post('/api/uploads', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: 'File is required.' });
      return;
    }

    const parse = uploadBodySchema.safeParse(req.body || {});
    if (!parse.success) {
      res.status(400).json({ message: 'Invalid upload payload.' });
      return;
    }

    const weeklyMode = parse.data.weeklyMode === 'true';
    const seriesId = parse.data.seriesId || `series_${nanoid()}`;
    const rows = parseWorkbook(req.file.path, req.file.originalname);

    if (!rows.length) {
      res.status(422).json({ message: 'No valid rows were found in the file.' });
      return;
    }

    const metrics = buildMetrics(rows);
    const previousUpload = db
      .prepare('SELECT * FROM uploads WHERE series_id = ? ORDER BY version DESC LIMIT 1')
      .get(seriesId) as { id: number; metrics_json: string } | undefined;

    const version = previousUpload ? getLatestVersion(seriesId) + 1 : 1;
    const shareId = nanoid();
    const now = new Date().toISOString();

    const previousRows = previousUpload ? getRowsByUploadId(previousUpload.id) : [];
    const weekly = weeklyMode ? buildWeeklyDiff(previousRows, rows) : null;

    const insertUpload = db.prepare(`
      INSERT INTO uploads (
        share_id, series_id, version, previous_upload_id, file_name, file_path,
        weekly_mode, row_count, metrics_json, weekly_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRow = db.prepare(`
      INSERT INTO requests (
        upload_id, req_no, description, module, status, created_at, updated_at,
        creation_age_days, update_age_days, resolution_days, overdue, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      const result = insertUpload.run(
        shareId,
        seriesId,
        version,
        previousUpload?.id ?? null,
        req.file!.originalname,
        req.file!.filename,
        weeklyMode ? 1 : 0,
        rows.length,
        JSON.stringify(metrics),
        weekly ? JSON.stringify(weekly) : null,
        now
      );

      const uploadId = Number(result.lastInsertRowid);
      rows.forEach((row) => {
        insertRow.run(
          uploadId,
          row.reqNo,
          row.description,
          row.module,
          row.status,
          row.createdAt,
          row.updatedAt,
          row.creationAgeDays,
          row.updateAgeDays,
          row.resolutionDays,
          row.overdue ? 1 : 0,
          JSON.stringify(row.raw)
        );
      });

      return uploadId;
    });

    const uploadId = tx();

    res.status(201).json({
      shareId,
      seriesId,
      version,
      uploadId,
      rows: rows.length,
      weekly,
      metrics,
      shareUrl: `/share/${shareId}`,
      fileUrl: `/uploads/${req.file.filename}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed.';
    res.status(500).json({ message });
  }
});

app.get('/api/share/:shareId', (req, res) => {
  const record = db
    .prepare('SELECT * FROM uploads WHERE share_id = ? LIMIT 1')
    .get(req.params.shareId) as Record<string, unknown> | undefined;

  if (!record) {
    res.status(404).json({ message: 'Share link not found.' });
    return;
  }

  const uploadId = Number(record.id);
  const rows = getRowsByUploadId(uploadId);
  const versions = db
    .prepare('SELECT share_id, version, created_at FROM uploads WHERE series_id = ? ORDER BY version DESC')
    .all(record.series_id as string);

  res.json({
    shareId: record.share_id,
    seriesId: record.series_id,
    version: record.version,
    createdAt: record.created_at,
    weeklyMode: Boolean(record.weekly_mode),
    fileName: record.file_name,
    fileUrl: `/uploads/${record.file_path}`,
    metrics: safeJson(record.metrics_json as string, {}),
    weekly: safeJson(record.weekly_json as string | null, null),
    rows,
    versions
  });
});

app.get('/api/series/:seriesId', (req, res) => {
  const versions = db
    .prepare('SELECT share_id, version, created_at, row_count FROM uploads WHERE series_id = ? ORDER BY version DESC')
    .all(req.params.seriesId);
  res.json({ versions });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DSM backend running on http://localhost:${PORT}`);
});

function getLatestVersion(seriesId: string): number {
  const row = db
    .prepare('SELECT MAX(version) AS version FROM uploads WHERE series_id = ?')
    .get(seriesId) as { version: number | null };
  return row.version ?? 0;
}

function getRowsByUploadId(uploadId: number): ParsedRow[] {
  const rows = db
    .prepare(`
      SELECT req_no, description, module, status, created_at, updated_at,
             creation_age_days, update_age_days, resolution_days, overdue, raw_json
      FROM requests
      WHERE upload_id = ?
      ORDER BY id ASC
    `)
    .all(uploadId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    reqNo: String(row.req_no || ''),
    description: String(row.description || ''),
    module: String(row.module || ''),
    status: String(row.status || ''),
    createdAt: (row.created_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
    creationAgeDays: Number(row.creation_age_days || 0),
    updateAgeDays: Number(row.update_age_days || 0),
    resolutionDays: Number(row.resolution_days || 0),
    overdue: Number(row.overdue || 0) === 1,
    raw: safeJson(row.raw_json as string, {}) as Record<string, unknown>
  }));
}

function safeJson(value: string | null, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeHeader(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickValue(row: Record<string, unknown>, aliases: string[]): unknown {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const found = keys.find((key) => normalizeHeader(key) === normalizedAlias);
    if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== '') {
      return row[found];
    }
  }
  return '';
}

function parseWorkbook(filePath: string, originalName: string): ParsedRow[] {
  const isCsv = originalName.toLowerCase().endsWith('.csv');
  const workbook = isCsv
    ? XLSX.read(fs.readFileSync(filePath, 'utf8'), { type: 'string', cellDates: true })
    : XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true });

  const rawRows: Record<string, unknown>[] = [];
  workbook.SheetNames.forEach((sheet) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheet], { defval: '' });
    rawRows.push(...rows);
  });

  const now = Date.now();

  return rawRows
    .map((raw) => {
      const reqNo = String(pickValue(raw, ['requestnumber', 'req no', 'reqno', 'request no', 'ticketid']) || '').trim();
      const description = String(pickValue(raw, ['description', 'requirements', 'requesttitle', 'details']) || '').trim();
      const module = String(pickValue(raw, ['module', 'module name', 'modulename']) || '').trim();
      const status = String(pickValue(raw, ['status']) || '').trim();

      const created = parseDate(pickValue(raw, ['createddatetime', 'createddate', 'created', 'creationdate']));
      const updated = parseDate(pickValue(raw, ['lastupdateddatetime', 'updateddatetime', 'updateddate', 'updated']));

      const creationAgeDays = created ? Math.max(0, Math.floor((now - created.getTime()) / 86400000)) : 0;
      const updateAgeDays = updated ? Math.max(0, Math.floor((now - updated.getTime()) / 86400000)) : 0;
      const resolutionDays = updated && created ? Number(((updated.getTime() - created.getTime()) / 86400000).toFixed(2)) : 0;

      const overdue = updateAgeDays > 14 || creationAgeDays > 21;

      return {
        reqNo,
        description,
        module,
        status,
        createdAt: created ? created.toISOString() : null,
        updatedAt: updated ? updated.toISOString() : null,
        creationAgeDays,
        updateAgeDays,
        resolutionDays,
        overdue,
        raw
      };
    })
    .filter((row) => row.reqNo || row.description || row.module || row.status);
}

function parseDate(value: unknown): Date | null {
  if (!value && value !== 0) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === 'number') {
    if (value > 10000) {
      const date = new Date((value - 25569) * 86400000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildMetrics(rows: ParsedRow[]): Metrics {
  const totalRequests = rows.length;
  const closedRequests = rows.filter((row) => /close|closed|closure/i.test(row.status)).length;
  const inProgress = rows.filter((row) => /progress|development|acceptance|review/i.test(row.status)).length;
  const openRequests = Math.max(totalRequests - closedRequests, 0);
  const overdueRequests = rows.filter((row) => row.overdue).length;

  const resolutionValues = rows.filter((row) => row.resolutionDays > 0).map((row) => row.resolutionDays);
  const averageResolutionTime = resolutionValues.length
    ? Number((resolutionValues.reduce((sum, value) => sum + value, 0) / resolutionValues.length).toFixed(2))
    : 0;

  const requestsByModule = mapCounts(rows.map((row) => row.module || 'Unspecified'));
  const requestsByStatus = mapCounts(rows.map((row) => row.status || 'Unspecified'));

  const monthlyMap = new Map<string, { month: string; created: number; closed: number }>();
  rows.forEach((row) => {
    const createdMonth = row.createdAt ? row.createdAt.slice(0, 7) : 'Unknown';
    const closedMonth = row.updatedAt ? row.updatedAt.slice(0, 7) : 'Unknown';

    if (!monthlyMap.has(createdMonth)) {
      monthlyMap.set(createdMonth, { month: createdMonth, created: 0, closed: 0 });
    }
    monthlyMap.get(createdMonth)!.created += 1;

    if (/close|closed|closure/i.test(row.status)) {
      if (!monthlyMap.has(closedMonth)) {
        monthlyMap.set(closedMonth, { month: closedMonth, created: 0, closed: 0 });
      }
      monthlyMap.get(closedMonth)!.closed += 1;
    }
  });

  const monthlyTrend = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  const ageingDistribution = [
    { bucket: '0-7 Days', value: rows.filter((row) => row.updateAgeDays <= 7).length },
    { bucket: '8-14 Days', value: rows.filter((row) => row.updateAgeDays > 7 && row.updateAgeDays <= 14).length },
    { bucket: '15-30 Days', value: rows.filter((row) => row.updateAgeDays > 14 && row.updateAgeDays <= 30).length },
    { bucket: '30+ Days', value: rows.filter((row) => row.updateAgeDays > 30).length }
  ];

  const breached = overdueRequests;
  const compliant = Math.max(totalRequests - breached, 0);
  const percent = totalRequests ? Number(((compliant / totalRequests) * 100).toFixed(1)) : 100;

  return {
    totalRequests,
    openRequests,
    inProgress,
    closedRequests,
    averageResolutionTime,
    overdueRequests,
    requestsByModule,
    requestsByStatus,
    monthlyTrend,
    ageingDistribution,
    slaCompliance: {
      compliant,
      breached,
      percent
    }
  };
}

function mapCounts(values: string[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  values.forEach((value) => {
    map.set(value, (map.get(value) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

function buildWeeklyDiff(previousRows: ParsedRow[], currentRows: ParsedRow[]): WeeklyDiff {
  const prevMap = new Map(previousRows.map((row) => [row.reqNo, row]));
  const currMap = new Map(currentRows.map((row) => [row.reqNo, row]));

  let newRequests = 0;
  let closedRequests = 0;
  let statusChanges = 0;
  let slaRisks = 0;
  let delayedRequests = 0;

  currentRows.forEach((row) => {
    const previous = prevMap.get(row.reqNo);
    if (!previous) {
      newRequests += 1;
    }
    if (previous && previous.status !== row.status) {
      statusChanges += 1;
    }
    if (/close|closed|closure/i.test(row.status) && (!previous || !/close|closed|closure/i.test(previous.status))) {
      closedRequests += 1;
    }
    if (row.overdue) {
      slaRisks += 1;
    }
    if (row.updateAgeDays > 20) {
      delayedRequests += 1;
    }
  });

  return {
    newRequests,
    closedRequests,
    statusChanges,
    slaRisks,
    delayedRequests
  };
}
