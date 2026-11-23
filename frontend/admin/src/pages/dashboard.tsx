import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface Stats {
  total: number;
  menunggu: number;
  dikonfirmasi: number;
  ditolak: number;
  hadir: number;
  sudah_hadir?: number;
  belum_hadir?: number;
  persentase_kehadiran?: number;
}

interface GrupStats {
  total_grup: number;
  menunggu_pembayaran: number;
  menunggu_verifikasi: number;
  lunas: number;
  ditolak: number;
  total_anggota: number;
  total_hadir: number;
  total_revenue: number;
}

export function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    total: 0,
    menunggu: 0,
    dikonfirmasi: 0,
    ditolak: 0,
    hadir: 0,
    sudah_hadir: 0,
    belum_hadir: 0,
    persentase_kehadiran: 0,
  });
  const [grupStats, setGrupStats] = useState<GrupStats>({
    total_grup: 0,
    menunggu_pembayaran: 0,
    menunggu_verifikasi: 0,
    lunas: 0,
    ditolak: 0,
    total_anggota: 0,
    total_hadir: 0,
    total_revenue: 0,
  });
  const [loading, setLoading] = useState(true);

  // Ambil data statistik dashboard secara real-time
  const fetchStats = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Ambil statistik Family Camp (grup + revenue)
  const fetchGrupStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/stats-grup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGrupStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch grup stats:', err);
    }
  };

  useEffect(() => {
    fetchStats(false);
    fetchGrupStats();

    // Polling background setiap 5 detik agar data selalu terbarui otomatis
    const interval = setInterval(() => {
      fetchStats(true);
      fetchGrupStats();
    }, 5000);

    const handleFocus = () => {
      fetchStats(true);
      fetchGrupStats();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Total peserta (dari tabel anggota Family Camp)
  const totalPendaftar = stats.total || 0;

  return (
    <div className="space-y-6">
      {/* Header Halaman (Tombol verifikasi dan scan dihapus agar fokus analisa data) */}
      <div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-50 text-sky-800 text-xs font-semibold mb-1 border border-sky-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live Monitoring • Realtime Sync
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Dashboard Panitia</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
          Ringkasan data pendaftaran Family Camp dan revenue.
        </p>
      </div>

      {/* ======================================================== */}
      {/* TOTAL PENDAFTAR KESELURUHAN                              */}
      {/* ======================================================== */}
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Total Pendaftar Keseluruhan
        </h2>

        <div className="bg-gradient-to-br from-[#06305d] via-[#08407c] to-[#0a529b] text-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-md relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-40 h-40 bg-white/5 rounded-full blur-2xl pointer-events-none" />
          
          <div className="relative z-10">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm sm:text-base font-bold text-sky-200 uppercase tracking-wide">
                Total Seluruh Pendaftar
              </span>
              <div className="text-2xl sm:text-4xl font-black tracking-tight text-white shrink-0">
                {loading ? '...' : totalPendaftar}
                <span className="text-xs sm:text-sm font-medium text-sky-200 ml-1.5">Peserta</span>
              </div>
            </div>
            <p className="text-xs text-sky-100/80 mt-2">
              Akumulasi seluruh pendaftar yang masuk melalui formulir registrasi online.
            </p>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* FAMILY CAMP: GRUP & REVENUE                              */}
      {/* ======================================================== */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Family Camp — Pendaftaran Grup & Revenue
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Total Grup</span>
            <span className="block text-2xl sm:text-3xl font-black text-slate-900 mt-1">
              {loading ? '...' : grupStats.total_grup}
            </span>
            <p className="text-[11px] text-slate-400 mt-1">{grupStats.total_anggota} anggota terdaftar</p>
          </div>

          <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-xs">
            <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">Menunggu Bayar</span>
            <span className="block text-2xl sm:text-3xl font-black text-amber-950 mt-1">
              {loading ? '...' : grupStats.menunggu_pembayaran}
            </span>
            <p className="text-[11px] text-amber-800/80 mt-1">Belum unggah bukti transfer</p>
          </div>

          <div className="bg-sky-50/70 border border-sky-200 rounded-2xl p-4 sm:p-5 shadow-xs">
            <span className="text-xs font-bold text-sky-900 uppercase tracking-wider">Menunggu Verifikasi</span>
            <span className="block text-2xl sm:text-3xl font-black text-sky-950 mt-1">
              {loading ? '...' : grupStats.menunggu_verifikasi}
            </span>
            <p className="text-[11px] text-sky-800/80 mt-1">Bukti transfer masuk, perlu ACC</p>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 sm:p-5 shadow-xs">
            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">Lunas</span>
            <span className="block text-2xl sm:text-3xl font-black text-emerald-950 mt-1">
              {loading ? '...' : grupStats.lunas}
            </span>
            <p className="text-[11px] text-emerald-800/80 mt-1">QR tiket telah diterbitkan</p>
          </div>
        </div>

        {/* Revenue Card */}
        <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-md relative overflow-hidden">
          <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-40 h-40 bg-white/5 rounded-full blur-2xl pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm sm:text-base font-bold text-emerald-100 uppercase tracking-wide">
                Total Revenue (Lunas)
              </span>
              <div className="text-2xl sm:text-4xl font-black tracking-tight text-white shrink-0">
                {loading ? '...' : 'Rp ' + grupStats.total_revenue.toLocaleString('id-ID')}
              </div>
            </div>
            <p className="text-xs text-emerald-100/80 mt-2">
              Akumulasi grand total seluruh grup yang sudah dikonfirmasi lunas.
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}
