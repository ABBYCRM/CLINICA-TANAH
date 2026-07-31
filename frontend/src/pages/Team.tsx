import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../hooks/useI18n';
import { Modal, ConfirmDialog, RowActions, FormError, FormActions } from '../components/crud';

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'accountant', 'pharmacist', 'dpo'];

export default function Team() {
  const { t, locale } = useI18n();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/api/users${showInactive ? '?include_inactive=true' : ''}`)
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [locale, showInactive]);

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
      setError(e.body?.error === 'cannot_delete_self' ? t('team.cannot_delete_self') : (e.message || t('errors.generic')));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  const roleBadge = (role: string) =>
    role === 'admin' ? 'badge-red' : role === 'doctor' ? 'badge-blue' : role === 'dpo' ? 'badge-yellow' : 'badge-slate';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#243328]">{t('team.title')}</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t('team.show_inactive')}
          </label>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary" data-testid="new-user">
            + {t('team.new_user')}
          </button>
        </div>
      </div>

      {error && <FormError message={error} />}

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-th">{t('team.full_name')}</th>
                <th className="table-th">{t('common.email')}</th>
                <th className="table-th">{t('team.role')}</th>
                <th className="table-th">{t('team.council_number')}</th>
                <th className="table-th text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.loading')}</td></tr>}
              {!loading && users.length === 0 && <tr><td colSpan={5} className="table-td text-center py-6 text-slate-400">{t('common.no_data')}</td></tr>}
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-slate-50 transition-colors ${u.active ? '' : 'opacity-50'}`}>
                  <td className="table-td font-medium">
                    {u.full_name}
                    {!u.active && <span className="ml-2 badge-slate">{t('team.inactive')}</span>}
                  </td>
                  <td className="table-td">{u.email}</td>
                  <td className="table-td"><span className={roleBadge(u.role)}>{u.role}</span></td>
                  <td className="table-td text-xs text-slate-500">{u.council_number ? `${u.council_number}${u.council_state ? `/${u.council_state}` : ''}` : '—'}</td>
                  <td className="table-td">
                    <RowActions
                      onEdit={() => { setEditing(u); setShowForm(true); }}
                      onDelete={() => setDeleting(u)}
                    />
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!initial && form.password.length < 8) { setError(t('team.password_min')); return; }
    if (form.password && form.password.length < 8) { setError(t('team.password_min')); return; }
    setSaving(true);
    const payload: any = {
      email: form.email, full_name: form.full_name, role: form.role,
      cpf: form.cpf || null, council_number: form.council_number || null, council_state: form.council_state || null,
    };
    if (form.password) payload.password = form.password;
    try {
      if (initial) await api.put(`/api/users/${initial.id}`, payload);
      else await api.post('/api/users', payload);
      onSaved();
    } catch (err: any) {
      setError(err.message || t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={initial ? `${t('crud.edit')} — ${initial.full_name}` : t('team.new_user')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <label className="label">{t('team.full_name')} *</label>
          <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required data-testid="user-name" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="label">{t('common.email')} *</label>
            <input type="email" className="input" value={form.email} onChange={(e) => set('email', e.target.value)} required />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="label">{t('team.role')} *</label>
            <select className="input" value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">{initial ? t('team.password_new_hint') : `${t('team.password')} *`}</label>
            <input type="password" className="input" autoComplete="new-password" placeholder={t('team.password_min')}
              value={form.password} onChange={(e) => set('password', e.target.value)} required={!initial} minLength={initial ? 0 : 8} />
          </div>
          <div>
            <label className="label">{t('team.cpf')}</label>
            <input className="input" maxLength={11} placeholder="12345678900" value={form.cpf}
              onChange={(e) => set('cpf', e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <label className="label">{t('team.council_number')}</label>
            <input className="input" placeholder="CRM-SP 123456" value={form.council_number} onChange={(e) => set('council_number', e.target.value)} />
          </div>
          <div>
            <label className="label">{t('team.council_state')}</label>
            <input className="input" maxLength={2} placeholder="SP" value={form.council_state}
              onChange={(e) => set('council_state', e.target.value.toUpperCase())} />
          </div>
        </div>
        <FormActions saving={saving} onCancel={onClose} />
      </form>
    </Modal>
  );
}
