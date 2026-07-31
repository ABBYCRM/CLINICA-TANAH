import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../hooks/useI18n';

type SectionId =
  | 'start'
  | 'modules'
  | 'roles'
  | 'patients'
  | 'appointments'
  | 'clinical'
  | 'inventory'
  | 'finance'
  | 'marketing'
  | 'lgpd'
  | 'admin'
  | 'howto'
  | 'tips';

const SECTIONS: { id: SectionId; tocKey: string }[] = [
  { id: 'start', tocKey: 'manual.toc_start' },
  { id: 'modules', tocKey: 'manual.toc_modules' },
  { id: 'roles', tocKey: 'manual.toc_roles' },
  { id: 'patients', tocKey: 'manual.toc_patients' },
  { id: 'appointments', tocKey: 'manual.toc_appointments' },
  { id: 'clinical', tocKey: 'manual.toc_clinical' },
  { id: 'inventory', tocKey: 'manual.toc_inventory' },
  { id: 'finance', tocKey: 'manual.toc_finance' },
  { id: 'marketing', tocKey: 'manual.toc_marketing' },
  { id: 'lgpd', tocKey: 'manual.toc_lgpd' },
  { id: 'admin', tocKey: 'manual.toc_admin' },
  { id: 'howto', tocKey: 'manual.toc_howto' },
  { id: 'tips', tocKey: 'manual.toc_tips' },
];

type HowToProcedure = { title: string; steps: string[] };

const MODULE_ROWS = [
  'dashboard', 'patients', 'appointments', 'encounters', 'prescriptions',
  'inventory', 'vendors', 'accounting', 'invoices', 'payroll',
  'whatsapp', 'lgpd', 'team', 'settings', 'clinics',
] as const;

const ROLE_ROWS = [
  'admin', 'doctor', 'nurse', 'receptionist', 'accountant', 'pharmacist', 'dpo', 'superadmin',
] as const;

function Steps({ keys, t }: { keys: string[]; t: (k: string) => string }) {
  return (
    <ol className="list-decimal list-inside space-y-1.5 text-sm text-slate-700">
      {keys.map((k) => (
        <li key={k}>{t(k)}</li>
      ))}
    </ol>
  );
}

export default function Manual() {
  const { t, tRaw } = useI18n();
  const [active, setActive] = useState<SectionId>('start');
  const howto = (tRaw('manual.howto') as HowToProcedure[]) || [];

  const observer = useMemo(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return null;
    return new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target?.id) {
          setActive(visible[0].target.id.replace('manual-', '') as SectionId);
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5] },
    );
  }, []);

  useEffect(() => {
    if (!observer) return;
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(`manual-${id}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [observer]);

  const jump = (id: SectionId) => {
    document.getElementById(`manual-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <div className="space-y-6" data-testid="user-manual">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('manual.title')}</h1>
        <p className="text-slate-500 text-sm mt-1 max-w-3xl">{t('manual.subtitle')}</p>
      </div>

      <div className="grid lg:grid-cols-[220px_1fr] gap-6 items-start">
        <aside className="lg:sticky lg:top-20 card p-3 space-y-1" data-testid="manual-toc">
          <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('manual.toc')}
          </div>
          {SECTIONS.map(({ id, tocKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => jump(id)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                active === id ? 'bg-clinic-50 text-clinic-800 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
              data-testid={`manual-toc-${id}`}
            >
              {t(tocKey)}
            </button>
          ))}
        </aside>

        <div className="space-y-8 min-w-0">
          <section id="manual-start" className="card p-5 space-y-3 scroll-mt-24">
            <h2 className="text-lg font-semibold text-slate-900">{t('manual.start_title')}</h2>
            <p className="text-sm text-slate-600 leading-relaxed">{t('manual.start_body')}</p>
            <Steps
              t={t}
              keys={[
                'manual.start_step1',
                'manual.start_step2',
                'manual.start_step3',
                'manual.start_step4',
              ]}
            />
          </section>

          <section id="manual-modules" className="card overflow-hidden scroll-mt-24">
            <div className="px-5 py-3 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">{t('manual.modules_title')}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{t('manual.modules_intro')}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="manual-modules-table">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-th">{t('manual.col_module')}</th>
                    <th className="table-th">{t('manual.col_purpose')}</th>
                    <th className="table-th">{t('manual.col_how')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {MODULE_ROWS.map((key) => (
                    <tr key={key} className="hover:bg-slate-50/80">
                      <td className="table-td font-medium text-slate-900 whitespace-nowrap">
                        {t(`manual.mod_${key}_name`)}
                      </td>
                      <td className="table-td text-sm text-slate-600">{t(`manual.mod_${key}_purpose`)}</td>
                      <td className="table-td text-sm text-slate-600">{t(`manual.mod_${key}_how`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="manual-roles" className="card overflow-hidden scroll-mt-24">
            <div className="px-5 py-3 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">{t('manual.roles_title')}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{t('manual.roles_intro')}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="manual-roles-table">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-th">{t('manual.col_role')}</th>
                    <th className="table-th">{t('manual.col_access')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ROLE_ROWS.map((key) => (
                    <tr key={key} className="hover:bg-slate-50/80">
                      <td className="table-td font-medium text-slate-900 whitespace-nowrap">
                        {t(`manual.role_${key}_name`)}
                      </td>
                      <td className="table-td text-sm text-slate-600">{t(`manual.role_${key}_access`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <HowSection
            id="patients"
            title={t('manual.patients_title')}
            body={t('manual.patients_body')}
            steps={[
              'manual.patients_step1',
              'manual.patients_step2',
              'manual.patients_step3',
              'manual.patients_step4',
            ]}
            t={t}
          />
          <HowSection
            id="appointments"
            title={t('manual.appointments_title')}
            body={t('manual.appointments_body')}
            steps={[
              'manual.appointments_step1',
              'manual.appointments_step2',
              'manual.appointments_step3',
              'manual.appointments_step4',
            ]}
            t={t}
          />
          <HowSection
            id="clinical"
            title={t('manual.clinical_title')}
            body={t('manual.clinical_body')}
            steps={[
              'manual.clinical_step1',
              'manual.clinical_step2',
              'manual.clinical_step3',
            ]}
            t={t}
          />
          <HowSection
            id="inventory"
            title={t('manual.inventory_title')}
            body={t('manual.inventory_body')}
            steps={[
              'manual.inventory_step1',
              'manual.inventory_step2',
              'manual.inventory_step3',
            ]}
            t={t}
          />
          <HowSection
            id="finance"
            title={t('manual.finance_title')}
            body={t('manual.finance_body')}
            steps={[
              'manual.finance_step1',
              'manual.finance_step2',
              'manual.finance_step3',
              'manual.finance_step4',
            ]}
            t={t}
          />
          <HowSection
            id="marketing"
            title={t('manual.marketing_title')}
            body={t('manual.marketing_body')}
            steps={[
              'manual.marketing_step1',
              'manual.marketing_step2',
              'manual.marketing_step3',
              'manual.marketing_step4',
              'manual.marketing_step5',
            ]}
            t={t}
          />
          <HowSection
            id="lgpd"
            title={t('manual.lgpd_title')}
            body={t('manual.lgpd_body')}
            steps={[
              'manual.lgpd_step1',
              'manual.lgpd_step2',
              'manual.lgpd_step3',
            ]}
            t={t}
          />
          <HowSection
            id="admin"
            title={t('manual.admin_title')}
            body={t('manual.admin_body')}
            steps={[
              'manual.admin_step1',
              'manual.admin_step2',
              'manual.admin_step3',
            ]}
            t={t}
          />

          <section id="manual-howto" className="card p-5 space-y-5 scroll-mt-24" data-testid="manual-section-howto">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('manual.howto_title')}</h2>
              <p className="text-sm text-slate-600 leading-relaxed mt-1">{t('manual.howto_intro')}</p>
            </div>
            <div className="space-y-4">
              {howto.map((proc, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-4" data-testid={`manual-howto-${i}`}>
                  <h3 className="font-semibold text-slate-900 mb-2 flex items-baseline gap-2">
                    <span className="text-clinic-600 tabular-nums">{i + 1}.</span>
                    <span>{proc.title}</span>
                  </h3>
                  <ol className="list-decimal list-inside space-y-1.5 text-sm text-slate-700 marker:text-slate-400">
                    {(proc.steps || []).map((s, j) => (
                      <li key={j}>{s}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>

          <section id="manual-tips" className="card p-5 space-y-3 scroll-mt-24">
            <h2 className="text-lg font-semibold text-slate-900">{t('manual.tips_title')}</h2>
            <ul className="list-disc list-inside space-y-1.5 text-sm text-slate-700">
              {[
                'manual.tip1',
                'manual.tip2',
                'manual.tip3',
                'manual.tip4',
                'manual.tip5',
              ].map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function HowSection({
  id, title, body, steps, t,
}: {
  id: SectionId;
  title: string;
  body: string;
  steps: string[];
  t: (k: string) => string;
}) {
  return (
    <section id={`manual-${id}`} className="card p-5 space-y-3 scroll-mt-24" data-testid={`manual-section-${id}`}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-600 leading-relaxed">{body}</p>
      <Steps t={t} keys={steps} />
    </section>
  );
}
