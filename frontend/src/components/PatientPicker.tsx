/**
 * Typeahead patient picker — search by name, CPF or phone.
 * Built for clinics with hundreds of patients: never dump a raw <select>.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';

export type PatientOption = {
  id: string;
  full_name: string;
  social_name?: string | null;
  cpf?: string | null;
  phone?: string | null;
  birth_date?: string | null;
};

type Props = {
  value: string;
  onChange: (id: string, patient?: PatientOption | null) => void;
  required?: boolean;
  disabled?: boolean;
  /** Prefill label when editing an existing record */
  initialLabel?: string;
  /** Optional subtitle under the field */
  hint?: string;
  testId?: string;
  allowClear?: boolean;
};

function formatCpf(cpf?: string | null) {
  if (!cpf) return '';
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function PatientPicker({
  value,
  onChange,
  required,
  disabled,
  initialLabel,
  hint,
  testId = 'patient-picker',
  allowClear = true,
}: Props) {
  const { t } = useI18n();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PatientOption[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<PatientOption | null>(
    value && initialLabel ? { id: value, full_name: initialLabel } : null,
  );

  // Keep selected chip in sync when parent resets / edits
  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;
    if (initialLabel) {
      setSelected({ id: value, full_name: initialLabel });
      return;
    }
    api.get(`/api/patients/${value}`)
      .then((d) => setSelected(d.patient))
      .catch(() => setSelected({ id: value, full_name: value }));
  }, [value, initialLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced server search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length > 0 && q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      const url = q
        ? `/api/patients?q=${encodeURIComponent(q)}&limit=12`
        : `/api/patients?limit=8`;
      api.get(url)
        .then((d) => {
          if (!cancelled) {
            setResults(d.patients || []);
            setHighlight(0);
          }
        })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q ? 220 : 0);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [query, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (p: PatientOption) => {
    setSelected(p);
    onChange(p.id, p);
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    setSelected(null);
    onChange('', null);
    setQuery('');
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) pick(results[highlight]);
    }
  };

  return (
    <div ref={rootRef} className="relative" data-testid={testId}>
      {selected && !open ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-slate-900 truncate">{selected.full_name}</div>
            <div className="text-xs text-slate-500 truncate">
              {[formatCpf(selected.cpf), selected.phone].filter(Boolean).join(' · ') || t('picker.patient_selected')}
            </div>
          </div>
          {!disabled && allowClear && (
            <button
              type="button"
              onClick={clear}
              className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-clinic-700 hover:bg-clinic-50 transition-colors"
              data-testid={`${testId}-change`}
            >
              {t('picker.change')}
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            className="input pr-10"
            value={query}
            disabled={disabled}
            required={required && !value}
            placeholder={t('picker.patient_placeholder')}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            data-testid={`${testId}-input`}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </span>
        </div>
      )}

      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}

      {open && !disabled && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 animate-fade-in"
          data-testid={`${testId}-results`}
        >
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
            {loading ? t('common.loading') : t('picker.patient_results')}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {!loading && results.length === 0 && (
              <li className="px-3 py-4 text-sm text-slate-400 text-center">{t('picker.patient_empty')}</li>
            )}
            {results.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    i === highlight ? 'bg-clinic-50' : 'hover:bg-slate-50'
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(p)}
                >
                  <div className="font-medium text-slate-900 truncate">{p.full_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {[formatCpf(p.cpf), p.phone, p.birth_date].filter(Boolean).join(' · ')}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Keep native required validation tied to hidden input */}
      <input type="hidden" value={value} required={required} readOnly data-testid={`${testId}-value`} />
    </div>
  );
}

type StaffOption = { id: string; full_name: string; role?: string; council_number?: string | null };

type StaffProps = {
  value: string;
  onChange: (id: string, user?: StaffOption | null) => void;
  roles?: string[];
  required?: boolean;
  disabled?: boolean;
  initialLabel?: string;
  testId?: string;
};

export function StaffPicker({
  value,
  onChange,
  roles = ['doctor', 'nurse', 'admin'],
  required,
  disabled,
  initialLabel,
  testId = 'staff-picker',
}: StaffProps) {
  const { t } = useI18n();
  const [users, setUsers] = useState<StaffOption[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = users.find((u) => u.id === value);

  useEffect(() => {
    api.get('/api/users/directory')
      .then((d) => setUsers((d.users || []).filter((u: any) => roles.includes(u.role))))
      .catch(console.error);
  }, [roles.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return u.full_name.toLowerCase().includes(q) || (u.council_number || '').toLowerCase().includes(q);
  });

  const label = selected?.full_name || initialLabel || '';

  return (
    <div ref={rootRef} className="relative" data-testid={testId}>
      {value && label && !open ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-slate-900 truncate">{label}</div>
            {selected?.council_number && (
              <div className="text-xs text-slate-500">{selected.council_number}</div>
            )}
          </div>
          {!disabled && (
            <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-clinic-700 hover:bg-clinic-50">
              {t('picker.change')}
            </button>
          )}
        </div>
      ) : (
        <input
          className="input"
          value={query}
          disabled={disabled}
          required={required && !value}
          placeholder={t('picker.staff_placeholder')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          data-testid={`${testId}-input`}
        />
      )}
      {open && !disabled && (
        <ul className="absolute z-40 mt-1.5 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl py-1" data-testid={`${testId}-results`}>
          {filtered.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-400 text-center">{t('common.no_data')}</li>
          )}
          {filtered.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 hover:bg-clinic-50 transition-colors"
                onClick={() => { onChange(u.id, u); setQuery(''); setOpen(false); }}
              >
                <div className="font-medium text-slate-900">{u.full_name}</div>
                <div className="text-xs text-slate-500">{[u.role, u.council_number].filter(Boolean).join(' · ')}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" value={value} required={required} readOnly />
    </div>
  );
}
