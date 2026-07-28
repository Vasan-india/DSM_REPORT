import {
  Alert,
  AppBar,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  FormControlLabel,
  Grid,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Skeleton,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TrainRoundedIcon from '@mui/icons-material/TrainRounded';
import ViewWeekRoundedIcon from '@mui/icons-material/ViewWeekRounded';
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import AnalyticsRoundedIcon from '@mui/icons-material/AnalyticsRounded';
import HourglassBottomRoundedIcon from '@mui/icons-material/HourglassBottomRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import TrackChangesRoundedIcon from '@mui/icons-material/TrackChangesRounded';
import AssignmentLateRoundedIcon from '@mui/icons-material/AssignmentLateRounded';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis
} from 'recharts';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

type RequestRow = {
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

type Weekly = {
  newRequests: number;
  closedRequests: number;
  statusChanges: number;
  slaRisks: number;
  delayedRequests: number;
};

type SharePayload = {
  shareId: string;
  seriesId: string;
  version: number;
  rows: RequestRow[];
  metrics: Metrics;
  weekly: Weekly | null;
};

const STATUS_LEGEND = [
  { short: 'NR', color: '#f6ad2f', title: 'New Request' },
  { short: 'SD', color: '#0d4f8b', title: 'Solution Development' },
  { short: 'UAT', color: '#13a35c', title: 'User Acceptance' },
  { short: 'PIR', color: '#6d7788', title: 'Post Implementation Review' },
  { short: 'RC', color: '#d8232a', title: 'Request Closure' }
];

const CHART_COLORS = ['#0d4f8b', '#d8232a', '#5f778d', '#13a35c', '#f6ad2f', '#adb7c4'];

const defaultMetrics: Metrics = {
  totalRequests: 0,
  openRequests: 0,
  inProgress: 0,
  closedRequests: 0,
  averageResolutionTime: 0,
  overdueRequests: 0,
  requestsByModule: [],
  requestsByStatus: [],
  monthlyTrend: [],
  ageingDistribution: [],
  slaCompliance: { compliant: 0, breached: 0, percent: 0 }
};

const columns = [
  { id: 'reqNo', label: 'Request No' },
  { id: 'description', label: 'Description' },
  { id: 'module', label: 'Module' },
  { id: 'status', label: 'Status' },
  { id: 'createdAt', label: 'Created' },
  { id: 'updatedAt', label: 'Updated' },
  { id: 'creationAgeDays', label: 'Creation Age' },
  { id: 'updateAgeDays', label: 'Update Age' },
  { id: 'resolutionDays', label: 'Resolution Days' }
];

function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/share/:shareId" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function DashboardPage() {
  const { shareId } = useParams();
  const navigate = useNavigate();

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(defaultMetrics);
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [seriesId, setSeriesId] = useState('');
  const [weeklyMode, setWeeklyMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generatedLink, setGeneratedLink] = useState('');
  const [darkMode, setDarkMode] = useState(localStorage.getItem('dsm-dark-mode') === '1');
  const [moduleFilter, setModuleFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    columns.reduce((acc, col) => ({ ...acc, [col.id]: true }), {})
  );
  const [notice, setNotice] = useState<{ level: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const savedFilters = localStorage.getItem('dsm-filters');
    const savedColumns = localStorage.getItem('dsm-columns');
    if (savedFilters) {
      const parsed = JSON.parse(savedFilters) as { modules: string[]; statuses: string[]; search: string };
      setModuleFilter(parsed.modules || []);
      setStatusFilter(parsed.statuses || []);
      setSearchText(parsed.search || '');
    }
    if (savedColumns) {
      setVisibleColumns(JSON.parse(savedColumns));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('dsm-dark-mode', darkMode ? '1' : '0');
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem(
      'dsm-filters',
      JSON.stringify({ modules: moduleFilter, statuses: statusFilter, search: searchText })
    );
  }, [moduleFilter, statusFilter, searchText]);

  useEffect(() => {
    localStorage.setItem('dsm-columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    if (!shareId) return;
    loadShare(shareId).catch(() => {
      setNotice({ level: 'error', text: 'Unable to load the requested share link.' });
    });
  }, [shareId]);

  const modules = useMemo(
    () => Array.from(new Set(rows.map((row) => row.module).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const statuses = useMemo(
    () => Array.from(new Set(rows.map((row) => row.status).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return rows.filter((row) => {
      const moduleMatch = !moduleFilter.length || moduleFilter.includes(row.module);
      const statusMatch = !statusFilter.length || statusFilter.includes(row.status);
      const searchMatch =
        !query ||
        [row.reqNo, row.description, row.module, row.status]
          .join(' ')
          .toLowerCase()
          .includes(query);
      return moduleMatch && statusMatch && searchMatch;
    });
  }, [rows, moduleFilter, searchText, statusFilter]);

  const filteredMetrics = useMemo(() => recomputeMetrics(filteredRows), [filteredRows]);

  const kpis = [
    {
      label: 'Total Requests',
      value: filteredMetrics.totalRequests,
      icon: <AnalyticsRoundedIcon color="primary" />,
      trend: `${trendFromMonthly(filteredMetrics.monthlyTrend)}%`
    },
    {
      label: 'Open Requests',
      value: filteredMetrics.openRequests,
      icon: <TrackChangesRoundedIcon sx={{ color: '#0d4f8b' }} />,
      trend: `${Math.round((filteredMetrics.openRequests / Math.max(filteredMetrics.totalRequests, 1)) * 100)}% open`
    },
    {
      label: 'In Progress',
      value: filteredMetrics.inProgress,
      icon: <HourglassBottomRoundedIcon sx={{ color: '#f6ad2f' }} />,
      trend: `${Math.round((filteredMetrics.inProgress / Math.max(filteredMetrics.totalRequests, 1)) * 100)}% flow`
    },
    {
      label: 'Closed Requests',
      value: filteredMetrics.closedRequests,
      icon: <CheckCircleRoundedIcon sx={{ color: '#13a35c' }} />,
      trend: `${filteredMetrics.slaCompliance.percent}% SLA`
    },
    {
      label: 'Avg Resolution Time',
      value: `${filteredMetrics.averageResolutionTime}d`,
      icon: <ViewWeekRoundedIcon sx={{ color: '#6d7788' }} />,
      trend: 'rolling'
    },
    {
      label: 'Overdue Requests',
      value: filteredMetrics.overdueRequests,
      icon: <AssignmentLateRoundedIcon sx={{ color: '#d8232a' }} />,
      trend: `${Math.round((filteredMetrics.overdueRequests / Math.max(filteredMetrics.totalRequests, 1)) * 100)}% risk`
    }
  ];

  async function loadShare(id: string) {
    setLoading(true);
    try {
      const { data } = await axios.get<SharePayload>(`${API_BASE}/api/share/${id}`);
      setRows(data.rows);
      setMetrics(data.metrics);
      setWeekly(data.weekly);
      setSeriesId(data.seriesId);
      setGeneratedLink(`${window.location.origin}/share/${data.shareId}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    if (seriesId.trim()) {
      formData.append('seriesId', seriesId.trim());
    }
    formData.append('weeklyMode', weeklyMode ? 'true' : 'false');

    setUploading(true);
    setUploadProgress(0);
    try {
      const { data } = await axios.post(`${API_BASE}/api/uploads`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          const total = event.total || 1;
          setUploadProgress(Math.round((event.loaded / total) * 100));
        }
      });

      const payload = data as SharePayload;
      setRows(payload.rows);
      setMetrics(payload.metrics);
      setWeekly(payload.weekly);
      setSeriesId(payload.seriesId);
      const link = `${window.location.origin}/share/${payload.shareId}`;
      setGeneratedLink(link);
      navigate(`/share/${payload.shareId}`);
      setNotice({ level: 'success', text: 'Upload processed successfully. Dashboard refreshed with a new share link.' });
    } catch {
      setNotice({ level: 'error', text: 'Upload failed. Please verify file format and data consistency.' });
    } finally {
      setUploading(false);
    }
  }

  function copyShareLink() {
    if (!generatedLink) return;
    navigator.clipboard.writeText(generatedLink).then(() => {
      setNotice({ level: 'success', text: 'Share link copied to clipboard.' });
    });
  }

  function exportFilteredCsv() {
    if (!filteredRows.length) {
      setNotice({ level: 'error', text: 'No filtered data available to export.' });
      return;
    }

    const keys = columns.filter((col) => visibleColumns[col.id]).map((col) => col.id);
    const headers = columns.filter((col) => visibleColumns[col.id]).map((col) => col.label);
    const body = filteredRows.map((row) => keys.map((key) => csvValue(String((row as Record<string, unknown>)[key] ?? ''))));
    const csv = [headers.join(','), ...body.map((line) => line.join(','))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dsm_filtered_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const visibleColumnDefs = columns.filter((col) => visibleColumns[col.id]);

  return (
    <Box className="page-shell">
      <AppBar position="static" elevation={0} className="topbar">
        <Container maxWidth="xl" sx={{ py: 1.2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} justifyContent="space-between" gap={2}>
            <Box>
              <Typography className="brand-title">SMRT DSM SERVICE REQUEST COMMAND CENTER</Typography>
              <Typography className="brand-sub">Transit-grade oversight for request lifecycle, SLA health, and weekly movement.</Typography>
            </Box>
            <Stack direction="row" spacing={1.2} alignItems="center" flexWrap="wrap" useFlexGap>
              <FormControlLabel
                control={<Switch checked={darkMode} onChange={(event) => setDarkMode(event.target.checked)} />}
                label={<Stack direction="row" spacing={0.5} alignItems="center"><DarkModeRoundedIcon fontSize="small" /><span>Dark</span></Stack>}
              />
              <Button variant="contained" color="inherit" startIcon={<DownloadRoundedIcon />} onClick={exportFilteredCsv}>
                Export Filtered
              </Button>
              <Button variant="outlined" color="inherit" startIcon={<SettingsRoundedIcon />} onClick={(e) => setColumnMenuAnchor(e.currentTarget)}>
                Columns
              </Button>
            </Stack>
          </Stack>
        </Container>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 2 }}>
        <Card className="hero-card" sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} justifyContent="space-between" gap={3}>
              <Box>
                <Typography variant="h5" fontWeight={700}>Transit Operations Dashboard</Typography>
                <Typography sx={{ opacity: 0.9, mt: 0.8 }}>
                  Upload weekly DSM reports, compare movements, monitor SLA risk, and publish secure public links.
                </Typography>
                <Box className="track-flow" sx={{ mt: 2 }}>
                  <span>New Request</span>
                  <span>Development</span>
                  <span>UAT</span>
                  <span>Review</span>
                  <span>Closure</span>
                  <div className="train-runner"><TrainRoundedIcon fontSize="small" /></div>
                </Box>
              </Box>

              <Stack spacing={1.2} sx={{ minWidth: { md: 360 } }}>
                <Button component="label" variant="contained" startIcon={uploading ? <CircularProgress size={16} /> : <UploadFileRoundedIcon />}>
                  Upload CSV / XLS / XLSX
                  <input
                    hidden
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        handleUpload(file);
                      }
                      event.currentTarget.value = '';
                    }}
                  />
                </Button>
                <TextField
                  size="small"
                  label="Series ID (optional, for version tracking)"
                  value={seriesId}
                  onChange={(event) => setSeriesId(event.target.value)}
                />
                <FormControlLabel
                  control={<Switch checked={weeklyMode} onChange={(event) => setWeeklyMode(event.target.checked)} />}
                  label="Weekly Update Mode"
                />
                {uploading && <LinearProgress variant="determinate" value={uploadProgress} />}
                {generatedLink && (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField fullWidth size="small" value={generatedLink} InputProps={{ readOnly: true }} />
                    <Button onClick={copyShareLink} variant="outlined" startIcon={<ContentCopyRoundedIcon />}>
                      Copy Share Link
                    </Button>
                  </Stack>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Box className="sticky-filter">
          <Stack direction={{ xs: 'column', lg: 'row' }} gap={1.2} alignItems={{ lg: 'center' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <FilterAltRoundedIcon fontSize="small" />
              <Typography fontWeight={600}>Filters</Typography>
            </Stack>

            <Autocomplete
              multiple
              size="small"
              options={modules}
              value={moduleFilter}
              onChange={(_event, value) => setModuleFilter(value)}
              sx={{ minWidth: { xs: '100%', md: 260 } }}
              renderInput={(params) => <TextField {...params} label="Module" placeholder="Search modules" />}
            />

            <Stack direction="row" spacing={0.6}>
              <Button size="small" onClick={() => setModuleFilter(modules)}>Select All</Button>
              <Button size="small" onClick={() => setModuleFilter([])}>Clear All</Button>
            </Stack>

            <Autocomplete
              multiple
              size="small"
              options={statuses}
              value={statusFilter}
              onChange={(_event, value) => setStatusFilter(value)}
              sx={{ minWidth: { xs: '100%', md: 280 } }}
              renderInput={(params) => <TextField {...params} label="Status" placeholder="Search statuses" />}
            />

            <Stack direction="row" spacing={0.6}>
              <Button size="small" onClick={() => setStatusFilter(statuses)}>Select All</Button>
              <Button size="small" onClick={() => setStatusFilter([])}>Clear All</Button>
            </Stack>

            <TextField
              size="small"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              label="Quick Search"
              sx={{ minWidth: { xs: '100%', lg: 250 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                )
              }}
            />

            <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.8 }}>
              Snapshot rows: {metrics.totalRequests}
            </Typography>
          </Stack>
        </Box>

        <Box className="legend-wrap" sx={{ mt: 1.2 }}>
          {STATUS_LEGEND.map((item) => (
            <Tooltip key={item.short} title={item.title}>
              <Chip
                size="small"
                label={`${item.short}  ${item.title}`}
                sx={{
                  fontSize: '0.66rem',
                  height: 23,
                  px: 0.3,
                  borderRadius: '999px',
                  backgroundColor: `${item.color}22`,
                  color: item.color,
                  border: `1px solid ${item.color}66`
                }}
              />
            </Tooltip>
          ))}
        </Box>

        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          {kpis.map((kpi) => (
            <Grid item xs={12} sm={6} lg={2} key={kpi.label}>
              <Card className="kpi-card">
                <CardContent sx={{ py: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" color="text.secondary">{kpi.label}</Typography>
                    {kpi.icon}
                  </Stack>
                  {loading ? <Skeleton width="70%" height={44} /> : <Typography variant="h5" fontWeight={700}>{kpi.value}</Typography>}
                  <Typography variant="caption" className="trend-pill">{kpi.trend}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {weekly && (
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1 }}>Weekly Executive Update</Typography>
              <Grid container spacing={1}>
                <Grid item xs={6} md={2}><Chip color="primary" label={`New Requests: ${weekly.newRequests}`} /></Grid>
                <Grid item xs={6} md={2}><Chip color="success" label={`Closed: ${weekly.closedRequests}`} /></Grid>
                <Grid item xs={6} md={2}><Chip color="warning" label={`Status Changes: ${weekly.statusChanges}`} /></Grid>
                <Grid item xs={6} md={2}><Chip color="error" label={`SLA Risks: ${weekly.slaRisks}`} /></Grid>
                <Grid item xs={6} md={2}><Chip color="default" label={`Delayed: ${weekly.delayedRequests}`} /></Grid>
              </Grid>
            </CardContent>
          </Card>
        )}

        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} lg={6}>
            <Card sx={{ height: 320 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700}>Requests by Module</Typography>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={filteredMetrics.requestsByModule}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" hide />
                    <YAxis />
                    <ChartTooltip />
                    <Bar dataKey="value" onClick={(entry) => entry?.name && setModuleFilter([String(entry.name)])}>
                      {filteredMetrics.requestsByModule.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} lg={6}>
            <Card sx={{ height: 320 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700}>Requests by Status</Typography>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={filteredMetrics.requestsByStatus}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={90}
                      onClick={(entry) => entry?.name && setStatusFilter([String(entry.name)])}
                    >
                      {filteredMetrics.requestsByStatus.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} lg={7}>
            <Card sx={{ height: 320 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700}>Monthly Trend</Typography>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={filteredMetrics.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <ChartTooltip />
                    <Line type="monotone" dataKey="created" stroke="#0d4f8b" strokeWidth={2.5} />
                    <Line type="monotone" dataKey="closed" stroke="#d8232a" strokeWidth={2.5} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} lg={5}>
            <Card sx={{ height: 320 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight={700}>SLA Compliance & Ageing</Typography>
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <Alert severity="success">Compliant: {filteredMetrics.slaCompliance.compliant}</Alert>
                  <Alert severity="error">Breached: {filteredMetrics.slaCompliance.breached}</Alert>
                  <Typography variant="body2">Compliance Rate: {filteredMetrics.slaCompliance.percent}%</Typography>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={filteredMetrics.ageingDistribution}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="bucket" />
                      <YAxis />
                      <ChartTooltip />
                      <Bar dataKey="value" fill="#5f778d" />
                    </BarChart>
                  </ResponsiveContainer>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        <Card sx={{ mt: 2 }}>
          <CardContent sx={{ p: 0 }}>
            <TableContainer sx={{ maxHeight: 520 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    {visibleColumnDefs.map((col) => (
                      <TableCell key={col.id} sx={{ fontWeight: 700 }}>{col.label}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading && Array.from({ length: 6 }).map((_, idx) => (
                    <TableRow key={`loading-${idx}`}>
                      {visibleColumnDefs.map((col) => (
                        <TableCell key={`${col.id}-${idx}`}><Skeleton /></TableCell>
                      ))}
                    </TableRow>
                  ))}

                  {!loading && filteredRows.map((row, index) => (
                    <TableRow hover key={`${row.reqNo}-${index}`}>
                      {visibleColumnDefs.map((col) => (
                        <TableCell key={`${col.id}-${row.reqNo}-${index}`}>{renderValue(row, col.id)}</TableCell>
                      ))}
                    </TableRow>
                  ))}

                  {!loading && !filteredRows.length && (
                    <TableRow>
                      <TableCell colSpan={visibleColumnDefs.length}>No records available for current filters.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Container>

      <Menu anchorEl={columnMenuAnchor} open={Boolean(columnMenuAnchor)} onClose={() => setColumnMenuAnchor(null)}>
        {columns.map((col) => (
          <MenuItem key={col.id} onClick={() => setVisibleColumns((prev) => ({ ...prev, [col.id]: !prev[col.id] }))}>
            <input type="checkbox" readOnly checked={visibleColumns[col.id]} style={{ marginRight: 8 }} />
            {col.label}
          </MenuItem>
        ))}
      </Menu>

      <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice(null)}>
        <Alert onClose={() => setNotice(null)} severity={notice?.level || 'success'} variant="filled">
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function renderValue(row: RequestRow, key: string) {
  if (key === 'status') {
    const isClosed = /close|closed|closure/i.test(row.status);
    return <Chip size="small" color={isClosed ? 'success' : 'primary'} label={row.status || 'Unknown'} />;
  }
  if (key === 'createdAt' || key === 'updatedAt') {
    const value = row[key as 'createdAt' | 'updatedAt'];
    return value ? new Date(value).toLocaleString() : '-';
  }
  if (key === 'creationAgeDays' || key === 'updateAgeDays') {
    const value = row[key as 'creationAgeDays' | 'updateAgeDays'];
    return `${value}d`;
  }
  if (key === 'resolutionDays') {
    return `${row.resolutionDays}d`;
  }
  return String((row as Record<string, unknown>)[key] ?? '-');
}

function csvValue(value: string) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function trendFromMonthly(monthly: { month: string; created: number; closed: number }[]) {
  if (monthly.length < 2) return 0;
  const latest = monthly[monthly.length - 1].created;
  const previous = monthly[monthly.length - 2].created || 1;
  return Math.round(((latest - previous) / previous) * 100);
}

function recomputeMetrics(rows: RequestRow[]): Metrics {
  const totalRequests = rows.length;
  const closedRequests = rows.filter((row) => /close|closed|closure/i.test(row.status)).length;
  const inProgress = rows.filter((row) => /progress|development|acceptance|review/i.test(row.status)).length;
  const openRequests = Math.max(totalRequests - closedRequests, 0);
  const overdueRequests = rows.filter((row) => row.overdue).length;
  const averageResolutionTime =
    rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + Number(row.resolutionDays || 0), 0) / rows.length).toFixed(2))
      : 0;

  const requestsByModule = countBy(rows.map((row) => row.module || 'Unspecified'));
  const requestsByStatus = countBy(rows.map((row) => row.status || 'Unspecified'));

  const monthlyMap = new Map<string, { month: string; created: number; closed: number }>();
  rows.forEach((row) => {
    const month = row.createdAt ? row.createdAt.slice(0, 7) : 'Unknown';
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, { month, created: 0, closed: 0 });
    }
    monthlyMap.get(month)!.created += 1;

    if (/close|closed|closure/i.test(row.status)) {
      monthlyMap.get(month)!.closed += 1;
    }
  });

  const ageingDistribution = [
    { bucket: '0-7 Days', value: rows.filter((row) => row.updateAgeDays <= 7).length },
    { bucket: '8-14 Days', value: rows.filter((row) => row.updateAgeDays > 7 && row.updateAgeDays <= 14).length },
    { bucket: '15-30 Days', value: rows.filter((row) => row.updateAgeDays > 14 && row.updateAgeDays <= 30).length },
    { bucket: '30+ Days', value: rows.filter((row) => row.updateAgeDays > 30).length }
  ];

  const compliant = Math.max(totalRequests - overdueRequests, 0);
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
    monthlyTrend: Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    ageingDistribution,
    slaCompliance: {
      compliant,
      breached: overdueRequests,
      percent
    }
  };
}

function countBy(items: string[]) {
  const map = new Map<string, number>();
  items.forEach((item) => {
    map.set(item, (map.get(item) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
}

export default App;
