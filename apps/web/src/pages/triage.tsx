import Head from 'next/head';
import { useEffect, useMemo, useState } from 'react';

import { NavBar } from '../components/NavBar';
import { API_BASE_URL } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { guardSuggestionResponse } from '../lib/safety';

export type TierChoice = 'TIER_A' | 'TIER_B' | 'TIER_C';

const TIER_LABELS: Record<TierChoice, string> = {
  TIER_A: 'Tier A (simple)',
  TIER_B: 'Tier B (intermediate)',
  TIER_C: 'Tier C (escalation)'
};

const formatTierLabel = (value?: string | null) => {
  if (!value) return 'Unassigned';
  return TIER_LABELS[value as TierChoice] ?? value;
};

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

export type CaseStatus = (typeof CASE_STATUSES)[number];

const toMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

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

interface TriageSuggestionResponse {
  caseRef: string;
  tierSuggested: TierChoice;
  mappedTierLevel: string;
  rationale: string[];
  confidence: number;
  escalates: boolean;
  disclaimer: string;
}

export default function TriagePage() {
  const { user, accessToken, loading } = useAuth();
  const [caseList, setCaseList] = useState<CaseSummary[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseSummary | null>(null);
  const [suggestion, setSuggestion] = useState<TriageSuggestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextNotes, setContextNotes] = useState('');
  const [signals, setSignals] = useState({ probateFlag: false, heirsFlag: false, titleIssueFlag: false });
  const [loadingList, setLoadingList] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const [assignToSelf, setAssignToSelf] = useState(true);
  const [notes, setNotes] = useState('');
  const [partnerHandoff, setPartnerHandoff] = useState({ partnerName: '', contact: '', summary: '' });
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user || !accessToken) {
      window.location.href = '/login';
      return;
    }
    void fetchCases();
  }, [user, accessToken, loading]);

  const fetchCases = async () => {
    if (!accessToken) return;
    setLoadingList(true);
    setError(null);
    try {
      const params = new URLSearchParams({ needsTriage: 'true', page: '1', pageSize: '25' });
      const response = await fetch(`${API_BASE_URL}/cases?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load triage inbox');
      }

      const payload = await response.json();
      setCaseList(payload.cases ?? []);
      setSelectedCase(payload.cases?.[0] ?? null);
      setSuggestion(null);
    } catch (err: unknown) {
      setError(toMessage(err, 'Unable to load triage inbox'));
    } finally {
      setLoadingList(false);
    }
  };

  const requestSuggestion = async () => {
    if (!selectedCase || !accessToken) return;
    setLoadingSuggestion(true);
    setError(null);
    setConfirmationMessage(null);
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${selectedCase.caseRef}/triage/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          context: contextNotes || undefined,
          signals: Object.entries(signals)
            .filter(([, value]) => value)
            .map(([key]) => key),
          probateFlag: signals.probateFlag,
          heirsFlag: signals.heirsFlag,
          titleIssueFlag: signals.titleIssueFlag
        })
      });

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.message ?? 'Unable to suggest tier');
      }

      const payload: TriageSuggestionResponse = await response.json();
      const guarded = guardSuggestionResponse(payload);
      if (!guarded) {
        throw new Error('AI output blocked because it did not pass compliance validation');
      }
      setSuggestion(guarded);
    } catch (err: unknown) {
      setError(toMessage(err, 'Unable to suggest tier'));
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const confirmTier = async (tier: TierChoice) => {
    if (!selectedCase || !accessToken || !user) return;
    setLoadingConfirm(true);
    setError(null);
    setConfirmationMessage(null);

    if (tier === 'TIER_C') {
      if (!partnerHandoff.partnerName || !partnerHandoff.contact || !partnerHandoff.summary) {
        setError('Partner handoff is required for Tier C');
        setLoadingConfirm(false);
        return;
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}/cases/${selectedCase.caseRef}/triage/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          tier,
          reviewerId: assignToSelf ? user.id : undefined,
          rationale: suggestion?.rationale ?? [],
          notes: notes || undefined,
          partnerHandoff: tier === 'TIER_C' ? partnerHandoff : undefined
        })
      });

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.message ?? 'Unable to confirm tier');
      }

      setConfirmationMessage(`Confirmed ${TIER_LABELS[tier]} for ${selectedCase.caseRef}`);
      setSuggestion(null);
      setNotes('');
      setPartnerHandoff({ partnerName: '', contact: '', summary: '' });
      await fetchCases();
    } catch (err: unknown) {
      setError(toMessage(err, 'Unable to confirm tier'));
    } finally {
      setLoadingConfirm(false);
    }
  };

  const inboxCases = useMemo(() => caseList, [caseList]);

  if (!user) return <div className="main-shell" />;

  return (
    <div className="main-shell">
      <Head>
        <title>Triage Inbox | Surplus Claim</title>
      </Head>
      <NavBar />
      <div className="content-shell">
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1>Triage Inbox</h1>
              <p style={{ color: '#9ca3af' }}>
                Cases that need a human reviewer to confirm AI tiering and assign ownership.
              </p>
            </div>
            <button className="button" onClick={() => fetchCases()} disabled={loadingList}>
              Refresh
            </button>
          </div>
          {error && <p style={{ color: '#f87171' }}>{error}</p>}
          {confirmationMessage && <p style={{ color: '#10b981' }}>{confirmationMessage}</p>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '1rem' }}>
          <div className="panel">
            <h2>Cases needing confirmation</h2>
            {loadingList && <p>Loading cases...</p>}
            {!loadingList && inboxCases.length === 0 && <p style={{ color: '#9ca3af' }}>No cases pending triage.</p>}
            {!loadingList && inboxCases.length > 0 && (
              <table style={{ width: '100%', borderSpacing: '0 0.5rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#9ca3af' }}>
                    <th>Case</th>
                    <th>Status</th>
                    <th>Suggested tier</th>
                    <th>Reviewer</th>
                  </tr>
                </thead>
                <tbody>
                  {inboxCases.map((item) => (
                    <tr
                      key={item.id}
                      style={{
                        cursor: 'pointer',
                        background: selectedCase?.caseRef === item.caseRef ? '#0f172a' : 'transparent'
                      }}
                      onClick={() => {
                        setSelectedCase(item);
                        setSuggestion(null);
                      }}
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
          </div>

          <div className="panel">
            <h2>Confirm triage</h2>
            {!selectedCase && <p style={{ color: '#9ca3af' }}>Select a case to review its tier suggestion.</p>}
            {selectedCase && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{selectedCase.caseRef}</h3>
                    <p style={{ color: '#9ca3af', margin: 0 }}>
                      Current status: <strong>{selectedCase.status}</strong>
                    </p>
                    <p style={{ color: '#9ca3af', margin: 0 }}>
                      Suggested tier: {formatTierLabel(selectedCase.tierConfirmed ?? selectedCase.tierSuggested)}
                    </p>
                  </div>
                  <div>
                    <label style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Assign reviewer</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={assignToSelf}
                        onChange={(e) => setAssignToSelf(e.target.checked)}
                      />
                      <span style={{ color: '#e5e7eb' }}>Assign to me ({user.email})</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Context (optional)</label>
                  <textarea
                    className="input"
                    style={{ minHeight: '80px' }}
                    placeholder="Describe any known issues or intake notes"
                    value={contextNotes}
                    onChange={(e) => setContextNotes(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                    <label style={{ color: '#e5e7eb' }}>
                      <input
                        type="checkbox"
                        checked={signals.probateFlag}
                        onChange={(e) => setSignals((prev) => ({ ...prev, probateFlag: e.target.checked }))}
                      />{' '}
                      Probate / estate
                    </label>
                    <label style={{ color: '#e5e7eb' }}>
                      <input
                        type="checkbox"
                        checked={signals.heirsFlag}
                        onChange={(e) => setSignals((prev) => ({ ...prev, heirsFlag: e.target.checked }))}
                      />{' '}
                      Heirs involved
                    </label>
                    <label style={{ color: '#e5e7eb' }}>
                      <input
                        type="checkbox"
                        checked={signals.titleIssueFlag}
                        onChange={(e) => setSignals((prev) => ({ ...prev, titleIssueFlag: e.target.checked }))}
                      />{' '}
                      Title dispute
                    </label>
                  </div>
                  <button className="button" style={{ marginTop: '0.5rem' }} onClick={() => requestSuggestion()} disabled={loadingSuggestion}>
                    {loadingSuggestion ? 'Requesting...' : 'Suggest tier'}
                  </button>
                </div>

                {suggestion && (
                  <div style={{ padding: '0.75rem', border: '1px solid #1f2937', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h4 style={{ margin: 0 }}>AI suggestion: {formatTierLabel(suggestion.tierSuggested)}</h4>
                      <span className="tag">Confidence {(suggestion.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div style={{ color: '#9ca3af', marginTop: '0.5rem' }}>
                      <strong>Rationale</strong>
                      <ul style={{ marginTop: '0.25rem', paddingLeft: '1.25rem' }}>
                        {suggestion.rationale.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                      <div>Escalates: {suggestion.escalates ? 'Yes (Tier C -> Escalated)' : 'No'}</div>
                      <p style={{ marginTop: '0.5rem', color: '#fbbf24' }}>{suggestion.disclaimer}</p>
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ color: '#9ca3af', fontSize: '0.9rem' }}>Reviewer notes</label>
                  <textarea
                    className="input"
                    style={{ minHeight: '80px' }}
                    placeholder="Add decision notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                  <button className="button" disabled={loadingConfirm} onClick={() => confirmTier('TIER_A')}>
                    {loadingConfirm ? 'Saving...' : 'Confirm Tier A'}
                  </button>
                  <button className="button" disabled={loadingConfirm} onClick={() => confirmTier('TIER_B')}>
                    {loadingConfirm ? 'Saving...' : 'Confirm Tier B'}
                  </button>
                  <button
                    className="button"
                    style={{ background: '#ef4444' }}
                    disabled={loadingConfirm}
                    onClick={() => confirmTier('TIER_C')}
                  >
                    {loadingConfirm ? 'Saving...' : 'Confirm Tier C (escalate)'}
                  </button>
                </div>

                <div style={{ borderTop: '1px solid #1f2937', paddingTop: '0.5rem' }}>
                  <h4 style={{ marginBottom: '0.25rem' }}>Partner handoff (Tier C required)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                    <input
                      className="input"
                      placeholder="Partner name"
                      value={partnerHandoff.partnerName}
                      onChange={(e) => setPartnerHandoff((prev) => ({ ...prev, partnerName: e.target.value }))}
                    />
                    <input
                      className="input"
                      placeholder="Partner contact"
                      value={partnerHandoff.contact}
                      onChange={(e) => setPartnerHandoff((prev) => ({ ...prev, contact: e.target.value }))}
                    />
                  </div>
                  <textarea
                    className="input"
                    style={{ minHeight: '70px', marginTop: '0.5rem' }}
                    placeholder="Summary for partner handoff"
                    value={partnerHandoff.summary}
                    onChange={(e) => setPartnerHandoff((prev) => ({ ...prev, summary: e.target.value }))}
                  />
                  <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                    Any Tier C confirmation will transition the case to ESCALATED and record this handoff.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
