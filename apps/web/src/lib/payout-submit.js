export async function submitPayoutConfirmation(params) {
  const {
    apiBaseUrl,
    token,
    caseRef,
    payoutAmountCents,
    attorneyFeeCents,
    reference,
    note,
    evidence,
    closeCase,
    fetchImpl = fetch,
  } = params;

  const formData = new FormData();
  formData.append('amountCents', `${payoutAmountCents}`);
  formData.append('attorneyFeeCents', `${attorneyFeeCents}`);
  if (reference) formData.append('reference', reference);
  if (note) formData.append('note', note);
  if (evidence) formData.append('evidence', evidence);
  if (closeCase) formData.append('closeCase', 'true');

  const response = await fetchImpl(`${apiBaseUrl}/cases/${caseRef}/payouts/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) || {};
    throw new Error(errorBody.message ?? 'Unable to confirm payout');
  }

  return response.json();
}
