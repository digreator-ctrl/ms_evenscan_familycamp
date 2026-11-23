import { Refine } from '@refinedev/core';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import dataProvider from '@refinedev/simple-rest';
import { Login } from './pages/login';
import { Peserta } from './pages/peserta';
import { Scanner } from './pages/scanner';
import { Dashboard } from './pages/dashboard';
import { RiwayatDetail } from './pages/riwayat-detail';
import { Pengaturan } from './pages/pengaturan';
import { KelolaAddon } from './pages/kelola-addon';
import { Keuangan } from './pages/keuangan';
import { Layout } from './components/Layout';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

function RedirectAnggota() {
  const { id } = useParams();
  return <Navigate to={`/peserta/anggota/${id}`} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Refine
        dataProvider={dataProvider(API_URL)}
        resources={[
          {
            name: 'grup',
            list: '/peserta',
          },
        ]}
      >
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/peserta" element={<Peserta />} />
            <Route path="/peserta/anggota/:id" element={<RiwayatDetail />} />
            <Route path="/kelola-addon" element={<KelolaAddon />} />
            <Route path="/keuangan" element={<Keuangan />} />
            <Route path="/scanner" element={<Scanner />} />
            <Route path="/pengaturan" element={<Pengaturan />} />
            {/* Redirect rute lama */}
            <Route path="/verifikasi" element={<Navigate to="/peserta" replace />} />
            <Route path="/riwayat-scan" element={<Navigate to="/peserta?tab=individu" replace />} />
            <Route path="/riwayat-scan/:id" element={<RedirectAnggota />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Refine>
    </BrowserRouter>
  );
}

export default App;
