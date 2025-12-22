import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

import { NavBar } from '../components/NavBar';
import { API_BASE_URL } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatSafeLabel } from '../lib/safety';

type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type ChecklistItem = {
  id: string;
  title: string;
  type: 'document' | 'form';
  required: boolean;
  completed?: boolean;
};

type CaseDocument = {
  id: string;
  originalFilename: string;
  objectKey: string;
  sha256: string;
  docType?: string | null;
  aiDocType?: string | null;
  aiConfidence?: number | null;
  status: DocumentStatus;
};

export default function PortalPage() {
  const { user, loading, accessToken } = useAuth();
  const router = useRouter();

  const [caseRef, setCaseRef] = useState('');
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDocType, setUploadDocType] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const toMessage = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;

  useEffect(() => {
    if (!loading && !user) {
      void router.replace('/login');
    }
  }, [user, loading, router]);

  const fetchDocuments = async () => {
    if (!accessToken || !caseRef) return;
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/cases/${caseRef}/documents`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error('Unable to load documents');
      }
      const payload = await response.json();
      setDocuments(payload.documents ?? []);
      setChecklist(payload.checklist?.items ?? []);
    } catch (err: unknown) {
      setError(toMessage(err, 'Unable to load documents'));
    }
  };

  const handleUpload = async () => {
    if (!accessToken || !caseRef) {
      setError('Provide a case reference before uploading');
      return;
    }
    if (!uploadFile) {
      setError('Choose a document to upload');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError(null);
    setStatusMessage(null);

    const formData = new FormData();
    formData.append('file', uploadFile);
    if (uploadDocType) {
      formData.append('docType', uploadDocType);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}/cases/${caseRef}/documents/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setStatusMessage('Upload complete');
            resolve();
          } else {
            reject(new Error(xhr.statusText || 'Upload failed'));
          }
        };

        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(formData);
      });

      setUploadFile(null);
      setUploadDocType('');
      await fetchDocuments();
    } catch (err: unknown) {
      setError(toMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  if (!user) {
    return <div className="main-shell" />;
  }

  const requiredDocs = checklist.filter((item) => item.type === 'document');
  const completedDocs = requiredDocs.filter((item) => item.completed).length;

  return (
    <div className="main-shell">
      <Head>
        <title>Client Portal | Surplus Claim</title>
      </Head>
      <NavBar />
      <div className="content-shell">
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <h1>Upload documents</h1>
          <p style={{ color: '#9ca3af' }}>Share files with reviewers and track checklist progress.</p>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              className="input"
              placeholder="Case reference"
              value={caseRef}
              onChange={(e) => setCaseRef(e.target.value)}
            />
            <button className="button" onClick={fetchDocuments} disabled={!caseRef}>Load</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <h3>Upload</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
                <input
                  className="input"
                  placeholder="Optional doc type override"
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value)}
                />
                <button className="button" onClick={handleUpload} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload document'}
                </button>
                {uploading && (
                  <div style={{ background: '#0b1320', borderRadius: '6px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${uploadProgress}%`,
                        height: '10px',
                        background: '#10b981',
                        transition: 'width 0.2s ease'
                      }}
                    />
                  </div>
                )}
                {statusMessage && <div className="tag" style={{ background: '#10b981' }}>{statusMessage}</div>}
                {error && <div style={{ color: '#f87171' }}>{error}</div>}
              </div>
            </div>

            <div>
              <h3>Checklist progress</h3>
              <div style={{ color: '#9ca3af', marginBottom: '0.5rem' }}>
                {completedDocs} / {requiredDocs.length || 1} required documents received
              </div>
              <div style={{ background: '#0b1320', borderRadius: '6px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                <div
                  style={{
                    width: `${Math.round((completedDocs / (requiredDocs.length || 1)) * 100)}%`,
                    height: '10px',
                    background: '#3b82f6',
                    transition: 'width 0.2s ease'
                  }}
                />
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    style={{ borderBottom: '1px solid #1f2937', padding: '0.35rem 0', display: 'flex', justifyContent: 'space-between' }}
                  >
                    <span>{item.title}</span>
                    <span className="tag" style={{ background: item.completed ? '#10b981' : '#6b7280' }}>
                      {item.completed ? 'Complete' : 'Pending'}
                    </span>
                  </div>
                ))}
                {checklist.length === 0 && <p style={{ color: '#9ca3af' }}>No checklist available yet</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: '1rem' }}>
          <h3>Uploaded documents</h3>
          <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {documents.map((doc) => (
              <div key={doc.id} style={{ border: '1px solid #1f2937', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{doc.originalFilename}</strong>
                    <div style={{ color: '#9ca3af', fontSize: '0.9rem' }}>{doc.objectKey}</div>
                  </div>
                  <span
                    className="tag"
                    style={{ background: doc.status === 'APPROVED' ? '#10b981' : doc.status === 'REJECTED' ? '#ef4444' : '#6b7280' }}
                  >
                    {doc.status}
                  </span>
                </div>
                <div style={{ color: '#9ca3af', fontSize: '0.9rem', marginTop: '0.35rem' }}>
                  SHA256: {doc.sha256}
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.35rem', color: '#e5e7eb' }}>
                  <span>Doc type: {formatSafeLabel(doc.docType ?? doc.aiDocType)}</span>
                  {doc.aiConfidence && <span>AI confidence: {(doc.aiConfidence * 100).toFixed(1)}%</span>}
                </div>
              </div>
            ))}
            {documents.length === 0 && <p style={{ color: '#9ca3af' }}>No documents uploaded yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
