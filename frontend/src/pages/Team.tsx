import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, apiErrorKey } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'accountant', 'pharmacist', 'dpo'] as const;
const CLINICAL = new Set(['doctor', 'nurse', 'pharmacist']);
const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

function isValidCpf(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let r = (sum * 10) % 11; if (r === 10) r = 0;
  if (r !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  r = (sum * 10) % 11; if (r === 10) r = 0;
  return r === Number(d[10]);
}

export default function Team() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const isAdmin = user?.role === 'admin';

  const load = () => {
    if (!isAdmin) return;
    setLoading(true);
    setError('');
    api.get(`/api/users${showInactive ? '?include_inactive=true' : ''}`)
      .then((d) => setUsers(d.users || []))
      .catch((e) => setError(t(apiErrorKey(e))))
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale, showInactive, isAdmin]);

  if (user && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.del(`/api/users/${deleting.id}`);
      setDeleting(null);
      load();
      if (res.soft_deleted) setError(t('crud.deactivated_notice'));
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async (u: any) => {
    setError('');
    try {
      await api.put(`/api/users/${u.id}/reactivate`, {});
      load();
    } catch (e: any) {
      setError(t(apiErrorKey(e)));
    }
  };

  const roleBadge = (role: string) =>
    role === 'admin' ? 'badge-red' : role === 'doctor' ? 'badge-blue' : role === 'dpo' ? 'badge-yellow' : 'badge-slate';

  const roleLabel = (role: string) => {
    const key = `team.roles.${role}`;
    const translated = t(key);
    return translated === key ? role : translated;
  };

  return (
    <div className="space-y-4" data-testid="team-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t('team.title')}</h1>
          <p className="text-sm text-[#6b645a] mt-0.5">{t('team.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[#6b645a] cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} data-testid="show-inactive" />
            {t('team.show_inactive')}
          </label>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary whitespace-nowrap" data-testid="new-user">
            + {t('team.new_user')}
          </button>
        </div>
      </div>

      {error && <FormError message={error} />}

      <div className="card">
        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-[rgba(63,92,66,0.1)]" data-testid="team-mobile-list">
          {loading && <div className="p-6 text-center text-slate-400">{t('common.loading')}</div>}
          {!loading && users.length === 0 && <div className="p-6 text-center text-slate-400">{t('common.no_data')}</div>}
          {users.map((u) => (
            <div key={u.id} className={`p-4 space-y-2 ${u.active ? '' : 'opacity-60'}`} data-testid={`user-card-${u.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-[#3a342c] break-words">
                    {u.full_name}
                    {!u.active && <span className="ml-2 badge-slate">{t('team.inactive')}</span>}
                  </div>
                  <div className="text-sm text-[#6b645a] break-all">{u.email}</div>
                </div>
                <span className={roleBadge(u.role)}>{roleLabel(u.role)}</span>
              </div>
              <div className="text-xs text-[#7a8476] space-y-0.5">
                <div>CPF <span className="font-mono text-[#4a453c]">{u.cpf || '—'}</span></div>
                <div>{u.council_number ? `${u.council_number}${u.council_state ? `/${u.council_state}` : ''}` : '—'}</div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                {!u.active && (
                  <button type="button" className="btn-secondary text-xs" onClick={() => reactivate(u)} data-testid={`reactivate-${u.id}`}>
                    {t('team.reactivate')}
                  </button>
                )}
                <RowActions
                  onEdit={() => { setEditing(u); setShowForm(true); }}
                  onDelete={() => setDeleting(u)}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('team.full_name')}</th>
                <th className="table-th">{t('common.email')}</th>
                <th className="table-th">{t('team.cpf')}</th>
                <th className="table-th">{t('team.role')}</th>
                <th className="table-th">{t('team.council_number')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && users.length === 0 && <tr><td colSpan={6} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-slate-50 transition-colors ${u.active ? '' : 'opacity-50'}`} data-testid={`user-row-${u.id}`}>
                  <td className="table-td font-medium">
                    {u.full_name}
                    {!u.active && <span className="ml-2 badge-slate">{t('team.inactive')}</span>}
                  </td>
                  <td className="table-td">{u.email}</td>
                  <td className="table-td font-mono text-xs">{u.cpf || '—'}</td>
                  <td className="table-td"><span className={roleBadge(u.role)}>{roleLabel(u.role)}</span></td>
                  <td className="table-td text-xs text-slate-500">
                    {u.council_number ? `${u.council_number}${u.council_state ? `/${u.council_state}` : ''}` : '—'}
                  </td>
                  <td className="table-td">
                    <div className="flex items-center justify-end gap-1">
                      {!u.active && (
                        <button
                          type="button"
                          className="text-xs font-medium text-[#6B7280] hover:underline px-1.5"
                          onClick={() => reactivate(u)}
                        >
                          {t('team.reactivate')}
                        </button>
                      )}
                      <RowActions
                        onEdit={() => { setEditing(u); setShowForm(true); }}
                        onDelete={() => setDeleting(u)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <UserForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          name={`${deleting.full_name} (${deleting.email})`}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

function UserForm({ initial, onClose, onSaved }: { initial: any | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initial ? {
    email: initial.email ?? '', full_name: initial.full_name ?? '', role: initial.role ?? 'doctor',
    password: '', cpf: initial.cpf ?? '', council_number: initial.council_number ?? '', council_state: initial.council_state ?? '',
  } : {
    email: '', full_name: '', role: 'doctor', password: '', cpf: '', council_number: '', council_state: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const clinical = CLINICAL.has(form.role);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!initial && form.password.length < 8) { setError(t('team.password_min')); return; }
    if (form.password && form.password.length < 8) { setError(t('team.password_min')); return; }
    if (!isValidCpf(form.cpf)) { setError(t('errors.invalid_cpf')); return; }
    if (clinical && (!form.council_number.trim() || !form.council_state)) {
      setError(t('errors.council_required'));
      return;
    }
    setSaving(true);
    const payload: any = {
      email: form.email, full_name: form.full_name, role: form.role,
      cpf: form.cpf, council_number: form.council_number || null, council_state: form.council_state || null,
    };
    if (form.password) payload.password = form.password;
    try {
      if (initial) await api.put(`/api/users/${initial.id}`, payload);
      else await api.post('/api/users', payload);
      onSaved();
    } catch (err: any) {
      setError(t(apiErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  const roleLabel = (role: string) => {
    const key = `team.roles.${role}`;
    const translated = t(key);
    return translated === key ? role : translated;
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.full_name}` : t('team.new_user')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <p className="text-xs text-[#6b645a]">{t('team.legal_hint')}</p>
        <div>
          <label className="label">{t('team.full_name')} *</label>
          <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required data-testid="user-name" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-1">
            <label className="label">{t('common.email')} *</label>
            <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} required />
          </div>
          <div className="sm:col-span-1">
            <label className="label">{t('team.role')} *</label>
            <select className="input" value={form.role} onChange={(e) => set('role', e.target.value)} data-testid="user-role">
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">{initial ? t('team.password_new_hint') : `${t('team.password')} *`}</label>
            <input type="password" className="input" autoComplete="new-password" placeholder={t('team.password_min')}
              value={form.password} onChange={(e) => set('password', e.target.value)} required={!initial} minLength={initial ? 0 : 8} />
          </div>
          <div>
            <label className="label">{t('team.cpf')} *</label>
            <input className="input" maxLength={11} placeholder="00000000000" value={form.cpf}
              onChange={(e) => set('cpf', e.target.value.replace(/\D/g, ''))} required data-testid="user-cpf" />
          </div>
          <div>
            <label className="label">{t('team.council_number')}{clinical ? ' *' : ''}</label>
            <input className="input" placeholder="CRM / COREN / CRF" value={form.council_number}
              onChange={(e) => set('council_number', e.target.value)} required={clinical} data-testid="user-council" />
          </div>
          <div>
            <label className="label">{t('team.council_state')}{clinical ? ' *' : ''}</label>
            <select className="input" value={form.council_state} onChange={(e) => set('council_state', e.target.value)} required={clinical}>
              <option value="">—</option>
              {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
