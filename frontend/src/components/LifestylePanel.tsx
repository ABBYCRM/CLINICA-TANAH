/**
 * Dieta e exercício — structured calories/deficit feed the composition engine.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export default function LifestylePanel({
  patientId, plans, onSaved,
}: { patientId: string; plans: any[]; onSaved: () => void }) {
  const { t } = useI18n();
  const [planType, setPlanType] = useState<'nutrition' | 'exercise'>('nutrition');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [dailyCalories, setDailyCalories] = useState('');
  const [deficitKcal, setDeficitKcal] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async () => {
    if (!title.trim()) {
      setMsg(t('body.life_title_required'));
      return;
    }
    setBusy(true); setMsg('');
    try {
      await api.post(`/api/clinical/body/${patientId}/plans`, {
        title: title.trim(),
        summary: summary.trim() || null,
        description: summary.trim() || null,
        plan_type: planType,
        daily_calories: planType === 'nutrition' && dailyCalories ? Number(dailyCalories) : null,
        deficit_kcal: planType === 'nutrition' && deficitKcal ? Number(deficitKcal) : null,
        protein_g: planType === 'nutrition' && proteinG ? Number(proteinG) : null,
      });
      setTitle('');
      setSummary('');
      setDailyCalories('');
      setDeficitKcal('');
      setProteinG('');
      setMsg(t('body.life_saved'));
      onSaved();
    } catch (e: any) {
      setMsg(e?.message || t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="body-lifestyle-full">
      <header>
        <h3 className="crm-record-panel-title !mb-0">{t('body.life_title')}</h3>
        <p className="text-xs text-[color:var(--ink-muted)] mt-1">{t('body.life_intro')}</p>
      </header>

      <div className="rounded-lg border border-[rgba(176,183,192,0.45)] bg-[#f7f1e6] px-3 py-2.5 text-xs text-[color:var(--ink)] leading-relaxed">
        {t('body.life_scope_banner')}
      </div>

      <ul className="space-y-2">
        {(plans || []).map((p) => (
          <li key={p.id} className="crm-timeline-card space-y-1" data-testid={`life-plan-${p.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm text-[color:var(--ink)]">{p.title}</span>
              <span className="badge badge-slate text-[10px]">{p.plan_type || 'nutrition'}</span>
              <span className={`badge text-[10px] ${p.status === 'active' ? 'badge-green' : 'badge-slate'}`}>
                {p.status || 'active'}
              </span>
            </div>
            {(p.summary || p.description) && (
              <p className="text-xs text-[color:var(--ink-muted)] leading-relaxed">{p.summary || p.description}</p>
            )}
            {(p.daily_calories || p.deficit_kcal || p.protein_g) && (
              <p className="text-[11px] text-[color:var(--ink-muted)] tabular-nums">
                {p.daily_calories ? `${p.daily_calories} kcal/d` : null}
                {p.daily_calories && p.deficit_kcal ? ' · ' : null}
                {p.deficit_kcal ? `déficit ${p.deficit_kcal} kcal` : null}
                {(p.daily_calories || p.deficit_kcal) && p.protein_g ? ' · ' : null}
                {p.protein_g ? `proteína ${p.protein_g} g` : null}
              </p>
            )}
          </li>
        ))}
        {!plans?.length && (
          <li className="text-sm text-[color:var(--ink-muted)]">{t('body.life_empty')}</li>
        )}
      </ul>

      <section className="crm-inset-panel space-y-3">
        <h4 className="font-display text-base text-[color:var(--ink)]">{t('body.life_submit')}</h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_type')}
            <select className="input mt-1 w-full" value={planType} onChange={(e) => setPlanType(e.target.value as any)}>
              <option value="nutrition">{t('body.life_nutrition')}</option>
              <option value="exercise">{t('body.life_exercise')}</option>
            </select>
          </label>
          <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_plan_title')}
            <input className="input mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        {planType === 'nutrition' && (
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_calories')}
              <input className="input mt-1 w-full" type="number" min={800} max={6000} value={dailyCalories}
                onChange={(e) => setDailyCalories(e.target.value)} placeholder="1800" data-testid="life-calories" />
            </label>
            <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_deficit')}
              <input className="input mt-1 w-full" type="number" min={0} max={1500} value={deficitKcal}
                onChange={(e) => setDeficitKcal(e.target.value)} placeholder="500" data-testid="life-deficit" />
            </label>
            <label className="text-xs text-[color:var(--ink-muted)]">{t('body.life_protein')}
              <input className="input mt-1 w-full" type="number" min={0} max={400} value={proteinG}
                onChange={(e) => setProteinG(e.target.value)} placeholder="120" data-testid="life-protein" />
            </label>
          </div>
        )}
        <label className="text-xs text-[color:var(--ink-muted)] block">{t('body.life_summary')}
          <textarea className="input mt-1 w-full" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <button type="button" className="btn-primary text-sm" disabled={busy} onClick={submit} data-testid="life-submit">
          {busy ? '…' : t('body.life_submit_btn')}
        </button>
        {msg && <p className="text-sm text-[color:var(--ink-muted)]">{msg}</p>}
      </section>
    </div>
  );
}
