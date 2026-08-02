/**
 * Searchable catalog picker — combobox + optional native select fallback.
 */
import { useMemo, useState } from 'react';
import { pickLabel, type LangLabel } from '../lib/lifestyleCatalogs';
import { useI18n } from '../hooks/useI18n';

export type CatalogItem = {
  id: string;
  labels: LangLabel;
  summary?: LangLabel;
  tags?: string[];
  category?: string;
};

type Props = {
  items: CatalogItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  placeholder?: string;
  testId?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  showSelect?: boolean;
};

export default function CatalogPicker({
  items,
  value,
  onChange,
  label,
  placeholder,
  testId = 'catalog-picker',
  allowEmpty = true,
  emptyLabel,
  showSelect = true,
}: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((it) => {
      const hay = [
        pickLabel(it.labels, locale),
        it.summary ? pickLabel(it.summary, locale) : '',
        it.category || '',
        ...(it.tags || []),
      ].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [items, query, locale]);

  const selected = items.find((i) => i.id === value) || null;

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ink-muted)]">
          {label}
        </label>
        <span className="text-[11px] text-[color:var(--ink-muted)]" data-testid={`${testId}-count`}>
          {t('body.catalog_count', { shown: filtered.length, total: items.length })}
        </span>
      </div>

      <div className="relative">
        <input
          className="input w-full"
          placeholder={placeholder || t('body.catalog_search_ph')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          data-testid={`${testId}-search`}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
        />
        {open && (
          <div
            className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-[rgba(139,115,85,0.35)] bg-[#faf6ef] shadow-lg"
            data-testid={`${testId}-results`}
            role="listbox"
          >
            {allowEmpty && (
              <button
                type="button"
                role="option"
                className="w-full text-left px-3 py-2.5 border-b border-[rgba(176,183,192,0.28)] hover:bg-[#f3eadc] text-sm text-[color:var(--ink-muted)]"
                onClick={() => pick('')}
              >
                {emptyLabel || t('body.catalog_none')}
              </button>
            )}
            {!filtered.length && (
              <p className="px-3 py-2 text-sm text-[color:var(--ink-muted)]">{t('body.catalog_empty')}</p>
            )}
            {filtered.map((item) => {
              const lab = pickLabel(item.labels, locale);
              const sum = item.summary ? pickLabel(item.summary, locale) : '';
              const selectedRow = value === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selectedRow}
                  className={`w-full text-left px-3 py-2.5 border-b border-[rgba(176,183,192,0.28)] last:border-0 hover:bg-[#f3eadc] ${
                    selectedRow ? 'bg-[#efe4d2]' : ''
                  }`}
                  onClick={() => pick(item.id)}
                  data-testid={`${testId}-option-${item.id}`}
                >
                  <span className="block text-sm font-semibold text-[color:var(--ink)]">{lab}</span>
                  {sum && <span className="block text-xs text-[color:var(--ink-muted)] mt-0.5">{sum}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showSelect && (
        <select
          className="input w-full"
          value={value}
          onChange={(e) => pick(e.target.value)}
          onFocus={() => setOpen(false)}
          data-testid={`${testId}-select`}
        >
          {allowEmpty && <option value="">{emptyLabel || t('body.catalog_none')}</option>}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {pickLabel(item.labels, locale)}
            </option>
          ))}
        </select>
      )}

      {selected?.summary && (
        <p className="text-[11px] text-[#2f6b45]" data-testid={`${testId}-selected`}>
          {pickLabel(selected.summary, locale)}
        </p>
      )}
    </div>
  );
}
