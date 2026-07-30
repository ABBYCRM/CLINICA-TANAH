import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { useState } from 'react';

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, locale, setLocale, locales, localeLabels } = useI18n();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems = [
    { to: '/', label: t('nav.dashboard'), icon: '📊' },
    { to: '/patients', label: t('nav.patients'), icon: '👥' },
    { to: '/appointments', label: t('nav.appointments'), icon: '📅' },
    { to: '/encounters', label: t('nav.encounters'), icon: '🩺' },
    { to: '/prescriptions', label: t('nav.prescriptions'), icon: '💊' },
    { to: '/inventory', label: t('nav.inventory'), icon: '📦' },
    { to: '/vendors', label: t('nav.vendors'), icon: '🏢' },
    { to: '/accounting', label: t('nav.accounting'), icon: '🧾' },
    { to: '/invoices', label: t('nav.invoices'), icon: '📄' },
    { to: '/payroll', label: t('nav.payroll'), icon: '💰' },
    { to: '/whatsapp', label: t('nav.whatsapp'), icon: '💬' },
    { to: '/lgpd', label: t('nav.lgpd'), icon: '🔒' },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} transition-all bg-slate-900 text-slate-200 flex flex-col`}>
        <div className="p-4 border-b border-slate-800 flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-clinic-500 flex items-center justify-center text-white font-bold">+</div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="font-bold text-white truncate">{t('app.name')}</div>
              <div className="text-xs text-slate-400 truncate">{t('app.tagline')}</div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ${
                  isActive
                    ? 'bg-clinic-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800'
                }`
              }
            >
              <span className="text-lg">{it.icon}</span>
              {sidebarOpen && <span className="truncate">{it.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800 text-xs space-y-2">
          {sidebarOpen && (
            <>
              <div>
                <div className="text-slate-400 mb-1">{t('common.language')}</div>
                <div className="flex gap-1">
                  {locales.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLocale(l)}
                      className={`px-2 py-1 rounded text-xs ${
                        l === locale ? 'bg-clinic-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {l === 'pt-BR' ? 'PT' : l === 'es' ? 'ES' : 'EN'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800">
                <div className="text-slate-200 font-medium truncate">{user?.full_name}</div>
                <div className="text-slate-500 truncate">{user?.role}</div>
                <button onClick={handleLogout} className="mt-2 w-full text-left text-rose-400 hover:text-rose-300">
                  ↪ {t('nav.logout')}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-slate-500 hover:text-slate-700">
            ☰
          </button>
          <div className="text-sm text-slate-600">
            {t('app.address')}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
