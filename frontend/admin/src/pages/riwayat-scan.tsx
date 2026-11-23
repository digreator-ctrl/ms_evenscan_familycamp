import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

const SESI_COLS: { id: string; short: string }[] = [
  { id: 'checkin', short: 'Check-in' },
  { id: 'makan_sabtu_siang', short: 'Sbt Siang' },
  { id: 'makan_sabtu_malam', short: 'Sbt Malam' },
  { id: 'makan_ahad_pagi', short: 'Ahad Pagi' },
];

function statusBayarBadge(status: string) {
  const styles: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    menunggu_pembayaran: 'bg-amber-100 text-amber-800',
    menunggu_verifikasi: 'bg-sky-100 text-sky-800',
    lunas: 'bg-emerald-100 text-emerald-800',
    ditolak: 'bg-rose-100 text-rose-800',
  };
  return styles[status] || 'bg-slate-100 text-slate-800';
}

function statusBayarLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    menunggu_pembayaran: 'Menunggu Pembayaran',
    menunggu_verifikasi: 'Menunggu Verifikasi',
    lunas: 'Lunas',
    ditolak: 'Ditolak',
  };
  return map[status] || status;
}

interface AnggotaRow {
  id: string;
  nomor_peserta: string;
  nama: string;
  peran: string;
  jenis_kelamin: string;
  usia: number | null;
  kategori_usia: string;
  kategori_usia_label: string;
  catatan_medis: string | null;
  is_gratis: number;
  makan_dicover: number;
  status_hadir: string;
  attended_at: string | null;
  grup_id: string;
  nomor_grup: string | null;
  grup_tipe: string;
  pic_nama: string;
  grup_status: string;
  scan_sesi?: Record<string, boolean>;
}

export function RiwayatScan() {
  const navigate = useNavigate();
  const [data, setData] = useState<AnggotaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fHadir, setFHadir] = useState('semua');
  const [fKategori, setFKategori] = useState('semua');
  const [fGender, setFGender] = useState('semua');
  const [fStatus, setFStatus] = useState('semua');

  const fetchAnggota = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const p = new URLSearchParams({ limit: '200' });
      if (fHadir !== 'semua') p.set('status_hadir', fHadir);
      if (fKategori !== 'semua') p.set('kategori_usia', fKategori);
      if (fGender !== 'semua') p.set('jenis_kelamin', fGender);
      if (fStatus !== 'semua') p.set('grup_status', fStatus);
      if (search.trim()) p.set('search', search.trim());

      const res = await fetch(`${API_URL}/api/admin/anggota?${p.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.data || []);
      }
    } catch (err) {
      console.error('Gagal mengambil data peserta:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnggota();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fHadir, fKategori, fGender, fStatus]);

  const handleExportCSV = () => {
    if (data.length === 0) {
      alert('Tidak ada data untuk diekspor.');
      return;
    }
    const headers = [
      'Nomor Peserta', 'Nama', 'Peran', 'Gender', 'Usia', 'Kategori', 'Grup', 'PIC',
      'Status Bayar', 'Hadir', 'Check-in', 'Sbt Siang', 'Sbt Malam', 'Ahad Pagi', 'Catatan Medis',
    ];
    const rows = data.map((d) => [
      `"${d.nomor_peserta}"`,
      `"${(d.nama || '').replace(/"/g, '""')}"`,
      `"${d.peran}"`,
      `"${d.jenis_kelamin}"`,
      d.usia ?? '',
      `"${d.kategori_usia_label}"`,
      `"${d.nomor_grup || d.grup_id}"`,
      `"${(d.pic_nama || '').replace(/"/g, '""')}"`,
      d.is_gratis ? 'Gratis' : statusBayarLabel(d.grup_status),
      d.status_hadir === 'hadir' ? 'Hadir' : 'Belum',
      d.scan_sesi?.checkin ? 'Ya' : '-',
      d.scan_sesi?.makan_sabtu_siang ? 'Ya' : '-',
      d.scan_sesi?.makan_sabtu_malam ? 'Ya' : '-',
      d.scan_sesi?.makan_ahad_pagi ? 'Ya' : '-',
      `"${(d.catatan_medis || '').replace(/"/g, '""')}"`,
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data-peserta-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Data Peserta</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Seluruh anggota Family Camp beserta status kehadiran & jatah makan per sesi.
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shadow-sm active:scale-95 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Ekspor CSV</span>
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200/90 shadow-xs flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchAnggota();
          }}
          className="relative flex-1 min-w-[180px]"
        >
          <input
            type="text"
            placeholder="Cari nama, nomor peserta, PIC..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-3 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d]"
          />
        </form>
        <select
          value={fHadir}
          onChange={(e) => setFHadir(e.target.value)}
          className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer"
        >
          <option value="semua">Semua Kehadiran</option>
          <option value="hadir">Sudah Hadir</option>
          <option value="belum_hadir">Belum Hadir</option>
        </select>
        <select
          value={fKategori}
          onChange={(e) => setFKategori(e.target.value)}
          className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer"
        >
          <option value="semua">Semua Kategori</option>
          <option value="balita">Balita (0-5)</option>
          <option value="anak">Anak (6-10)</option>
          <option value="remaja">Remaja (11-17)</option>
          <option value="dewasa">Dewasa (18-50)</option>
          <option value="lansia">Lansia (51+)</option>
        </select>
        <select
          value={fGender}
          onChange={(e) => setFGender(e.target.value)}
          className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer"
        >
          <option value="semua">Semua Gender</option>
          <option value="L">Ikhwan (L)</option>
          <option value="P">Akhwat (P)</option>
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer"
        >
          <option value="semua">Semua Status Bayar</option>
          <option value="menunggu_pembayaran">Menunggu Pembayaran</option>
          <option value="menunggu_verifikasi">Menunggu Verifikasi</option>
          <option value="lunas">Lunas</option>
          <option value="ditolak">Ditolak</option>
        </select>
        <button
          type="button"
          onClick={fetchAnggota}
          className="px-4 py-2.5 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-xl text-xs font-bold cursor-pointer"
        >
          Terapkan
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
          <div className="w-8 h-8 border-3 border-[#06305d] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-medium">Memuat data peserta...</p>
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-xs">
          <h3 className="text-sm font-bold text-slate-800 mb-1">Tidak Ada Data</h3>
          <p className="text-xs text-slate-500">Belum ada peserta yang cocok dengan filter ini.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500 font-semibold">{data.length} peserta</p>

          {/* Mobile */}
          <div className="md:hidden space-y-2.5">
            {data.map((d) => (
              <div
                key={d.id}
                onClick={() => navigate(`/peserta/anggota/${d.id}`)}
                className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs active:bg-slate-50 transition cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-mono font-black text-[#06305d]">{d.nomor_peserta}</p>
                    <h4 className="font-bold text-slate-900 text-sm truncate">{d.nama}</h4>
                    <p className="text-[11px] text-slate-500">
                      {d.peran} • {d.jenis_kelamin} • {d.usia != null ? `${d.usia} th` : '-'} • {d.kategori_usia_label}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        d.is_gratis ? 'bg-amber-100 text-amber-800' : statusBayarBadge(d.grup_status)
                      }`}
                    >
                      {d.is_gratis ? 'Gratis' : statusBayarLabel(d.grup_status)}
                    </span>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        d.status_hadir === 'hadir' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {d.status_hadir === 'hadir' ? '✓ Hadir' : 'Belum'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-slate-100">
                  {SESI_COLS.map((s) => (
                    <span
                      key={s.id}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        d.scan_sesi?.[s.id] ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-50 text-slate-400'
                      }`}
                    >
                      {d.scan_sesi?.[s.id] ? '✓' : '○'} {s.short}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Nomor</th>
                    <th className="py-3 px-4">Nama / Peserta</th>
                    <th className="py-3 px-4">Grup / PIC</th>
                    <th className="py-3 px-4 text-center">Status Bayar</th>
                    {SESI_COLS.map((s) => (
                      <th key={s.id} className="py-3 px-2 text-center">{s.short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => navigate(`/peserta/anggota/${d.id}`)}
                      className="hover:bg-slate-50/70 cursor-pointer transition"
                    >
                      <td className="py-3 px-4 font-mono font-bold text-[#06305d] whitespace-nowrap">{d.nomor_peserta}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{d.nama}</div>
                        <div className="text-[11px] text-slate-500">
                          {d.peran} • {d.jenis_kelamin} • {d.usia != null ? `${d.usia} th` : '-'} • {d.kategori_usia_label}
                          {d.catatan_medis ? ' • ⚠ medis' : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        <div className="font-semibold">{d.nomor_grup || '-'}</div>
                        <div className="text-[11px] text-slate-400">{d.pic_nama}</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            d.is_gratis ? 'bg-amber-100 text-amber-800' : statusBayarBadge(d.grup_status)
                          }`}
                        >
                          {d.is_gratis ? 'Gratis' : statusBayarLabel(d.grup_status)}
                        </span>
                      </td>
                      {SESI_COLS.map((s) => (
                        <td key={s.id} className="py-3 px-2 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${
                              d.scan_sesi?.[s.id] ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-300'
                            }`}
                          >
                            {d.scan_sesi?.[s.id] ? '✓' : '·'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
