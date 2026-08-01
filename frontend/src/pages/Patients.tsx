import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { ConfirmDialog, FormError } from '../components/crud';
import { PatientForm } from '../components/PatientForm';

type ViewId = 'all' | 'recent' | 'insurance' | 'upcoming' | 'inactive';

const VIEWS: ViewId[] = ['all', 'recent', 'insurance', 'upcoming', 'inactive'];
const PAGE_SIZES = [25, 50, 100];

function initials(name: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
}

function fmtDateTime(v?: string | null, locale = 'pt-BR') {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Patients() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [insurers, setInsurers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [view, setView] = useState<ViewId>('all');
  const [insurance, setInsurance] = useState('');
  const [gender, setGender] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tmr = setTimeout(() => { setSearch(searchInput); setPage(0); }, 280);
    return () => clearTimeout(tmr);
  }, [searchInput]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', String(pageSize));
    p.set('offset', String(page * pageSize));
    p.set('view', view);
    p.set('sort', sort);
    if (search) p.set('q', search);
    if (insurance) p.set('insurance', insurance);
    if (gender) p.set('gender', gender);
    if (createdFrom) p.set('created_from', createdFrom);
    if (createdTo) p.set('created_to', createdTo);
    return p.toString();
  }, [page, pageSize, view, sort, search, insurance, gender, createdFrom, createdTo]);

  const load = () => {
    setLoading(true);
    api.get(`/api/patients?${query}`)
      .then((d) => {
        setPatients(d.patients || []);
        setTotal(d.total || 0);
        setInsurers(d.insurers || []);
        setViewCounts(d.view_counts || {});
        setSelected(new Set());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [query, locale]);

  const activeFilters = [insurance, gender, createdFrom, createdTo].filter(Boolean).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const allOnPageSelected = patients.length > 0 && patients.every((p) => selected.has(p.id));

  const toggleAll = () => {
    if (allOnPageSelected) setSelected(new Set());
    else setSelected(new Set(patients.map((p) => p.id)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setInsurance('');
    setGender('');
    setCreatedFrom('');
    setCreatedTo('');
    setPage(0);
  };

  const exportCsv = () => {
    const rows = (selected.size ? patients.filter((p) => selected.has(p.id)) : patients);
    const header = ['full_name', 'email', 'phone', 'cpf', 'health_insurance', 'birth_date', 'created_at', 'owner_name'];
    const lines = [
      header.join(','),
      ...rows.map((p) => header.map((h) => `"${String(p[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pacientes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setActionsOpen(false);
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setError('');
    try {
      const res = await api.del(`/api/patients/${deleting.id}`);
      setDeleting(null);
      load();
      if (res.soft_deleted) setError(t('crud.deactivated_notice'));
    } catch (e: any) {
      setDeleting(null);
      setError(e.body?.error === 'has_clinical_records' ? t('crud.delete_error_clinical') : (e.message || t('errors.generic')));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="crm-page space-y-0" data-testid="patients-crm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
        <div>
          <h1 className="page-title">{t('patients.title')}</h1>
          <p className="page-subtitle" data-testid="patients-count">
            {total === 1 ? t('patients.record_one') : t('patients.record_many', { n: total })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button type="button" className="btn-secondary" onClick={() => setActionsOpen((v) => !v)} data-testid="patients-actions">
              {t('patients.actions')}
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {actionsOpen && (
              <div className="absolute right-0 mt-1 z-20 w-48 rounded-lg border border-[rgba(139,115,85,0.45)] py-1 animate-scale-in"
                style={{ background: 'linear-gradient(180deg, #f7f2ea, #efe6d8)', boxShadow: 'var(--shadow-menu)' }}>
                <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-[#efe6d8] text-[#2c2118]" onClick={exportCsv}>
                  {t('patients.export')}
                </button>
                <button type="button" className="w-full text-left px-3 py-2 text-sm text-[#5c4a3c] cursor-not-allowed opacity-60" disabled>
                  {t('patients.import')}
                </button>
              </div>
            )}
          </div>
          <button type="button" className="btn-secondary" onClick={exportCsv} data-testid="patients-export">
            {t('patients.export')}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="btn-primary"
            data-testid="new-patient"
          >
            {t('patients.create')}
          </button>
        </div>
      </div>

      {error && <div className="mb-3"><FormError message={error} /></div>}

      {/* Saved views */}
      <div className="crm-views flex flex-wrap items-center gap-1">
        {VIEWS.map((v) => {
          const count = viewCounts[v];
          const active = view === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => { setView(v); setPage(0); }}
              className={`crm-view-tab ${active ? 'is-active' : ''}`}
              data-testid={`patients-view-${v}`}
            >
              {t(`patients.views.${v}`)}
              {typeof count === 'number' && (
                <span className="ml-1.5 text-[11px] tabular-nums opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 py-3 border-b border-slate-200 bg-white/60">
        <select
          className="crm-filter"
          value={insurance}
          onChange={(e) => { setInsurance(e.target.value); setPage(0); }}
          data-testid="filter-insurance"
        >
          <option value="">{t('patients.filters.insurance')}</option>
          <option value="__none__">{t('patients.filters.no_insurance')}</option>
          {insurers.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select
          className="crm-filter"
          value={gender}
          onChange={(e) => { setGender(e.target.value); setPage(0); }}
          data-testid="filter-gender"
        >
          <option value="">{t('patients.filters.gender')}</option>
          <option value="F">{t('patients.gender_options.F')}</option>
          <option value="M">{t('patients.gender_options.M')}</option>
          <option value="other">{t('patients.gender_options.other')}</option>
        </select>
        <label className="crm-filter inline-flex items-center gap-1.5 !py-1.5">
          <span className="text-slate-500 text-xs whitespace-nowrap">{t('patients.filters.created_from')}</span>
          <input type="date" className="border-0 bg-transparent text-sm focus:outline-none" value={createdFrom}
            onChange={(e) => { setCreatedFrom(e.target.value); setPage(0); }} />
        </label>
        <label className="crm-filter inline-flex items-center gap-1.5 !py-1.5">
          <span className="text-slate-500 text-xs whitespace-nowrap">{t('patients.filters.created_to')}</span>
          <input type="date" className="border-0 bg-transparent text-sm focus:outline-none" value={createdTo}
            onChange={(e) => { setCreatedTo(e.target.value); setPage(0); }} />
        </label>
        {activeFilters > 0 && (
          <button type="button" className="text-sm text-clinic-700 hover:underline font-medium" onClick={clearFilters}>
            {t('patients.filters.clear')} ({activeFilters})
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <select className="crm-filter" value={sort} onChange={(e) => setSort(e.target.value)} data-testid="patients-sort">
            <option value="name">{t('patients.sort.name')}</option>
            <option value="created_desc">{t('patients.sort.created_desc')}</option>
            <option value="updated_desc">{t('patients.sort.updated_desc')}</option>
            <option value="last_activity">{t('patients.sort.last_activity')}</option>
          </select>
        </div>
      </div>

      {/* Search + table tools */}
      <div className="flex flex-wrap items-center gap-3 py-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <svg viewBox="0 0 24 24" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            className="input !pl-9"
            placeholder={t('patients.search_placeholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            data-testid="patients-search"
          />
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={exportCsv}>{t('patients.export')}</button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !rounded-lg">
        <div className="overflow-x-auto">
          <table className="w-full crm-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="table-th w-10">
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="table-th">{t('patients.col_name')}</th>
                <th className="table-th">{t('patients.email')}</th>
                <th className="table-th">{t('patients.phone')}</th>
                <th className="table-th">{t('patients.health_insurance')}</th>
                <th className="table-th">{t('patients.col_owner')}</th>
                <th className="table-th">{t('patients.col_last_activity')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr><td colSpan={8} className="table-td text-center text-slate-400 py-10">{t('common.loading')}</td></tr>
              )}
              {!loading && patients.length === 0 && (
                <tr><td colSpan={8} className="table-td text-center text-slate-400 py-10">{t('common.no_data')}</td></tr>
              )}
              {patients.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition-colors group">
                  <td className="table-td">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={p.full_name} />
                  </td>
                  <td className="table-td">
                    <Link to={`/patients/${p.id}`} className="flex items-center gap-2.5 min-w-0 group/link" data-testid={`patient-row-${p.id}`}>
                      <span className="crm-avatar shrink-0">{initials(p.full_name)}</span>
                      <span className="min-w-0">
                        <span className="block font-medium text-clinic-700 group-hover/link:underline truncate">{p.full_name}</span>
                        <span className="block text-xs text-slate-400 font-mono truncate">{p.cpf || '—'}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="table-td">
                    {p.email
                      ? <a href={`mailto:${p.email}`} className="text-clinic-700 hover:underline">{p.email}</a>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="table-td whitespace-nowrap">{p.phone || '—'}</td>
                  <td className="table-td">{p.health_insurance || <span className="text-slate-400">{t('patients.unassigned')}</span>}</td>
                  <td className="table-td">
                    {p.owner_name ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="crm-avatar !w-6 !h-6 !text-[10px]">{initials(p.owner_name)}</span>
                        <span className="truncate max-w-[120px]">{p.owner_name}</span>
                      </span>
                    ) : <span className="text-slate-400">{t('patients.unassigned')}</span>}
                  </td>
                  <td className="table-td text-slate-600 whitespace-nowrap text-xs">
                    {fmtDateTime(p.last_activity, locale)}
                    {p.upcoming_count > 0 && (
                      <span className="ml-1.5 badge-green">{p.upcoming_count}</span>
                    )}
                  </td>
                  <td className="table-td text-right">
                    <div className="inline-flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        type="button"
                        className="text-xs font-medium text-clinic-700 hover:underline px-1"
                        onClick={() => navigate(`/patients/${p.id}`)}
                      >
                        {t('patients.open')}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-slate-600 hover:underline px-1"
                        data-testid={`edit-patient-${p.id}`}
                        onClick={() => { setEditing(p); setShowForm(true); }}
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-rose-600 hover:underline px-1"
                        data-testid={`delete-patient-${p.id}`}
                        onClick={() => setDeleting(p)}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <div className="text-xs text-slate-500">
            {total === 0
              ? t('common.no_data')
              : t('patients.page_of', {
                  from: page * pageSize + 1,
                  to: Math.min((page + 1) * pageSize, total),
                  total,
                })}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}>
              {t('common.back')}
            </button>
            <span className="text-sm tabular-nums text-slate-600 px-2">
              {page + 1} / {pageCount}
            </span>
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}>
              {t('common.next')}
            </button>
            <select
              className="crm-filter !py-1.5"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{t('patients.per_page', { n })}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {showForm && (
        <PatientForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={(id) => {
            setShowForm(false);
            setEditing(null);
            if (id && !editing) navigate(`/patients/${id}`);
            else load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.full_name}
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
      {actionsOpen && (
        <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="close" onClick={() => setActionsOpen(false)} />
      )}
    </div>
  );
}

// keep list page self-contained
