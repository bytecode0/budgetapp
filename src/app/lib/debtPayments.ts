// A debt payment (a card being paid off, a loan's cuota) is an expense on the
// debt's budget line, paid from a bank account — the server links it to the
// debt (server/routes/expenses.ts) and its live balance drops. Creates the line
// if the debt has none yet. Errors come back as a `code` for the caller to
// translate.
export async function recordDebtPayment(
  debt: { id: string; name: string },
  payment: { amount: number; accountId: string; date: string; description: string },
): Promise<{ code?: string }> {
  const allocRes = await fetch('/api/allocations', { credentials: 'include' });
  if (!allocRes.ok) return { code: 'payment_failed' };
  const { allocations } = await allocRes.json() as { allocations: { id: string; debtId?: string | null }[] };
  let allocationId = allocations.find(a => a.debtId === debt.id)?.id;
  if (!allocationId) {
    const created = await fetch('/api/allocations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: debt.name, icon: '🔒', type: 'debt', debtId: debt.id }),
    });
    const data = await created.json();
    if (!created.ok) return { code: data.code ?? 'payment_failed' };
    allocationId = data.allocation.id as string;
  }

  const res = await fetch('/api/expenses', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payment, allocationId }),
  });
  const data = await res.json();
  if (!res.ok) return { code: data.code ?? 'payment_failed' };
  return {};
}
