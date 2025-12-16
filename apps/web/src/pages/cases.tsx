import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

import { NavBar } from '../components/NavBar';
import { useAuth } from '../lib/auth-context';
import { API_BASE_URL } from '../lib/api';

const CASE_STATUSES = [
  'DISCOVERED',
  'TRIAGED',
  'CLIENT_CONTACTED',
  'CONSENT_SIGNED',
  'DOCUMENT_COLLECTION',
  'PACKAGE_READY',
  'SUBMITTED',
  'PAYOUT_CONFIRMED',
  'CLOSED',
  'ESCALATED',
  'ON_HOLD'
] as const;

type CaseStatus = (typeof CASE_STATUSES)[number];

const TIER_LABELS: Record<string, string> = {
  LOW: 'Tier A (simple)',
  MEDIUM: 'Tier B (intermediate)',
  HIGH: 'Tier C (escalation)',
  ENTERPRISE: 'Tier C (escalation)',
  TIER_A: 'Tier A (simple)',
  TIER_B: 'Tier B (intermediate)',
  TIER_C: 'Tier C (escalation)'
};

interface CaseSummary {
  id: string;
  caseRef: string;
  status: CaseStatus;
  tierSuggested: string;
  tierConfirmed?: string | null;
  assignedReviewer: { id: string; email: string } | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface CaseTimelineEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface AuditLogEntrySnippet {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface CaseDetailResponse {
  case: {
    id: string;
    tenantId: string;
    caseRef: string;
    status: CaseStatus;
    tierSuggested: string;
    tierConfirmed?: string | null;
    reviewer: { id: string; email: string } | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  };
  timeline: CaseTimelineEvent[];
  auditTrail: AuditLogEntrySnippet[];
  allowedTransitions: CaseStatus[];
}

interface JurisdictionSummary {
  state: string;
  county_code: string;
  county_name: string;
  enabled: boolean;
  feature_flags: { enabled: boolean; notes?: string };
}

interface JurisdictionRule extends JurisdictionSummary {
  required_documents: {
    id: string;
    title: string;
    description?: string;
    required: boolean;
    conditions?: string;
  }[];
  forms: { id: string; name: string; description?: string; url: string }[];
  procedural: {
    submission_channels: string[];
    deadlines: { name: string; timeline: string; notes?: string }[];
    addresses: {
      name: string;
      attention?: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postal_code: string;
    }[];
  };
  allowed_email_templates: { id: string; name: string; description?: string }[];
  fee_schedule: { min_fee_cents?: number; max_fee_cents?: number };
}

interface ChecklistItem {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  conditions?: string;
  type: 'document' | 'form';
  jurisdiction: { state: string; county_code: string; county_name: string };
}

const formatTierLabel = (tier?: string | null) => {
  if (!tier) return 'Unassigned';
  return TIER_LABELS[tier] ?? tier;
};

export default function CasesPage() {
  const { user, loading, accessToken } = useAuth();
  const router = useRouter();
  const [caseList, setCaseList] = useState<CaseSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [filters, setFilters] = useState<{ status: string; search: string }>({ status: '', search: '' });
  const [selectedCase, setSelectedCase] = useState<CaseDetailResponse | null>(null);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<CaseStatus | ''>('');
  const [transitionReason, setTransitionReason] = useState('');
  const [jurisdictions, setJurisdictions] = useState<JurisdictionSummary[]>([]);
  const [ruleDetails, setRuleDetails] = useState<JurisdictionRule | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      void router.replace('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !accessToken) return;
    void fetchJurisdictions();
  }, [user, accessToken]);

  useEffect(() => {
    if (!user || !accessToken) return;
    void fetchCases(page);
  }, [user, accessToken, page, filters.status, filters.search]);

  useEffect(() => {
    if (caseList.length > 0 && !selectedRef) {
      void fetchCaseDetail(caseList[0].caseRef);
    }
  }, [caseList, selectedRef]);

  useEffect(() => {
    if (!selectedCase || !accessToken) return;
    const jurisdiction = deriveJurisdiction(selectedCase) ?? jurisdictions[0];
    if (!jurisdiction) return;

    void loadRulesForCase(jurisdiction, selectedCase.case.caseRef);
  }, [selectedCase, jurisdictions, accessToken]);

  const fetchJurisdictions = async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${API_BASE_URL}/rules/jurisdictions`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load jurisdictions');
      }

      const payload = await response.json();
      setJurisdictions(payload.jurisdictions ?? []);
    } catch (err: any) {
      console.error(err);
      setRulesError(err.message ?? 'Unable to load jurisdictions');
    }
  };

  const fetchCases = async (targetPage: number) => {
    setLoadingList(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('page', targetPage.toString());
    params.set('pageSize', pageSize.toString());
    if (filters.status) params.set('status', filters.status);
    if (filters.search) params.set('search', filters.search);

    try {
      const response = await fetch(`${API_BASE_URL}/cases?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load cases');
      }

      const payload = await response.json();
      setCaseList(payload.cases);
      setTotal(payload.total);
    } catch (err: any) {
      setError(err.message ?? 'Unable to load cases');
    } finally {
      setLoadingList(false);
    }
  };

  const fetchCaseDetail = async (caseRef: string) => {
    if (!accessToken) return;
    setLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${caseRef}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Unable to load case detail');
      }

      const payload: CaseDetailResponse = await response.json();
      setSelectedCase(payload);
      setSelectedRef(payload.case.caseRef);
      setTransitionTarget('');
      setTransitionReason('');
    } catch (err: any) {
      setError(err.message ?? 'Unable to load case detail');
    } finally {
      setLoadingDetail(false);
    }
  };

  const deriveJurisdiction = (payload: CaseDetailResponse): JurisdictionSummary | null => {
    const metadata = payload.case.metadata as any;
    const jurisdiction = metadata?.jurisdiction as
      | { state?: string; county_code?: string; county_name?: string }
      | undefined;

    if (jurisdiction?.state && jurisdiction?.county_code) {
      const fallbackCountyName =
        jurisdiction.county_name ||
        jurisdictions.find(
          (item) =>
            item.state.toUpperCase() === jurisdiction.state.toUpperCase() &&
            item.county_code.toUpperCase() === jurisdiction.county_code.toUpperCase()
        )?.county_name;

      return {
        state: jurisdiction.state,
        county_code: jurisdiction.county_code,
        county_name: fallbackCountyName ?? jurisdiction.county_code,
        enabled: true,
        feature_flags: { enabled: true, notes: 'Derived from case metadata' }
      };
    }

    return null;
  };

  const loadRulesForCase = async (jurisdiction: JurisdictionSummary, caseRef: string) => {
    if (!accessToken) return;
    setLoadingRules(true);
    setRulesError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/rules/${jurisdiction.state}/${jurisdiction.county_code}?case_ref=${caseRef}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Unable to load rules');
      }

      const payload = await response.json();
      setRuleDetails(payload.rule ?? null);
      setChecklistItems(payload.checklist?.items ?? []);
    } catch (err: any) {
      setRulesError(err.message ?? 'Unable to load jurisdiction rules');
      setRuleDetails(null);
      setChecklistItems([]);
    } finally {
      setLoadingRules(false);
    }
  };

  const handleTransition = async () => {
    if (!selectedCase || !transitionTarget || !accessToken) return;
    setLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${selectedCase.case.caseRef}/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ toState: transitionTarget, reason: transitionReason || undefined })
      });

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.message ?? 'Transition failed');
      }

      await fetchCaseDetail(selectedCase.case.caseRef);
      void fetchCases(page);
    } catch (err: any) {
      setError(err.message ?? 'Transition failed');
    } finally {
      setLoadingDetail(false);
    }
  };

  const formattedCaseList = useMemo(() => caseList, [caseList]);

  if (!user) return <div className="main-shell" />;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="main-shell">
      <Head>
        <title>Cases | Surplus Claim</title>
      </Head>
      <NavBar />
      <div className="content-shell">
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>Tenant Cases</h1>
              <p style={{ color: '#9ca3af' }}>
                Lifecycle-managed cases for tenant <strong>{user.tenantId}</strong>.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select
                className="input"
                value={filters.status}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, status: e.target.value }));
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {CASE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Search case ref"
                value={filters.search}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, search: e.target.value }));
                  setPage(1);
                }}
              />
              <button className="button" onClick={() => fetchCases(1)} disabled={loadingList}>
                Refresh
              </button>
            </div>
          </div>
          {error && <p style={{ color: '#f87171' }}>{error}</p>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1rem' }}>
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Cases</h2>
              <span style={{ color: '#9ca3af' }}>
                Page {page} / {totalPages}
              </span>
            </div>
            {loadingList ? (
              <p>Loading cases...</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#9ca3af' }}>
                    <th style={{ paddingBottom: '0.5rem' }}>Case Ref</th>
                    <th>Status</th>
                    <th>Tier</th>
                    <th>Reviewer</th>
                  </tr>
                </thead>
                <tbody>
                  {formattedCaseList.map((item) => (
                    <tr
                      key={item.id}
                      style={{
                        cursor: 'pointer',
                        background: selectedRef === item.caseRef ? '#0f172a' : 'transparent'
                      }}
                      onClick={() => fetchCaseDetail(item.caseRef)}
                    >
                      <td style={{ padding: '0.5rem 0' }}>
                        <strong>{item.caseRef}</strong>
                        <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                          Created {new Date(item.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td>
                        <span className="tag">{item.status}</span>
                      </td>
                      <td>{formatTierLabel(item.tierConfirmed ?? item.tierSuggested)}</td>
                      <td>{item.assignedReviewer?.email ?? 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Prev
              </button>
              <button
                className="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </div>

          <div className="panel">
            <h2>Case Detail</h2>
            {loadingDetail && <p>Loading details...</p>}
            {!loadingDetail && selectedCase && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{selectedCase.case.caseRef}</h3>
                    <p style={{ color: '#9ca3af', margin: 0 }}>
                      Status: <strong>{selectedCase.case.status}</strong> · Tier:{' '}
                      {formatTierLabel(selectedCase.case.tierConfirmed ?? selectedCase.case.tierSuggested)}
                    </p>
                    <p style={{ color: '#9ca3af', margin: 0 }}>
                      Reviewer: {selectedCase.case.reviewer?.email ?? 'Unassigned'}
                    </p>
                  </div>
                  <div>
                    <label style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Transition</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <select
                        className="input"
                        value={transitionTarget}
                        onChange={(e) => setTransitionTarget(e.target.value as CaseStatus | '')}
                      >
                        <option value="">Select state</option>
                        {selectedCase.allowedTransitions.map((state) => (
                          <option key={state} value={state}>
                            {state}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        placeholder="Reason (optional)"
                        value={transitionReason}
                        onChange={(e) => setTransitionReason(e.target.value)}
                      />
                      <button className="button" disabled={!transitionTarget} onClick={handleTransition}>
                        Apply
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <div>
                    <h4>Timeline</h4>
                    <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                      {selectedCase.timeline.map((event) => (
                        <div key={event.id} style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span className="tag">{event.type}</span>
                            <span style={{ color: '#9ca3af' }}>{new Date(event.createdAt).toLocaleString()}</span>
                          </div>
                          <pre style={{ background: '#0b1320', padding: '0.5rem', borderRadius: '8px', overflowX: 'auto' }}>
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4>Audit Trail (latest 5)</h4>
                    <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                      {selectedCase.auditTrail.map((entry) => (
                        <div key={entry.id} style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong>{entry.action}</strong>
                            <span style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                              {new Date(entry.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {entry.metadata && (
                            <pre style={{ background: '#0b1320', padding: '0.5rem', borderRadius: '8px', overflowX: 'auto' }}>
                              {JSON.stringify(entry.metadata, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div
                  style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem', marginTop: '1.25rem' }}
                >
                  <div>
                    <h4>Checklist</h4>
                    {loadingRules && <p>Loading jurisdiction rules...</p>}
                    {rulesError && <p style={{ color: '#f87171' }}>{rulesError}</p>}
                    {!loadingRules && !rulesError && (
                      <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                        {checklistItems.map((item) => (
                          <div
                            key={item.id}
                            style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem 0' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <div>
                                <strong>{item.title}</strong>
                                {item.description && (
                                  <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{item.description}</div>
                                )}
                                {item.conditions && (
                                  <div style={{ color: '#c084fc', fontSize: '0.85rem' }}>{item.conditions}</div>
                                )}
                              </div>
                              <span className="tag">{item.type === 'form' ? 'Form' : 'Document'}</span>
                            </div>
                          </div>
                        ))}
                        {checklistItems.length === 0 && <p style={{ color: '#9ca3af' }}>No checklist items</p>}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4>Procedural Metadata</h4>
                    {ruleDetails ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div>
                          <strong>Submission channels:</strong>
                          <div style={{ color: '#9ca3af' }}>
                            {ruleDetails.procedural.submission_channels.join(', ')}
                          </div>
                        </div>
                        {ruleDetails.procedural.deadlines.length > 0 && (
                          <div>
                            <strong>Deadlines</strong>
                            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#9ca3af' }}>
                              {ruleDetails.procedural.deadlines.map((deadline) => (
                                <li key={deadline.name}>
                                  <div>
                                    {deadline.name}: {deadline.timeline}
                                  </div>
                                  {deadline.notes && (
                                    <div style={{ fontSize: '0.9rem' }}>{deadline.notes}</div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {ruleDetails.procedural.addresses.length > 0 && (
                          <div>
                            <strong>Submission addresses</strong>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', color: '#9ca3af' }}>
                              {ruleDetails.procedural.addresses.map((address) => (
                                <div key={address.name}>
                                  <div>{address.name}</div>
                                  {address.attention && <div>{address.attention}</div>}
                                  <div>{address.line1}</div>
                                  {address.line2 && <div>{address.line2}</div>}
                                  <div>
                                    {address.city}, {address.state} {address.postal_code}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ruleDetails.allowed_email_templates.length > 0 && (
                          <div>
                            <strong>Allowed email templates</strong>
                            <div style={{ color: '#9ca3af' }}>
                              {ruleDetails.allowed_email_templates.map((tpl) => tpl.name).join(', ')}
                            </div>
                          </div>
                        )}
                        <div>
                          <strong>Fees</strong>
                          <div style={{ color: '#9ca3af' }}>
                            {ruleDetails.fee_schedule.min_fee_cents
                              ? `$${(ruleDetails.fee_schedule.min_fee_cents / 100).toFixed(2)} minimum`
                              : 'No published minimum'}
                          </div>
                          <div style={{ color: '#9ca3af' }}>
                            {ruleDetails.fee_schedule.max_fee_cents
                              ? `$${(ruleDetails.fee_schedule.max_fee_cents / 100).toFixed(2)} cap`
                              : 'No published cap'}
                          </div>
                        </div>
                        <div>
                          <strong>Feature flag:</strong>{' '}
                          <span className="tag" style={{ background: ruleDetails.enabled ? '#10b981' : '#f97316' }}>
                            {ruleDetails.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          {ruleDetails.feature_flags.notes && (
                            <div style={{ color: '#9ca3af' }}>{ruleDetails.feature_flags.notes}</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p style={{ color: '#9ca3af' }}>Select a jurisdiction with available rules.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
