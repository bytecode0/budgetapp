import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { ArrowLeft, Target } from 'lucide-react';

export type LegalPageKind = 'privacy' | 'terms';

interface LegalSection {
  title: string;
  paragraphs: string[];
  items?: string[];
  after?: string;
}

// Public pages (no session) at /privacy and /terms, rendered by App.tsx from
// the URL path. The text lives in the locales under `legal.*`; Spanish is the
// source of truth.
export function LegalPage({ page }: { page: LegalPageKind }) {
  const { t } = useTranslation();
  const raw: unknown = t(`legal.${page}.sections`, { returnObjects: true });
  const sections: LegalSection[] = Array.isArray(raw) ? raw : [];
  const other: LegalPageKind = page === 'privacy' ? 'terms' : 'privacy';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="w-full bg-card border-b border-border py-4 px-4 sm:px-8 flex items-center justify-between gap-3">
        <a href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
            <Target className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-lg">LifePlan</span>
        </a>
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> {t('legal.backToApp')}
        </a>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <h1 className="text-4xl tracking-tight">{t(`legal.${page}.title`)}</h1>
          <p className="text-xs text-muted-foreground">{t('legal.lastUpdated')}</p>
          <p className="text-muted-foreground">{t(`legal.${page}.intro`)}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-card border border-border rounded-2xl p-6 space-y-6"
        >
          {sections.map((s, i) => (
            <section key={i} className="space-y-2">
              <h2 className="font-display text-lg">{i + 1}. {s.title}</h2>
              {s.paragraphs.map((p, j) => <p key={j} className="text-sm leading-relaxed">{p}</p>)}
              {s.items && (
                <ul className="list-disc pl-5 space-y-1.5">
                  {s.items.map((item, j) => <li key={j} className="text-sm leading-relaxed">{item}</li>)}
                </ul>
              )}
              {s.after && <p className="text-sm leading-relaxed">{s.after}</p>}
            </section>
          ))}
        </motion.div>

        <p className="text-sm text-center">
          <a href={`/${other}`} className="text-primary hover:underline">{t(`legal.${other}Link`)}</a>
        </p>
      </main>
    </div>
  );
}
