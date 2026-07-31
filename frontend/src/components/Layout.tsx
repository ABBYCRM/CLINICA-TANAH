import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type IconProps = { className?: string };

const icon = (path: React.ReactNode) =>
  function NavIcon({ className = 'w-5 h-5' }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        {path}
      </svg>
    );
  };

const Icons = {
  dashboard: icon(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  patients: icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20v-1a5.5 5.5 0 0 1 5.5-5.5h2A5.5 5.5 0 0 1 15.5 19v1" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20v-1a5.5 5.5 0 0 0-3-4.9" /></>),
  appointments: icon(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>),
  encounters: icon(<><path d="M4.5 12.5 8 9l3 3 3.5-3.5L18 12" /><path d="M3 21h18" /><path d="M12 3v2M5.6 5.6l1.4 1.4M18.4 5.6 17 7" /></>),
  prescriptions: icon(<><path d="m10.5 20.5-7-7a4.95 4.95 0 1 1 7-7l7 7a4.95 4.95 0 1 1-7 7z" /><path d="m7 10 7 7" /></>),
  inventory: icon(<><path d="M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5A2 2 0 0 1 5 15.5v-7a2 2 0 0 1 1-1.73l6-3.5a2 2 0 0 1 2 0l6 3.5a2 2 0 0 1 1 1.73z" transform="translate(-1 0)" /><path d="M5.3 7.2 12 11l6.7-3.8M12 11v10" transform="translate(-1 0)" /></>),
  vendors: icon(<><path d="M3 21h18" /><path d="M5 21V8l7-5 7 5v13" /><path d="M9 21v-4h6v4" /><path d="M9 11h.01M15 11h.01" /></>),
  accounting: icon(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h4" /></>),
  invoices: icon(<><path d="M6 2h9l5 5v15l-2-1.5L16 22l-2-1.5L12 22l-2-1.5L8 22l-2-1.5L4 22z" transform="translate(1 -1)" /><path d="M9 8h6M9 12h6" /></>),
  payroll: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 .9-3 2.2c0 2.8 6 1.5 6 4.3 0 1.3-1.3 2.5-3 2.5s-3-1.1-3-2.5" /></>),
  whatsapp: icon(<><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" /></>),
  lgpd: icon(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>),
  team: icon(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" /><path d="M17.5 3.9a3.5 3.5 0 0 1 0 7" /></>),
  settings: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
  clinics: icon(<><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 10h.01M15 10h.01M12 10h.01" /></>),
  manual: icon(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M8 7h8M8 11h6" /></>),
};

export default function Layout() {
  const { user, logout, effectiveTenantId } = useAuth();
  const { t, locale, setLocale, locales } = useI18n();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenantLabel, setTenantLabel] = useState(user?.tenant_name || t('app.name'));

  const handleLogout = () => { logout(); navigate('/login'); };

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  useEffect(() => {
    if (!user?.is_superadmin) {
      setTenantLabel(user?.tenant_name || t('app.name'));
      return;
    }
    api.get('/api/auth/me').then((d) => {
      setTenantLabel(d.user?.effective_tenant_name || d.user?.tenant_name || t('app.name'));
    }).catch(() => setTenantLabel(user?.tenant_name || t('app.name')));
  }, [user, effectiveTenantId, t]);

  const navItems = [
    { to: '/', label: t('nav.dashboard'), Icon: Icons.dashboard },
    { to: '/patients', label: t('nav.patients'), Icon: Icons.patients },
    { to: '/appointments', label: t('nav.appointments'), Icon: Icons.appointments },
    { to: '/encounters', label: t('nav.encounters'), Icon: Icons.encounters },
    { to: '/prescriptions', label: t('nav.prescriptions'), Icon: Icons.prescriptions },
    { to: '/inventory', label: t('nav.inventory'), Icon: Icons.inventory },
    { to: '/vendors', label: t('nav.vendors'), Icon: Icons.vendors },
    { to: '/accounting', label: t('nav.accounting'), Icon: Icons.accounting },
    { to: '/invoices', label: t('nav.invoices'), Icon: Icons.invoices },
    { to: '/payroll', label: t('nav.payroll'), Icon: Icons.payroll },
    { to: '/whatsapp', label: t('nav.whatsapp'), Icon: Icons.whatsapp },
    { to: '/lgpd', label: t('nav.lgpd'), Icon: Icons.lgpd },
    { to: '/manual', label: t('nav.manual'), Icon: Icons.manual },
    ...(user?.role === 'admin' ? [{ to: '/team', label: t('nav.team'), Icon: Icons.team }] : []),
    ...(user?.role === 'admin' ? [{ to: '/settings', label: t('nav.settings'), Icon: Icons.settings }] : []),
    ...(user?.is_superadmin ? [{ to: '/clinics', label: t('nav.clinics'), Icon: Icons.clinics }] : []),
  ];

  const brand = (compact: boolean) => (
    <div className="aluminum-header shell-brand flex items-center gap-3 px-4">
      <div className="brand-medallion w-9 h-9 shrink-0">
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      {!compact && (
        <div className="overflow-hidden min-w-0">
          <div className="font-display font-semibold text-[#2a1f16] truncate tracking-tight text-[15px] leading-tight">{tenantLabel}</div>
          <div className="text-[11px] text-[#5c6570] truncate leading-tight mt-0.5">{t('app.tagline')}</div>
        </div>
      )}
    </div>
  );

  const navList = (onNavigate?: () => void, compact = false) => (
    <nav className={`flex-1 overflow-y-auto py-3 space-y-0.5 ${compact ? 'px-2' : 'px-3'}`}>
      {navItems.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          title={compact ? label : undefined}
          className={({ isActive }) =>
            `group nav-chip ${compact ? 'justify-center px-0' : ''} ${isActive ? 'menu-item-active nav-chip-active font-semibold' : 'nav-chip-idle'}`
          }
        >
          <Icon className="w-5 h-5 shrink-0 transition-transform duration-200 group-hover:scale-105" />
          {!compact && <span className="truncate">{label}</span>}
        </NavLink>
      ))}
    </nav>
  );

  const sidebarFooter = (compact: boolean) => (
    <div className="p-3 border-t border-[#1a1008] text-xs space-y-2 relative z-[1]">
      {!compact && (
        <>
          <div>
            <div className="text-[#c9b896] mb-1.5 font-semibold tracking-wide uppercase text-[10px]">{t('common.language')}</div>
            <div
              className="inline-flex rounded-xl p-0.5 border border-[#1a1008]"
              style={{
                background: 'linear-gradient(180deg, #2a1a12, #3a2618)',
                boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.45)',
              }}
            >
              {locales.map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  aria-pressed={l === locale}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    l === locale
                      ? 'text-[#2a1f16]'
                      : 'text-[#c9b896] hover:text-[#f0e2c8]'
                  }`}
                  style={l === locale
                    ? {
                        background: 'linear-gradient(160deg, #f0d48a, #d4af6a 45%, #a8843d)',
                        boxShadow: 'inset 0 1px 0 rgba(255,245,200,0.55), 0 1px 3px rgba(0,0,0,0.35)',
                      }
                    : undefined}
                >
                  {l === 'pt-BR' ? 'PT' : l === 'es' ? 'ES' : 'EN'}
                </button>
              ))}
            </div>
          </div>
          <div className="pt-2 border-t border-[#1a1008]/70">
            <div className="text-[#f0e2c8] font-semibold truncate">{user?.full_name}</div>
            <div className="text-[#c9b896] truncate capitalize">{user?.role}</div>
            <button
              onClick={handleLogout}
              className="mt-2 inline-flex items-center gap-1.5 text-[#e8b8a8] transition-colors hover:text-[#f0d0c0]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" />
              </svg>
              {t('nav.logout')}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const chromeBtn =
    'inline-flex items-center justify-center rounded-xl p-2.5 text-[#3a342c] transition-all hover:brightness-105 min-h-11 min-w-11';
  const chromeBtnStyle = {
    background: 'linear-gradient(135deg, #E5E7EB, #D1D5DB)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 4px rgba(0,0,0,0.12)',
    border: '1px solid #9CA3AF',
  } as const;

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar — leather folder */}
      <aside
        data-testid="sidebar"
        className={`${sidebarOpen ? 'w-64' : 'w-[4.5rem]'} hidden lg:flex transition-[width] duration-300 ease-fluid skeuo-sidebar flex-col shrink-0`}
      >
        {brand(!sidebarOpen)}
        {navList(undefined, !sidebarOpen)}
        {sidebarFooter(!sidebarOpen)}
      </aside>

      {/* Mobile drawer */}
      <div
        data-testid="drawer-backdrop"
        onClick={() => setMobileOpen(false)}
        className={`lg:hidden fixed inset-0 z-40 bg-[#3a342c]/45 backdrop-blur-[2px] transition-opacity duration-300 ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />
      <aside
        data-testid="mobile-drawer"
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] skeuo-sidebar flex flex-col transition-transform duration-300 ease-fluid ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!mobileOpen}
      >
        <div className="relative">
          {brand(false)}
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="absolute top-4 right-4 rounded-lg p-1.5 text-[#c9b896] transition-colors hover:bg-black/20 hover:text-[#f0e2c8]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {navList(() => setMobileOpen(false))}
        {sidebarFooter(false)}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="sticky top-0 z-30 aluminum-header shell-topbar px-4 sm:px-5 flex items-center gap-3">
          <button
            data-testid="mobile-menu-button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className={`lg:hidden ${chromeBtn}`}
            style={chromeBtnStyle}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
            className={`hidden lg:inline-flex ${chromeBtn}`}
            style={chromeBtnStyle}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-semibold text-[#3a342c] truncate leading-tight" data-testid="active-clinic">{tenantLabel}</div>
            <div className="text-xs text-[#4a453c]/90 truncate hidden sm:block leading-tight mt-0.5">{t('app.address')}</div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-5 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
