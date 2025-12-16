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
  completed?: boolean;
}

type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface CaseDocument {
  id: string;
  objectKey: string;
  originalFilename: string;
  sha256: string;
  docType?: string | null;
  aiDocType?: string | null;
  aiConfidence?: number | null;
  status: DocumentStatus;
  reviewerId?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

interface TemplateSummary {
  id: string;
  version: string;
  name: string;
  description: string;
  channel: string;
  riskLevel: 'LOW' | 'HIGH';
  variables: { name: string; required: boolean; maxLength: number | null }[];
}

interface CommunicationPreview {
  subject: string;
  body: string;
}

interface CommunicationRecord {
  id: string;
  templateId: string | null;
  templateVersion: string | null;
  recipient: string | null;
  subject: string;
  status: string;
  sendAt: string;
  createdAt: string;
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
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateVariables, setTemplateVariables] = useState<Record<string, string>>({});
  const [communicationPreview, setCommunicationPreview] = useState<CommunicationPreview | null>(null);
  const [communicationStatus, setCommunicationStatus] = useState<string | null>(null);
  const [communicationError, setCommunicationError] = useState<string | null>(null);
  const [sendAt, setSendAt] = useState('');
  const [communicationHistory, setCommunicationHistory] = useState<CommunicationRecord[]>([]);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDocType, setUploadDocType] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

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
    void fetchTemplates();
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

  useEffect(() => {
    if (!selectedRef || !accessToken) return;
    void fetchCommunicationHistory(selectedRef);
    setSelectedTemplateId('');
    setTemplateVariables({});
    setCommunicationPreview(null);
    setCommunicationStatus(null);
    setCommunicationError(null);
  }, [selectedRef, accessToken]);

  useEffect(() => {
    if (!selectedRef || !accessToken) return;
    void fetchDocuments(selectedRef);
  }, [selectedRef, accessToken]);

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

  const fetchDocuments = async (caseRef: string) => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${caseRef}/documents`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error('Unable to load documents');
      }

      const payload = await response.json();
      setDocuments(payload.documents ?? []);
      if (payload.checklist?.items) {
        setChecklistItems(payload.checklist.items);
      }
    } catch (err: any) {
      setDocumentError(err.message ?? 'Unable to load documents');
    }
  };

  const handleDocumentUpload = async () => {
    if (!selectedRef || !accessToken) {
      setDocumentError('Select a case before uploading');
      return;
    }
    if (!uploadFile) {
      setDocumentError('Select a document to upload');
      return;
    }

    setUploadingDoc(true);
    setDocumentError(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', uploadFile);
    if (uploadDocType) {
      formData.append('docType', uploadDocType);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/cases/${selectedRef}/documents/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const payload = JSON.parse(xhr.responseText);
              setUploadProgress(100);
              setUploadFile(null);
              setUploadDocType('');
              setDocuments((prev) => [payload.document, ...prev.filter((doc) => doc.id !== payload.document.id)]);
              if (payload.checklist?.items) {
                setChecklistItems(payload.checklist.items);
              }
              resolve();
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(xhr.statusText || 'Upload failed'));
          }
        };

        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(formData);
      });
    } catch (err: any) {
      setDocumentError(err.message ?? 'Upload failed');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleReview = async (documentId: string, status: DocumentStatus, note?: string, docType?: string) => {
    if (!selectedRef || !accessToken) return;
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${selectedRef}/documents/${documentId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ status, note: note ?? undefined, docType: docType ?? undefined })
      });

      if (!response.ok) {
        throw new Error('Unable to submit review');
      }

      const payload = await response.json();
      setDocuments((prev) => prev.map((doc) => (doc.id === documentId ? payload.document : doc)));
      if (payload.checklist?.items) {
        setChecklistItems(payload.checklist.items);
      }
    } catch (err: any) {
      setDocumentError(err.message ?? 'Unable to review document');
    }
  };

  const fetchTemplates = async () => {
    if (!accessToken) return;
    setLoadingTemplates(true);
    try {
      const response = await fetch(`${API_BASE_URL}/communications/templates`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error('Failed to load communication templates');
      }

      const payload = await response.json();
      setTemplates(payload.templates ?? []);
    } catch (err: any) {
      console.error(err);
      setCommunicationError(err.message ?? 'Unable to load templates');
    } finally {
      setLoadingTemplates(false);
    }
  };

  const fetchCommunicationHistory = async (caseRef: string) => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${caseRef}/communications`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        throw new Error('Unable to load communications');
      }

      const payload = await response.json();
      setCommunicationHistory(payload ?? []);
    } catch (err: any) {
      console.error(err);
      setCommunicationError(err.message ?? 'Unable to load communications');
    }
  };

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === selectedTemplateId),
    [templates, selectedTemplateId]
  );

  const initializeTemplateVariables = (template?: TemplateSummary) => {
    if (!template) return {} as Record<string, string>;
    const defaults: Record<string, string> = {};
    template.variables.forEach((variable) => {
      defaults[variable.name] = variable.name === 'case_ref' ? selectedCase?.case.caseRef ?? '' : '';
    });
    return defaults;
  };

  const handleTemplateSelection = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((tpl) => tpl.id === templateId);
    setTemplateVariables(initializeTemplateVariables(template));
    setCommunicationPreview(null);
    setCommunicationStatus(null);
    setCommunicationError(null);
  };

  const handleVariableChange = (name: string, value: string) => {
    setTemplateVariables((prev) => ({ ...prev, [name]: value }));
  };

  const planCommunication = async () => {
    if (!selectedCase || !selectedTemplateId || !accessToken) return;
    setCommunicationError(null);
    setCommunicationStatus('Planning preview...');
    try {
      const response = await fetch(
        `${API_BASE_URL}/cases/${selectedCase.case.caseRef}/communications/plan`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ templateId: selectedTemplateId, variables: templateVariables, sendAt: sendAt || undefined })
        }
      );

      if (!response.ok) {
        throw new Error('Unable to prepare communication');
      }

      const payload = await response.json();
      setCommunicationPreview(payload.preview);
      setCommunicationStatus('Preview ready');
    } catch (err: any) {
      console.error(err);
      setCommunicationError(err.message ?? 'Unable to prepare communication');
      setCommunicationStatus(null);
    }
  };

  const sendCommunication = async (autoSend: boolean) => {
    if (!selectedCase || !selectedTemplateId || !accessToken) return;
    const caseTier = selectedCase.case.tierConfirmed ?? selectedCase.case.tierSuggested;
    const isHighRiskCase = caseTier === 'HIGH' || caseTier === 'ENTERPRISE';
    const templateRisk = selectedTemplate?.riskLevel ?? 'LOW';
    if (isHighRiskCase && !communicationPreview) {
      setCommunicationError('Preview is required before sending high-risk communications.');
      return;
    }

    if (autoSend && !(caseTier === 'LOW' && templateRisk === 'LOW')) {
      setCommunicationError('Auto-send is limited to Tier A cases with low-risk templates.');
      return;
    }

    setCommunicationError(null);
    setCommunicationStatus('Scheduling send...');
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${selectedCase.case.caseRef}/communications/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          variables: templateVariables,
          sendAt: sendAt || undefined,
          autoSend
        })
      });

      if (!response.ok) {
        throw new Error('Unable to queue communication');
      }

      await fetchCommunicationHistory(selectedCase.case.caseRef);
      setCommunicationStatus('Queued for delivery');
    } catch (err: any) {
      console.error(err);
      setCommunicationError(err.message ?? 'Unable to queue communication');
      setCommunicationStatus(null);
    }
  };

  const selectedCaseTier = selectedCase?.case.tierConfirmed ?? selectedCase?.case.tierSuggested;
  const isHighRiskCase = selectedCaseTier === 'HIGH' || selectedCaseTier === 'ENTERPRISE';
  const autoSendAllowed = selectedCaseTier === 'LOW' && selectedTemplate?.riskLevel === 'LOW';
  const requiresPreview = isHighRiskCase || selectedTemplate?.riskLevel === 'HIGH';

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
  const requiredDocs = checklistItems.filter((item) => item.type === 'document');
  const completedDocs = requiredDocs.filter((item) => item.completed).length;

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
                    <h4>Checklist progress</h4>
                    {loadingRules && <p>Loading jurisdiction rules...</p>}
                    {rulesError && <p style={{ color: '#f87171' }}>{rulesError}</p>}
                    {!loadingRules && !rulesError && (
                      <>
                        <div style={{ color: '#9ca3af', marginBottom: '0.35rem' }}>
                          {completedDocs} / {requiredDocs.length || 1} required documents received
                        </div>
                        <div
                          style={{
                            background: '#0b1320',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            marginBottom: '0.5rem'
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.round((completedDocs / (requiredDocs.length || 1)) * 100)}%`,
                              height: '10px',
                              background: '#3b82f6',
                              transition: 'width 0.2s ease'
                            }}
                          />
                        </div>
                        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                          {checklistItems.map((item) => (
                            <div
                              key={item.id}
                              style={{ borderBottom: '1px solid #1f2937', padding: '0.5rem 0' }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <strong>{item.title}</strong>
                                  {item.description && (
                                    <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{item.description}</div>
                                  )}
                                  {item.conditions && (
                                    <div style={{ color: '#c084fc', fontSize: '0.85rem' }}>{item.conditions}</div>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <span className="tag">{item.type === 'form' ? 'Form' : 'Document'}</span>
                                  <span
                                    className="tag"
                                    style={{ background: item.completed ? '#10b981' : '#6b7280' }}
                                  >
                                    {item.completed ? 'Complete' : 'Pending'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                          {checklistItems.length === 0 && <p style={{ color: '#9ca3af' }}>No checklist items</p>}
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    <h4>Documents & reviews</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
                      <input
                        className="input"
                        placeholder="Optional doc type override"
                        value={uploadDocType}
                        onChange={(e) => setUploadDocType(e.target.value)}
                      />
                      <button className="button" onClick={handleDocumentUpload} disabled={uploadingDoc}>
                        {uploadingDoc ? 'Uploading…' : 'Upload document'}
                      </button>
                      {uploadingDoc && (
                        <div style={{ background: '#0b1320', borderRadius: '6px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${uploadProgress}%`,
                              height: '8px',
                              background: '#10b981',
                              transition: 'width 0.2s ease'
                            }}
                          />
                        </div>
                      )}
                      {documentError && <span style={{ color: '#f87171' }}>{documentError}</span>}
                    </div>
                    <div
                      style={{
                        maxHeight: '320px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}
                    >
                      {documents.map((doc) => (
                        <div key={doc.id} style={{ border: '1px solid #1f2937', borderRadius: '8px', padding: '0.5rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <strong>{doc.originalFilename}</strong>
                              <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{doc.objectKey}</div>
                            </div>
                            <span
                              className="tag"
                              style={{
                                background:
                                  doc.status === 'APPROVED'
                                    ? '#10b981'
                                    : doc.status === 'REJECTED'
                                      ? '#ef4444'
                                      : '#6b7280'
                              }}
                            >
                              {doc.status}
                            </span>
                          </div>
                          <div style={{ color: '#9ca3af', fontSize: '0.9rem', marginTop: '0.35rem' }}>
                            SHA256: {doc.sha256}
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', color: '#e5e7eb', marginTop: '0.35rem' }}>
                            <span>Doc type: {doc.docType ?? doc.aiDocType ?? 'Unlabeled'}</span>
                            {doc.aiConfidence && <span>AI confidence: {(doc.aiConfidence * 100).toFixed(1)}%</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                            <button
                              className="button"
                              onClick={() =>
                                handleReview(doc.id, 'APPROVED', undefined, doc.docType ?? doc.aiDocType ?? undefined)
                              }
                            >
                              Approve
                            </button>
                            <button
                              className="button"
                              style={{ background: '#ef4444' }}
                              onClick={() => {
                                const note = prompt('Optional rejection note');
                                void handleReview(
                                  doc.id,
                                  'REJECTED',
                                  note ?? undefined,
                                  doc.docType ?? doc.aiDocType ?? undefined
                                );
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                      {documents.length === 0 && <p style={{ color: '#9ca3af' }}>No documents uploaded yet.</p>}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '1.25rem' }}>
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

                <div style={{ marginTop: '1.25rem' }}>
                  <h4>Outbound communications</h4>
                  <p style={{ color: '#9ca3af', marginTop: '-0.25rem' }}>
                    Subjects include the case reference automatically and a mandatory disclaimer is appended to every body.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ color: '#9ca3af' }}>Template</label>
                      <select
                        className="input"
                        value={selectedTemplateId}
                        onChange={(e) => handleTemplateSelection(e.target.value)}
                      >
                        <option value="">Select a template</option>
                        {templates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name} (v{tpl.version})
                          </option>
                        ))}
                      </select>
                      {loadingTemplates && <span style={{ color: '#9ca3af' }}>Loading templates…</span>}
                      {selectedTemplate && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div style={{ color: '#9ca3af', fontSize: '0.95rem' }}>
                            {selectedTemplate.description} · Channel: {selectedTemplate.channel} · Risk:{' '}
                            <span className="tag" style={{ background: selectedTemplate.riskLevel === 'HIGH' ? '#f97316' : '#10b981' }}>
                              {selectedTemplate.riskLevel}
                            </span>
                          </div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                              gap: '0.5rem'
                            }}
                          >
                            {selectedTemplate.variables.map((variable) => (
                              <div key={variable.name} style={{ display: 'flex', flexDirection: 'column' }}>
                                <label style={{ color: '#9ca3af' }}>
                                  {variable.name} {variable.required ? '*' : ''}
                                </label>
                                <input
                                  className="input"
                                  value={templateVariables[variable.name] ?? ''}
                                  onChange={(e) => handleVariableChange(variable.name, e.target.value)}
                                  placeholder={variable.name === 'case_ref' ? selectedCase.case.caseRef : 'Enter value'}
                                  disabled={variable.name === 'case_ref'}
                                  maxLength={variable.maxLength ?? undefined}
                                />
                              </div>
                            ))}
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <label style={{ color: '#9ca3af' }}>Send at (optional)</label>
                              <input
                                className="input"
                                type="datetime-local"
                                value={sendAt}
                                onChange={(e) => setSendAt(e.target.value)}
                              />
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button className="button" onClick={planCommunication} disabled={!selectedTemplateId}>
                              Preview
                            </button>
                            <button
                              className="button"
                              onClick={() => sendCommunication(false)}
                              disabled={!selectedTemplateId || (requiresPreview && !communicationPreview)}
                            >
                              Queue send
                            </button>
                            <button
                              className="button"
                              onClick={() => sendCommunication(true)}
                              disabled={!selectedTemplateId || !autoSendAllowed}
                            >
                              Auto-send (Tier A + low risk)
                            </button>
                          </div>
                          <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                            {requiresPreview
                              ? 'Preview required for high-risk cases or templates before sending.'
                              : 'Auto-send is only enabled for Tier A cases with low-risk templates.'}
                          </div>
                          {communicationStatus && <div style={{ color: '#10b981' }}>{communicationStatus}</div>}
                          {communicationError && <div style={{ color: '#f87171' }}>{communicationError}</div>}
                          {communicationPreview && (
                            <div style={{ marginTop: '0.5rem' }}>
                              <h5>Preview</h5>
                              <div style={{ color: '#9ca3af' }}>Subject: {communicationPreview.subject}</div>
                              <pre
                                style={{
                                  background: '#0b1320',
                                  padding: '0.75rem',
                                  borderRadius: '8px',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word'
                                }}
                              >
                                {communicationPreview.body}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <h5>Recent communications</h5>
                      <div style={{ maxHeight: '360px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {communicationHistory.map((item) => (
                          <div key={item.id} style={{ border: '1px solid #1f2937', borderRadius: '8px', padding: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <strong>{item.subject}</strong>
                              <span className="tag">{item.status}</span>
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                              Template: {item.templateId ?? 'n/a'} v{item.templateVersion ?? 'n/a'}
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                              Send at: {new Date(item.sendAt).toLocaleString()}
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>
                              Recipient: {item.recipient ?? 'unspecified'}
                            </div>
                          </div>
                        ))}
                        {communicationHistory.length === 0 && (
                          <div style={{ color: '#9ca3af' }}>No communications planned for this case yet.</div>
                        )}
                      </div>
                    </div>
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
