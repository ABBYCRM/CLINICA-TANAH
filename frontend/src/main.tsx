import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import PatientRecord from './pages/PatientRecord';
import Appointments from './pages/Appointments';
import Encounters from './pages/Encounters';
import Prescriptions from './pages/Prescriptions';
import Inventory from './pages/Inventory';
import Vendors from './pages/Vendors';
import Accounting from './pages/Accounting';
import Invoices from './pages/Invoices';
import Payroll from './pages/Payroll';
import WhatsApp from './pages/WhatsApp';
import LGPD from './pages/LGPD';
import Team from './pages/Team';
import Settings from './pages/Settings';
import Clinics from './pages/Clinics';
import Manual from './pages/Manual';
import InstallPrompt from './components/InstallPrompt';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

// Register the service worker (auto-updates when a new build is deployed)
registerSW({ immediate: true });

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-400">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={<PatientRecord />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="encounters" element={<Encounters />} />
        <Route path="prescriptions" element={<Prescriptions />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="accounting" element={<Accounting />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="whatsapp" element={<WhatsApp />} />
        <Route path="lgpd" element={<LGPD />} />
        <Route path="team" element={<Team />} />
        <Route path="settings" element={<Settings />} />
        <Route path="clinics" element={<Clinics />} />
        <Route path="manual" element={<Manual />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <InstallPrompt />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
