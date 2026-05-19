import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { auth } from '../utils/auth';
import './UniqueLeads.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4000';
const STORAGE_KEY = process.env.REACT_APP_STORAGE_KEY || 'app_auth';

const getAuthToken = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      return data?.token ?? null;
    }
  } catch (e) {
    console.error('Error getting token:', e);
  }
  return null;
};

const COLUMN_ALIASES = {
  dateTime: ['date with time', 'date & time', 'date and time', 'date_time', 'datetime', 'date'],
  batchCode: ['batch code', 'batchcode', 'batch'],
  phoneNumber: ['phone number', 'phone', 'phonenumber', 'mobile', 'contact'],
  sugarPoll: ['sugar poll', 'sugar_poll', 'sugarpoll'],
  email: ['email']
};

function normalizeHeader(header) {
  if (header == null) return '';
  return String(header).trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapHeaderToKey(header) {
  const n = normalizeHeader(header);
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => n.includes(a) || a.includes(n))) return key;
  }
  return null;
}

function parseCSV(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (current.trim()) lines.push(current);
      current = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else {
      current += c;
    }
  }
  if (current.trim()) lines.push(current);
  const rows = lines.map((line) => {
    const cells = [];
    let cell = '';
    let q = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === '"') {
        q = !q;
      } else if ((c === ',' || c === '\t') && !q) {
        cells.push(cell.trim());
        cell = '';
      } else {
        cell += c;
      }
    }
    cells.push(cell.trim());
    return cells;
  });
  return rows;
}

function parseExcelRows(rows, headers) {
  return rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      const key = mapHeaderToKey(h);
      if (key) obj[key] = row[i] != null ? String(row[i]).trim() : '';
    });
    return obj;
  });
}

function expandPhone(phone) {
  let str = String(phone || '').trim();
  if (/[eE]/.test(str)) {
    const num = Number(str);
    if (!isNaN(num) && isFinite(num)) str = num.toFixed(0);
  }
  return str;
}

function extractLast10(phone) {
  const digits = expandPhone(phone).replace(/[^0-9]/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export default function UniqueLeads() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [sourceType, setSourceType] = useState('paid');
  const [rows, setRows] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tableViewFilter, setTableViewFilter] = useState('all');
  const [dbLeads, setDbLeads] = useState([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [showDupModal, setShowDupModal] = useState(false);
  const [selectedDupIds, setSelectedDupIds] = useState(new Set());
  const [deletingDupIds, setDeletingDupIds] = useState(new Set());
  const [userIdSearch, setUserIdSearch] = useState('');
  const fileInputRef = useRef(null);

  const isDuplicatesView = tableViewFilter === 'duplicates';

  const redirectToLogin = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
    if (auth && typeof auth.logout === 'function') auth.logout();
    navigate('/login', { state: { from: '/unique-leads' }, replace: true });
  }, [navigate]);

  const authHeaders = useCallback(() => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // Load leads or duplicates based on filter
  useEffect(() => {
    if (tableViewFilter === 'last_import') {
      setDbLeads([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingDb(true);
      try {
        const headers = authHeaders();
        const url = tableViewFilter === 'duplicates'
          ? `${API_BASE}/api/unique-leads/duplicates`
          : `${API_BASE}/api/unique-leads/export?category=${tableViewFilter}`;
        const res = await fetch(url, { headers });
        if (res.status === 401) { redirectToLogin(); return; }
        if (!res.ok) throw new Error('Failed to load');
        let data = await res.json();
        data = data || [];
        if (tableViewFilter === 'duplicates') {
          data = data.map((row) => ({
            ...row,
            leadSourceType: `Uploaded: ${row.uploadedAs ?? ''} → Existing: ${row.existingSources ?? ''}`
          }));
        }
        if (!cancelled) {
          setDbLeads(data);
          if (tableViewFilter === 'duplicates') setSelectedDupIds(new Set());
        }
      } catch (e) {
        if (!cancelled) setDbLeads([]);
      } finally {
        if (!cancelled) setLoadingDb(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [tableViewFilter, authHeaders, redirectToLogin]);

  const reloadDuplicates = useCallback(async () => {
    if (tableViewFilter !== 'duplicates') return;
    setLoadingDb(true);
    try {
      const res = await fetch(`${API_BASE}/api/unique-leads/duplicates`, { headers: authHeaders() });
      if (res.status === 401) { redirectToLogin(); return; }
      if (!res.ok) throw new Error('Failed to load');
      let data = await res.json();
      data = (data || []).map((row) => ({
        ...row,
        leadSourceType: `Uploaded: ${row.uploadedAs ?? ''} → Existing: ${row.existingSources ?? ''}`
      }));
      setDbLeads(data);
      setSelectedDupIds(new Set());
    } catch (e) {
      setDbLeads([]);
    } finally {
      setLoadingDb(false);
    }
  }, [tableViewFilter, authHeaders, redirectToLogin]);

  const toggleDupSelection = (id) => {
    setSelectedDupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllDuplicates = () => {
    if (!isDuplicatesView || !dbLeads.length) return;
    if (selectedDupIds.size === dbLeads.length) {
      setSelectedDupIds(new Set());
    } else {
      setSelectedDupIds(new Set(dbLeads.map((r) => r.id).filter(Boolean)));
    }
  };

  const handleBulkDeleteDuplicates = async () => {
    if (selectedDupIds.size === 0) return;
    const ids = [...selectedDupIds];
    setDeletingDupIds((prev) => new Set([...prev, ...ids]));
    try {
      const res = await fetch(`${API_BASE}/api/unique-leads/duplicates/bulk`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids })
      });
      if (res.status === 401) { redirectToLogin(); return; }
      if (!res.ok) throw new Error('Bulk delete failed');
      await reloadDuplicates();
    } catch (e) {
      setError(e.message || 'Bulk delete failed');
    } finally {
      setDeletingDupIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleFileSelect = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    setImportResult(null);
    setRows([]);
    setFile(null);

    const ext = (f.name || '').toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.csv')) {
      setError('Please select an Excel (.xlsx) or CSV file.');
      return;
    }

    try {
      let parsedRows = [];
      if (ext.endsWith('.csv')) {
        const text = await f.text();
        const raw = parseCSV(text);
        if (raw.length < 2) {
          setError('File is empty or has no data rows.');
          return;
        }
        const headerRow = raw[0];
        const dataRows = raw.slice(1);
        const headers = headerRow.map((h) => (h != null ? String(h).trim() : ''));
        parsedRows = dataRows.map((row) => {
          const obj = {};
          headers.forEach((h, i) => {
            const key = mapHeaderToKey(h);
            if (key) obj[key] = (row[i] != null ? String(row[i]).trim() : '') || '';
          });
          return obj;
        });
      } else {
        const buf = await f.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buf);
        const sheet = workbook.worksheets[0];
        if (!sheet || sheet.rowCount < 2) {
          setError('Sheet is empty or has no data rows.');
          return;
        }
        const headerRow = [];
        sheet.getRow(1).eachCell((cell, colNumber) => {
          headerRow[colNumber - 1] = cell.value != null ? String(cell.value).trim() : '';
        });
        const dataRows = [];
        for (let r = 2; r <= sheet.rowCount; r++) {
          const row = sheet.getRow(r);
          const values = [];
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            values[colNumber - 1] = cell.value != null ? String(cell.value).trim() : '';
          });
          dataRows.push(values);
        }
        parsedRows = parseExcelRows(dataRows, headerRow);
      }

      const required = ['dateTime', 'batchCode', 'phoneNumber', 'sugarPoll', 'email'];
      const first = parsedRows[0] || {};
      const missing = required.filter((k) => first[k] === undefined || first[k] === '');
      if (missing.length === required.length) {
        setError('Could not find expected columns. Please use: Date with Time, Batch Code, Phone Number, Sugar Poll, Email.');
        return;
      }
      if (parsedRows.length > 50000) {
        setError('Maximum 50,000 rows allowed.');
        return;
      }

      setRows(parsedRows);
      setFile(f);
    } catch (err) {
      setError(err.message || 'Failed to read file.');
    }
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setLoading(true);
    setError('');
    setImportResult(null);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/unique-leads/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ sourceType, rows })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) { redirectToLogin(); return; }
        setError(data.error || 'Import failed');
        setLoading(false);
        return;
      }
      setImportResult(data);
      setTableViewFilter('last_import');
      if (data.duplicatesFound > 0) {
        setShowDupModal(true);
      }
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const downloadCategory = async (category, label) => {
    try {
      const res = await fetch(`${API_BASE}/api/unique-leads/export?category=${category}`, {
        headers: authHeaders()
      });
      if (!res.ok) {
        if (res.status === 401) { redirectToLogin(); return; }
        throw new Error('Export failed');
      }
      const data = await res.json();
      const csvHeaders = ['Date & Time', 'Batch Code', 'Phone Number', 'User ID', 'Sugar Poll', 'Email', 'Lead Source Type'];
      const csvRows = [
        csvHeaders.join(','),
        ...data.map((r) =>
          [
            r.dateTime ?? '',
            r.batchCode ?? '',
            r.phoneNumber ?? '',
            r.userId ?? '',
            (r.sugarPoll ?? '').replace(/"/g, '""'),
            (r.email ?? '').replace(/"/g, '""'),
            (r.leadSourceType ?? '').replace(/"/g, '""')
          ].map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(',')
        )
      ];
      const blob = new Blob([csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Unique_Leads_${label.replace(/\s/g, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Download failed');
    }
  };

  const downloadDuplicates = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/unique-leads/duplicates`, { headers: authHeaders() });
      if (!res.ok) {
        if (res.status === 401) { redirectToLogin(); return; }
        throw new Error('Export failed');
      }
      const data = await res.json();
      const csvHeaders = ['Date & Time', 'Batch Code', 'Phone Number', 'User ID', 'Sugar Poll', 'Repeat Leads', 'Email', 'Uploaded As', 'Existing Sources', 'Detected At'];
      const csvRows = [
        csvHeaders.join(','),
        ...data.map((r) =>
          [
            r.dateTime ?? '',
            r.batchCode ?? '',
            r.phoneNumber ?? '',
            r.userId ?? '',
            (r.sugarPoll ?? '').replace(/"/g, '""'),
            (r.repeatLeads ?? '').replace(/"/g, '""'),
            (r.email ?? '').replace(/"/g, '""'),
            r.uploadedAs ?? '',
            (r.existingSources ?? '').replace(/"/g, '""'),
            r.detectedAt ?? ''
          ].map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(',')
        )
      ];
      const blob = new Blob([csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Duplicate_Leads_Report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Download failed');
    }
  };

  const previewRows = importResult?.previewRows ?? rows.slice(0, 500);
  const displayRows = tableViewFilter === 'last_import' ? previewRows : dbLeads;
  const displayCount = tableViewFilter === 'last_import'
    ? (importResult?.imported ?? previewRows.length)
    : dbLeads.length;

  const getRowUserId = (row) =>
    (row.userId != null && String(row.userId).trim() !== '')
      ? String(row.userId).trim()
      : extractLast10(row.phoneNumber ?? row.phone ?? '');

  const userIdSearchTrimmed = userIdSearch.trim().toLowerCase();
  const filteredByUserId =
    userIdSearchTrimmed === ''
      ? displayRows
      : displayRows.filter((row) => {
          const uid = getRowUserId(row);
          return uid.toLowerCase().includes(userIdSearchTrimmed);
        });

  const FILTER_LABELS = {
    all: 'all imported',
    paid: 'Paid',
    youtube: 'YouTube',
    free: 'Free',
    direct_walk_in: 'Direct Walk-In',
    duplicates: 'Duplicate',
    last_import: 'last import'
  };

  const buildMeta = () => {
    if (tableViewFilter === 'last_import') {
      if (!importResult) return 'No data yet. Import a file to see leads.';
      let msg = `Imported ${importResult.imported} new lead(s).`;
      if (importResult.upgraded > 0)
        msg += ` ${importResult.upgraded} lead(s) upgraded.`;
      if (importResult.duplicatesFound > 0)
        msg += ` ${importResult.duplicatesFound} conflict(s) found.`;
      if (importResult.errors > 0)
        msg += ` ${importResult.errors} row(s) skipped (phone < 10 digits).`;
      return msg;
    }
    const base = loadingDb ? ' Loading…' : '';
    if (userIdSearchTrimmed) {
      return `Showing ${filteredByUserId.length} of ${displayCount} lead(s) matching User ID.${base}`;
    }
    if (tableViewFilter === 'all')
      return `Showing all imported leads (${displayCount} total).${base}`;
    if (tableViewFilter === 'duplicates')
      return `Showing leads with multiple sources (${displayCount} total).${base}`;
    return `Showing ${FILTER_LABELS[tableViewFilter] || tableViewFilter} lead(s) (${displayCount} total).${base}`;
  };

  const colSpan = isDuplicatesView ? 10 : 8;

  return (
    <div className="unique-leads-container">
      <div className="unique-leads-header">
        <h1 className="unique-leads-title">Unique Leads Extraction</h1>
        <p className="unique-leads-subtitle">
          Upload Excel or CSV, classify by source (Paid / YouTube / Free / Direct Walk-In), and download deduplicated lead files.
        </p>
      </div>

      {!file && (
        <div className="unique-leads-upload-zone">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFileSelect}
            className="unique-leads-file-input"
          />
          <button
            type="button"
            className="unique-leads-btn-select"
            onClick={() => fileInputRef.current?.click()}
          >
            Select Excel File
          </button>
          <p className="unique-leads-hint">Supports .xlsx and .csv (max 50,000 rows)</p>
        </div>
      )}

      {error && (
        <div className="unique-leads-alert unique-leads-alert-error" role="alert">
          {error}
        </div>
      )}

      {file && (
        <>
          <div className="unique-leads-source-section">
            <label className="unique-leads-source-label">Select Source Type:</label>
            <div className="unique-leads-source-cards">
              {[
                { value: 'paid', label: 'Paid' },
                { value: 'youtube', label: 'YouTube' },
                { value: 'free', label: 'Free' },
                { value: 'direct_walk_in', label: 'Direct Walk-In' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`unique-leads-source-card unique-leads-source-card--${opt.value}${sourceType === opt.value ? ' active' : ''}`}
                  onClick={() => setSourceType(opt.value)}
                >
                  <span className="source-card-checkbox">
                    {sourceType === opt.value && (
                      <svg viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  <span className="source-card-label">{opt.label}</span>
                </button>
              ))}
            </div>
            <div className="unique-leads-source-actions">
              <button
                type="button"
                className="unique-leads-btn-import"
                onClick={handleImport}
                disabled={loading}
              >
                {loading ? 'Importing…' : 'Import'}
              </button>
              <button
                type="button"
                className="unique-leads-btn-secondary"
                onClick={() => { setFile(null); setRows([]); setError(''); setImportResult(null); }}
              >
                Choose Another File
              </button>
            </div>
          </div>

          {file && !importResult && (
            <div className="unique-leads-preview-info">
              <p>{rows.length} row(s) ready. Select source type and click Import.</p>
            </div>
          )}
        </>
      )}

      <section className="unique-leads-table-section unique-leads-chart-card">
        <div className="unique-leads-card-body">
          <div className="unique-leads-table-header">
            <strong className="unique-leads-chart-title">
              <span className="unique-leads-chart-emoji" aria-hidden>📋</span>
              Imported Data Table Preview
            </strong>
            <div className="unique-leads-table-header-right">
              <small className="unique-leads-subtitle-text">
                Deduplicated leads by source (Paid / YouTube / Free / Direct Walk-In)
              </small>
              <div className="unique-leads-filter-chips">
                {[
                  { value: 'all', label: 'All Leads' },
                  { value: 'paid', label: 'Paid' },
                  { value: 'youtube', label: 'YouTube' },
                  { value: 'free', label: 'Free' },
                  { value: 'direct_walk_in', label: 'Walk-In' },
                  { value: 'duplicates', label: 'Duplicates' },
                  { value: 'last_import', label: 'Last Import' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`unique-leads-chip unique-leads-chip--${opt.value}${tableViewFilter === opt.value ? ' active' : ''}`}
                    onClick={() => setTableViewFilter(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="unique-leads-meta-row">
            <p className="unique-leads-meta">{buildMeta()}</p>
            <div className="unique-leads-userid-search-wrap">
              <label htmlFor="unique-leads-userid-search" className="unique-leads-search-label">
                Search by User ID
              </label>
              <input
                id="unique-leads-userid-search"
                type="text"
                placeholder="Search User ID…"
                value={userIdSearch}
                onChange={(e) => setUserIdSearch(e.target.value)}
                className="unique-leads-userid-search"
                aria-label="Search by User ID"
              />
            </div>
            {isDuplicatesView && dbLeads.length > 0 && (
              <button
                type="button"
                className="unique-leads-btn-delete-bulk"
                onClick={handleBulkDeleteDuplicates}
                disabled={selectedDupIds.size === 0 || deletingDupIds.size > 0}
              >
                {deletingDupIds.size > 0 ? 'Deleting…' : `Delete Selected${selectedDupIds.size > 0 ? ` (${selectedDupIds.size})` : ''}`}
              </button>
            )}
          </div>

          <div className="unique-leads-table-responsive">
            <table className="table table-hover align-middle unique-leads-table mb-0">
              <thead className="unique-leads-thead">
                <tr>
                  {isDuplicatesView && (
                    <th style={{ width: 44 }}>
                      <input
                        type="checkbox"
                        checked={dbLeads.length > 0 && selectedDupIds.size === dbLeads.length}
                        onChange={toggleSelectAllDuplicates}
                        title="Select all"
                        aria-label="Select all duplicate leads"
                      />
                    </th>
                  )}
                  <th>S.No</th>
                  <th>Date & Time</th>
                  <th>Batch Code</th>
                  <th>Phone Number</th>
                  <th>User ID</th>
                  <th>Sugar Poll</th>
                  {isDuplicatesView && <th>Repeat Leads</th>}
                  <th>Email</th>
                  <th>Lead Source Type</th>
                </tr>
              </thead>
              <tbody>
                {loadingDb ? (
                  <tr>
                    <td colSpan={colSpan} className="text-center py-4 text-secondary">
                      Loading…
                    </td>
                  </tr>
                ) : filteredByUserId.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="text-center py-4 text-secondary">
                      {userIdSearch.trim() ? 'No leads match the User ID search.' : 'No data to display. Import a file or select a category above.'}
                    </td>
                  </tr>
                ) : isDuplicatesView ? (
                  filteredByUserId.map((row, idx) => {
                    const userId = row.userId || extractLast10(row.phoneNumber ?? row.phone ?? '');
                    const id = row.id;
                    const isDeleting = id != null && deletingDupIds.has(id);
                    return (
                      <tr key={id ?? idx} className={id != null && selectedDupIds.has(id) ? 'unique-leads-row-selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={id != null && selectedDupIds.has(id)}
                            onChange={() => id != null && toggleDupSelection(id)}
                            disabled={isDeleting}
                            aria-label={`Select row ${idx + 1}`}
                          />
                        </td>
                        <td>{idx + 1}</td>
                        <td>{row.dateTime ?? row.date_time ?? ''}</td>
                        <td>{row.batchCode ?? row.batch_code ?? ''}</td>
                        <td>{expandPhone(row.phoneNumber ?? row.phone ?? '')}</td>
                        <td>{userId}</td>
                        <td>{row.sugarPoll ?? row.sugar_poll ?? ''}</td>
                        <td>{row.repeatLeads ?? ''}</td>
                        <td>{row.email ?? ''}</td>
                        <td>{row.leadSourceType ?? sourceType}</td>
                      </tr>
                    );
                  })
                ) : (
                  filteredByUserId.map((row, idx) => {
                    const userId = row.userId || extractLast10(row.phoneNumber ?? row.phone ?? '');
                    return (
                      <tr key={idx}>
                        <td>{idx + 1}</td>
                        <td>{row.dateTime ?? row.date_time ?? ''}</td>
                        <td>{row.batchCode ?? row.batch_code ?? ''}</td>
                        <td>{expandPhone(row.phoneNumber ?? row.phone ?? '')}</td>
                        <td>{userId}</td>
                        <td>{row.sugarPoll ?? row.sugar_poll ?? ''}</td>
                        <td>{row.email ?? ''}</td>
                        <td>{row.leadSourceType ?? sourceType}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="unique-leads-downloads unique-leads-chart-card">
        <div className="unique-leads-card-body">
          <strong className="unique-leads-chart-title">
            <span className="unique-leads-chart-emoji" aria-hidden>⬇️</span>
            Download Leads by Category
          </strong>
          <div className="unique-leads-download-btns">
            <button type="button" className="unique-leads-btn-download" onClick={() => downloadCategory('paid', 'Paid Leads')}>
              Download Paid Leads
            </button>
            <button type="button" className="unique-leads-btn-download" onClick={() => downloadCategory('youtube', 'YouTube Leads')}>
              Download YouTube Leads
            </button>
            <button type="button" className="unique-leads-btn-download" onClick={() => downloadCategory('free', 'Free Leads')}>
              Download Free Leads
            </button>
            <button type="button" className="unique-leads-btn-download" onClick={() => downloadCategory('direct_walk_in', 'Direct Walk-In Leads')}>
              Download Direct Walk-In Leads
            </button>
            <button type="button" className="unique-leads-btn-download unique-leads-btn-conflict" onClick={downloadDuplicates}>
              Download Duplicate Leads Report
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="unique-leads-btn-download" onClick={() => {
              const headers = ['S.No', 'Date & Time', 'Batch Code', 'Phone Number', 'User ID', 'Sugar Poll', 'Email'];
              const blob = new Blob([headers.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'Unique_Leads_Template.csv';
              a.click();
              URL.revokeObjectURL(url);
            }}>
              <i className="fas fa-file-download" style={{ marginRight: 6 }}></i>Download Template
            </button>
          </div>
        </div>
      </section>

      {importResult && importResult.errors > 0 && (
        <div className="unique-leads-alert unique-leads-alert-error" role="alert">
          <strong>{importResult.errors} row(s)</strong> were skipped because phone numbers had fewer than 10 digits.
        </div>
      )}

      {showDupModal && importResult && importResult.duplicatesFound > 0 && (
        <div className="unique-leads-modal-overlay" onClick={() => setShowDupModal(false)}>
          <div className="unique-leads-modal" onClick={(e) => e.stopPropagation()}>
            <div className="unique-leads-modal-header">
              <strong>Duplicate Leads Detected</strong>
            </div>
            <div className="unique-leads-modal-body">
              <p>
                <strong>{importResult.duplicatesFound}</strong> lead(s) already exist in a higher-priority source and were not imported.
              </p>
              <p>Do you want to download the duplicate conflict report?</p>
            </div>
            <div className="unique-leads-modal-actions">
              <button
                type="button"
                className="unique-leads-btn-download"
                onClick={() => { downloadDuplicates(); setShowDupModal(false); }}
              >
                Download Duplicate File
              </button>
              <button
                type="button"
                className="unique-leads-btn-secondary"
                onClick={() => setShowDupModal(false)}
              >
                Skip & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
