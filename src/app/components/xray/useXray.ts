import { useState } from 'react';
import type { XRayResult, Overrides } from './types';

// File → base64 (strips the "data:...;base64," prefix), same approach as useImport.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Public (no credentials): the Radiografía endpoints don't require auth.
export function useXray() {
  const [analyzing, setAnalyzing] = useState(false);

  const toFiles = (input: File[] | File) =>
    Promise.all((Array.isArray(input) ? input : [input]).map(async f => ({ filename: f.name, dataBase64: await fileToBase64(f) })));

  const analyze = async (
    input: File[] | File,
  ): Promise<{ error?: string; sessionId?: string; result?: XRayResult }> => {
    setAnalyzing(true);
    try {
      const files = await toFiles(input);
      const res = await fetch('/api/xray/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || 'analyze_failed' };
      return { sessionId: data.sessionId as string, result: data.result as XRayResult };
    } catch {
      return { error: 'network' };
    } finally {
      setAnalyzing(false);
    }
  };

  // Append account(s) to an existing session and re-analyze the combined set.
  const addAccount = async (
    sessionId: string,
    input: File[] | File,
  ): Promise<{ error?: string; result?: XRayResult }> => {
    try {
      const files = await toFiles(input);
      const res = await fetch('/api/xray/add-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, files }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data.error || 'analyze_failed' };
      return { result: data.result as XRayResult };
    } catch {
      return { error: 'network' };
    }
  };

  const reclassify = async (
    sessionId: string,
    overrides: Overrides,
  ): Promise<{ result?: XRayResult }> => {
    try {
      const res = await fetch('/api/xray/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, overrides }),
      });
      if (!res.ok) return {};
      const data = await res.json();
      return { result: data.result as XRayResult };
    } catch {
      return {};
    }
  };

  const submitLead = async (sessionId: string, email: string): Promise<{ ok: boolean }> => {
    try {
      const res = await fetch('/api/xray/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, email }),
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  };

  // Fire-and-forget funnel analytics. Never blocks the UI, never throws.
  const track = (event: string, sessionId?: string | null) => {
    try {
      fetch('/api/xray/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, sessionId: sessionId ?? undefined }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore */ }
  };

  return { analyzing, analyze, addAccount, reclassify, submitLead, track };
}
