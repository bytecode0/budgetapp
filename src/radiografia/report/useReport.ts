import { useEffect, useState } from 'react';
import type { ReportData } from './ReportView';

// Fetches a report by its permanent token. Shared by the /informe/<token>
// page and by the onboarding's last step, which renders the same report
// inline — one fetch path, so "the report I saw at the end" and "the report
// behind the link" can never be two different things.
//
// Side effect worth knowing about: GET /report/:token is what triggers the
// eBook email, once, the first time a report is actually opened. Rendering the
// report inline at the end of the funnel means that now happens there rather
// than when the emailed link is clicked. The server's atomic updateMany still
// guarantees exactly one send.
export function useReport(token: string | null) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setReport(null); setError('not_found'); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/radiografia/report/${token}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setError(body.error ?? 'not_found'); return; }
        setReport(body.data as ReportData);
      })
      .catch(() => { if (!cancelled) setError('network'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  return { report, error, loading };
}
