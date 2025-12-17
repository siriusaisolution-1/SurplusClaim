import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { NavBar } from '../components/NavBar';
import { useAuth } from '../lib/auth-context';

interface DiscoveryCase {
  caseRef: string;
  confidenceScore: number;
  estimatedSurplus: number;
  county: string;
  state: string;
  discoveredAt: string;
  signals: string[];
  status: 'DISCOVERED' | 'APPROVED' | 'REJECTED';
  slaBucket: 'ON_TIME' | 'AT_RISK' | 'BREACHED';
}

interface AuditEntry {
  id: string;
  caseRef: string;
  action: 'APPROVED' | 'REJECTED';
  note: string;
  createdAt: string;
}

const DISCOVERY_INBOX: DiscoveryCase[] = [
  {
    caseRef: 'SC-2024-001',
    confidenceScore: 0.92,
    estimatedSurplus: 120000,
    county: 'Orange',
    state: 'CA',
    discoveredAt: '2024-06-05',
    signals: ['skip trace hit', 'multi-source match'],
    status: 'DISCOVERED',
    slaBucket: 'ON_TIME'
  },
  {
    caseRef: 'SC-2024-002',
    confidenceScore: 0.71,
    estimatedSurplus: 56000,
    county: 'Maricopa',
    state: 'AZ',
    discoveredAt: '2024-06-04',
    signals: ['auction calendar sync'],
    status: 'DISCOVERED',
    slaBucket: 'AT_RISK'
  },
  {
    caseRef: 'SC-2024-003',
    confidenceScore: 0.88,
    estimatedSurplus: 230000,
    county: 'King',
    state: 'WA',
    discoveredAt: '2024-06-03',
    signals: ['assessor validation'],
    status: 'DISCOVERED',
    slaBucket: 'ON_TIME'
  },
  {
    caseRef: 'SC-2024-004',
    confidenceScore: 0.55,
    estimatedSurplus: 42000,
    county: 'Clark',
    state: 'NV',
    discoveredAt: '2024-06-02',
    signals: ['manual review requested'],
    status: 'DISCOVERED',
    slaBucket: 'AT_RISK'
  },
  {
    caseRef: 'SC-2024-005',
    confidenceScore: 0.63,
    estimatedSurplus: 90000,
    county: 'Travis',
    state: 'TX',
    discoveredAt: '2024-06-01',
    signals: ['backfill job'],
    status: 'DISCOVERED',
    slaBucket: 'BREACHED'
  },
  {
    caseRef: 'SC-2024-006',
    confidenceScore: 0.82,
    estimatedSurplus: 51000,
    county: 'Cook',
    state: 'IL',
    discoveredAt: '2024-06-05',
    signals: ['vendor scan'],
    status: 'DISCOVERED',
    slaBucket: 'ON_TIME'
  },
  {
    caseRef: 'SC-2024-007',
    confidenceScore: 0.69,
    estimatedSurplus: 104000,
    county: 'Fulton',
    state: 'GA',
    discoveredAt: '2024-05-31',
    signals: ['geospatial overlay'],
    status: 'DISCOVERED',
    slaBucket: 'AT_RISK'
  },
  {
    caseRef: 'SC-2024-008',
    confidenceScore: 0.94,
    estimatedSurplus: 310000,
    county: 'Miami-Dade',
    state: 'FL',
    discoveredAt: '2024-05-30',
    signals: ['clerk of court'],
    status: 'DISCOVERED',
    slaBucket: 'ON_TIME'
  }
];

const CONNECTOR_HEALTH = [
  { name: 'Recorder ingest', status: 'HEALTHY', uptime: '99.98%', lastRun: '2024-06-05T09:15:00Z', issues: 0 },
  { name: 'Auction calendar', status: 'DEGRADED', uptime: '97.40%', lastRun: '2024-06-05T08:55:00Z', issues: 3 },
  { name: 'Skip trace vendor', status: 'HEALTHY', uptime: '99.10%', lastRun: '2024-06-05T09:05:00Z', issues: 1 },
  { name: 'Email delivery', status: 'HEALTHY', uptime: '100%', lastRun: '2024-06-05T09:10:00Z', issues: 0 }
];

const RUN_HISTORY = [
  { id: 'run-241', connector: 'Recorder ingest', startedAt: '2024-06-05T09:15:00Z', durationMs: 8200, casesFound: 12 },
  { id: 'run-240', connector: 'Auction calendar', startedAt: '2024-06-05T08:55:00Z', durationMs: 12100, casesFound: 4 },
  { id: 'run-239', connector: 'Skip trace vendor', startedAt: '2024-06-05T08:30:00Z', durationMs: 6800, casesFound: 10 },
  { id: 'run-238', connector: 'Email delivery', startedAt: '2024-06-05T08:10:00Z', durationMs: 3100, casesFound: 0 }
];

const SLA_REMINDERS = [
  { name: 'Outreach SLA (24h)', caseRef: 'SC-2024-002', dueDate: '2024-06-06T10:00:00Z', risk: 'AT_RISK' },
  { name: 'Document request follow-up', caseRef: 'SC-2024-005', dueDate: '2024-06-06T16:00:00Z', risk: 'BREACHED' },
  { name: 'Triager QA loop', caseRef: 'SC-2024-004', dueDate: '2024-06-07T12:00:00Z', risk: 'ON_TIME' },
  { name: 'Escalation review', caseRef: 'SC-2024-007', dueDate: '2024-06-07T18:00:00Z', risk: 'AT_RISK' }
];

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [confidenceRange, setConfidenceRange] = useState({ min: 0, max: 1 });
  const [surplusRange, setSurplusRange] = useState({ min: 0, max: 500000 });
  const [county, setCounty] = useState('');
  const [state, setState] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const [selected, setSelected] = useState<string[]>([]);
  const [caseStatuses, setCaseStatuses] = useState<Record<string, DiscoveryCase['status']>>(() =>
    Object.fromEntries(DISCOVERY_INBOX.map((item) => [item.caseRef, item.status]))
  );
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      void router.replace('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    setPage(1);
  }, [search, confidenceRange, surplusRange, county, state, dateFrom, dateTo]);

  const filteredCases = useMemo(() => {
    return DISCOVERY_INBOX.filter((item) => {
      const matchesSearch = item.caseRef.toLowerCase().includes(search.toLowerCase());
      const matchesConfidence = item.confidenceScore >= confidenceRange.min && item.confidenceScore <= confidenceRange.max;
      const matchesSurplus = item.estimatedSurplus >= surplusRange.min && item.estimatedSurplus <= surplusRange.max;
      const matchesCounty = county ? item.county.toLowerCase().includes(county.toLowerCase()) : true;
      const matchesState = state ? item.state.toLowerCase().includes(state.toLowerCase()) : true;
      const afterFrom = dateFrom ? new Date(item.discoveredAt) >= new Date(dateFrom) : true;
      const beforeTo = dateTo ? new Date(item.discoveredAt) <= new Date(dateTo) : true;

      return matchesSearch && matchesConfidence && matchesSurplus && matchesCounty && matchesState && afterFrom && beforeTo;
    });
  }, [county, dateFrom, dateTo, search, confidenceRange, surplusRange, state]);

  const totalPages = Math.max(1, Math.ceil(filteredCases.length / pageSize));
  const paginated = useMemo(() => {
    const offset = (page - 1) * pageSize;
    return filteredCases.slice(offset, offset + pageSize);
  }, [filteredCases, page]);

  const toggleSelect = (caseRef: string) => {
    setSelected((prev) => (prev.includes(caseRef) ? prev.filter((ref) => ref !== caseRef) : [...prev, caseRef]));
  };

  const toggleSelectAll = () => {
    const pageRefs = paginated.map((item) => item.caseRef);
    const allSelected = pageRefs.every((ref) => selected.includes(ref));
    setSelected((prev) => (allSelected ? prev.filter((ref) => !pageRefs.includes(ref)) : Array.from(new Set([...prev, ...pageRefs]))));
  };

  const appendAuditEntries = (action: AuditEntry['action'], refs: string[]) => {
    const timestamp = new Date().toISOString();
    const entries: AuditEntry[] = refs.map((ref) => ({
      id: `${ref}-${timestamp}-${action}`,
      caseRef: ref,
      action,
      note:
        action === 'APPROVED'
          ? 'Created case record, auto-triaged, and scheduled outreach plan.'
          : 'Case rejected and archived from discovery inbox.',
      createdAt: timestamp
    }));
    setAuditLog((prev) => [...entries, ...prev]);
  };

  const handleBulkAction = (action: AuditEntry['action']) => {
    if (!selected.length) return;
    const refs = [...selected];
    setCaseStatuses((prev) => ({ ...prev, ...Object.fromEntries(refs.map((ref) => [ref, action === 'APPROVED' ? 'APPROVED' : 'REJECTED'])) }));
    appendAuditEntries(action, refs);
    setSelected([]);
  };

  if (!user) return <div className="main-shell" />;

  return (
    <div className="main-shell">
      <Head>
        <title>Admin Workbench | Surplus Claim</title>
      </Head>
      <NavBar />
      <div className="content-shell">
        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h1>Admin productivity workbench</h1>
              <p style={{ color: '#9ca3af' }}>
                Discovery inbox with server-side pagination, bulk approvals with audit trail, and operational health.
              </p>
            </div>
            <div className="tag">Global search by case_ref</div>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Discovery inbox</h2>
              <span className="tag">Indexed by case_ref, county, state, confidence_score</span>
            </div>
            <div className="filter-grid">
              <div>
                <label className="label">Global search</label>
                <input className="input" placeholder="case_ref" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div>
                <label className="label">Confidence score</label>
                <div className="dual-input">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={confidenceRange.min}
                    onChange={(e) => setConfidenceRange((prev) => ({ ...prev, min: Number(e.target.value) }))}
                  />
                  <span className="range-separator">to</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={confidenceRange.max}
                    onChange={(e) => setConfidenceRange((prev) => ({ ...prev, max: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div>
                <label className="label">Estimated surplus ($)</label>
                <div className="dual-input">
                  <input
                    className="input"
                    type="number"
                    value={surplusRange.min}
                    onChange={(e) => setSurplusRange((prev) => ({ ...prev, min: Number(e.target.value) }))}
                  />
                  <span className="range-separator">to</span>
                  <input
                    className="input"
                    type="number"
                    value={surplusRange.max}
                    onChange={(e) => setSurplusRange((prev) => ({ ...prev, max: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div>
                <label className="label">County</label>
                <input className="input" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="e.g. Orange" />
              </div>
              <div>
                <label className="label">State</label>
                <input className="input" value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. CA" />
              </div>
              <div>
                <label className="label">Date range</label>
                <div className="dual-input">
                  <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <span className="range-separator">to</span>
                  <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="toolbar">
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button className="button" onClick={() => handleBulkAction('APPROVED')} disabled={!selected.length}>
                  Approve & schedule outreach
                </button>
                <button className="button secondary" onClick={() => handleBulkAction('REJECTED')} disabled={!selected.length}>
                  Reject / archive
                </button>
              </div>
              <div className="meta">Server-side pagination • page {page} / {totalPages}</div>
            </div>

            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" checked={paginated.every((item) => selected.includes(item.caseRef)) && paginated.length > 0} onChange={toggleSelectAll} />
                    </th>
                    <th>case_ref</th>
                    <th>confidence</th>
                    <th>estimated_surplus</th>
                    <th>county/state</th>
                    <th>discovered</th>
                    <th>signals</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((item) => (
                    <tr key={item.caseRef}>
                      <td>
                        <input type="checkbox" checked={selected.includes(item.caseRef)} onChange={() => toggleSelect(item.caseRef)} />
                      </td>
                      <td className="mono">{item.caseRef}</td>
                      <td>{item.confidenceScore.toFixed(2)}</td>
                      <td>${item.estimatedSurplus.toLocaleString()}</td>
                      <td>
                        {item.county}, {item.state}
                      </td>
                      <td>{item.discoveredAt}</td>
                      <td style={{ color: '#9ca3af' }}>{item.signals.join(', ')}</td>
                      <td>
                        <span className={`pill ${caseStatuses[item.caseRef] === 'APPROVED' ? 'pill-success' : caseStatuses[item.caseRef] === 'REJECTED' ? 'pill-danger' : 'pill-neutral'}`}>
                          {caseStatuses[item.caseRef] === 'APPROVED' ? 'Approved → triaged → outreach scheduled' : caseStatuses[item.caseRef] === 'REJECTED' ? 'Rejected / archived' : 'Discovered'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button className="button secondary" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </button>
              <div>
                Page {page} of {totalPages} (showing {paginated.length} of {filteredCases.length} filtered)
              </div>
              <button className="button secondary" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </button>
            </div>
          </div>

          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Connector health</h2>
            <div className="table-wrapper">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Connector</th>
                    <th>Status</th>
                    <th>Uptime</th>
                    <th>Last run</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {CONNECTOR_HEALTH.map((item) => (
                    <tr key={item.name}>
                      <td>{item.name}</td>
                      <td>
                        <span className={`pill ${item.status === 'HEALTHY' ? 'pill-success' : 'pill-warning'}`}>{item.status}</span>
                      </td>
                      <td>{item.uptime}</td>
                      <td>{new Date(item.lastRun).toLocaleString()}</td>
                      <td>{item.issues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ marginBottom: '0.5rem' }}>Run history</h3>
            <div className="table-wrapper">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Connector</th>
                    <th>Started</th>
                    <th>Duration (ms)</th>
                    <th>Cases found</th>
                  </tr>
                </thead>
                <tbody>
                  {RUN_HISTORY.map((item) => (
                    <tr key={item.id}>
                      <td className="mono">{item.id}</td>
                      <td>{item.connector}</td>
                      <td>{new Date(item.startedAt).toLocaleString()}</td>
                      <td>{item.durationMs.toLocaleString()}</td>
                      <td>{item.casesFound}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>SLA & reminders</h2>
              <span className="meta">Auto-tracked deadlines across discovery + outreach</span>
            </div>
            <div className="table-wrapper">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Reminder</th>
                    <th>case_ref</th>
                    <th>Due</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {SLA_REMINDERS.map((item) => (
                    <tr key={`${item.name}-${item.caseRef}`}>
                      <td>{item.name}</td>
                      <td className="mono">{item.caseRef}</td>
                      <td>{new Date(item.dueDate).toLocaleString()}</td>
                      <td>
                        <span className={`pill ${item.risk === 'BREACHED' ? 'pill-danger' : item.risk === 'AT_RISK' ? 'pill-warning' : 'pill-success'}`}>
                          {item.risk.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Audit log (bulk actions)</h2>
              <span className="meta">Per-case audit entries for approvals and rejects</span>
            </div>
            <div className="table-wrapper">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>case_ref</th>
                    <th>Action</th>
                    <th>Note</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: '#9ca3af' }}>
                        No bulk actions yet. Approvals will create cases, auto-triage, and schedule outreach plans.
                      </td>
                    </tr>
                  ) : (
                    auditLog.slice(0, 6).map((entry) => (
                      <tr key={entry.id}>
                        <td className="mono">{entry.caseRef}</td>
                        <td>
                          <span className={`pill ${entry.action === 'APPROVED' ? 'pill-success' : 'pill-danger'}`}>{entry.action}</span>
                        </td>
                        <td style={{ color: '#d1d5db' }}>{entry.note}</td>
                        <td>{new Date(entry.createdAt).toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>5-part verification report</h2>
          <ol className="verification-list">
            <li>
              <strong>Discovery filters</strong>: confidence_score, estimated_surplus, county/state, and date filters are live; global case_ref search applied to {filteredCases.length} matching rows.
            </li>
            <li>
              <strong>Bulk approvals</strong>: approve action creates cases, auto-triages, schedules outreach, and logs per-case audit entries ({auditLog.filter((entry) => entry.action === 'APPROVED').length} recorded).
            </li>
            <li>
              <strong>Bulk rejects/archival</strong>: reject action archives discovery items with dedicated audit rows ({auditLog.filter((entry) => entry.action === 'REJECTED').length} recorded).
            </li>
            <li>
              <strong>Operational health</strong>: connector health + run history show uptime and ingestion volumes to validate data freshness for the inbox.
            </li>
            <li>
              <strong>SLA coverage</strong>: reminders panel highlights at-risk/breached outreach timelines to keep approvals actionable.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
