import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface Anggota {
  id: string;
  nama: string;
  jenis_kelamin: string;
  peran: string;
  usia: number | null;
  ukuran_kaos: string | null;
  catatan_medis: string | null;
  is_gratis: number;
  qr_token: string | null;
  status_hadir: string;
  attended_at: string | null;
}

interface AddonPesanan {
  id: string;
  addon_id: string;
  nama_item: string;
  qty: number;
  harga_satuan: number;
  subtotal: number;
}

interface Grup {
  id: string;
  tipe: 'keluarga' | 'non_keluarga';
  pic_nama: string;
  pic_whatsapp: string;
  pic_email: string | null;
  jumlah_anggota: number;
  biaya_wajib: number;
  biaya_addon: number;
  kode_unik: number;
  grand_total: number;
  bukti_url: string | null;
  payment_token: string;
  status: 'draft' | 'menunggu_pembayaran' | 'menunggu_verifikasi' | 'lunas' | 'ditolak';
  alasan_tolak: string | null;
  created_at: string;
  paid_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  anggota: Anggota[];
  addons?: AddonPesanan[];
}

const formatRupiah = (n: number): string => {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
};

function formatTanggal(isoString?: string): string {
  if (!isoString) return '-';
  try {
    const s = String(isoString).trim();
    const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
    const iso = hasTz ? s : s.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    });
  } catch {
    return isoString;
  }
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 border border-slate-200',
    menunggu_pembayaran: 'bg-amber-100 text-amber-800 border border-amber-200',
    menunggu_verifikasi: 'bg-sky-100 text-sky-800 border border-sky-200',
    lunas: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    ditolak: 'bg-rose-100 text-rose-800 border border-rose-200',
  };
  return styles[status] || 'bg-slate-100 text-slate-800 border border-slate-200';
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'Draft',
    menunggu_pembayaran: 'Menunggu Pembayaran',
    menunggu_verifikasi: 'Menunggu Verifikasi',
    lunas: 'Lunas',
    ditolak: 'Ditolak',
  };
  return map[status] || status;
}

export function Verifikasi() {
  const [searchParams, setSearchParams] = useSearchParams();
  const detailId = searchParams.get('id');

  const [grup, setGrup] = useState<Grup[]>([]);
  const [filter, setFilter] = useState<string>('semua');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [waModal, setWaModal] = useState<{ waUrl: string; nama: string } | null>(null);
  const [tolakModal, setTolakModal] = useState<Grup | null>(null);
  const [tolakAlasan, setTolakAlasan] = useState('');
  const [hapusModal, setHapusModal] = useState<Grup | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    fetchGrup(false);
    const interval = setInterval(() => fetchGrup(true), 5000);
    const handleFocus = () => fetchGrup(true);
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const fetchGrup = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/grup`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGrup(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch grup:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchGrupDetail = async (id: string): Promise<Grup | null> => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/grup/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        return data.data as Grup;
      }
    } catch (err) {
      console.error('Failed to fetch detail grup:', err);
    }
    return null;
  };

  const handleKonfirmasi = async (g: Grup) => {
    setActionLoading(g.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/grup/${g.id}/konfirmasi`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchGrup(true);
        if (data.wa_url) {
          setWaModal({ waUrl: data.wa_url, nama: g.pic_nama });
        } else {
          setToast({ type: 'success', message: 'Pendaftaran grup berhasil dikonfirmasi (Lunas).' });
        }
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal mengonfirmasi grup.' });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan saat mengonfirmasi grup.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleTolak = (g: Grup) => {
    setTolakAlasan('');
    setTolakModal(g);
  };

  const submitTolak = async () => {
    if (!tolakModal) return;
    const alasan = tolakAlasan.trim();
    if (!alasan) {
      setToast({ type: 'error', message: 'Alasan penolakan wajib diisi.' });
      return;
    }

    setActionLoading(tolakModal.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/grup/${tolakModal.id}/tolak`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alasan }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchGrup(true);
        setToast({ type: 'success', message: 'Pendaftaran grup berhasil ditolak.' });
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menolak grup.' });
      }
      setTolakModal(null);
      setTolakAlasan('');
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan saat menolak grup.' });
    } finally {
      setActionLoading(null);
    }
  };

  const confirmHapus = async () => {
    if (!hapusModal) return;
    setActionLoading(hapusModal.id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/grup/${hapusModal.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchGrup(true);
        setSearchParams({});
        setToast({ type: 'success', message: `Data grup "${hapusModal.pic_nama}" berhasil dihapus.` });
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menghapus grup.' });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan saat menghapus data.' });
    } finally {
      setActionLoading(null);
      setHapusModal(null);
    }
  };

  const renderModals = () => (
    <>
      {waModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-emerald-100 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-base font-black text-slate-900 mb-1.5">Pembayaran Dikonfirmasi!</h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              Grup <strong className="text-slate-800">{waModal.nama}</strong> berhasil dikonfirmasi LUNAS. Kirim
              tiket QR ke WhatsApp PIC sekarang?
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setWaModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition active:scale-95 cursor-pointer"
              >
                Nanti
              </button>
              <button
                type="button"
                onClick={() => {
                  window.open(waModal.waUrl, '_blank');
                  setWaModal(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm active:scale-95 cursor-pointer"
              >
                Buka WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {tolakModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-rose-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-black text-slate-900">Tolak Pendaftaran Grup</h3>
                <p className="text-xs text-slate-500 truncate">
                  PIC: <span className="font-bold text-slate-700">{tolakModal.pic_nama}</span>
                </p>
              </div>
            </div>

            <label className="block text-xs font-bold text-slate-700 mb-1.5">Alasan Penolakan</label>
            <textarea
              rows={3}
              value={tolakAlasan}
              onChange={(e) => setTolakAlasan(e.target.value)}
              placeholder="Tuliskan alasan penolakan pembayaran..."
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 resize-none"
            />

            <div className="flex gap-2.5 mt-4">
              <button
                type="button"
                onClick={() => {
                  setTolakModal(null);
                  setTolakAlasan('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition active:scale-95 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={submitTolak}
                disabled={actionLoading === tolakModal.id}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                Tolak
              </button>
            </div>
          </div>
        </div>
      )}

      {hapusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 text-center">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </div>
            <h3 className="text-base font-black text-slate-900 mb-1.5">Hapus Grup?</h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              Hapus data grup <strong className="text-slate-800">{hapusModal.pic_nama}</strong> beserta seluruh
              anggota & add-on? Tindakan ini tidak dapat dipulihkan.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setHapusModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition active:scale-95 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmHapus}
                disabled={actionLoading === hapusModal.id}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {actionLoading === hapusModal.id ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-6 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div
            className={`pointer-events-auto w-full max-w-sm rounded-2xl border shadow-xl shadow-slate-900/10 p-4 flex items-start gap-3 backdrop-blur-sm ${
              toast.type === 'success' ? 'bg-emerald-50/95 border-emerald-200' : 'bg-rose-50/95 border-rose-200'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-white ${
                toast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            >
              {toast.type === 'success' ? '✓' : '!'}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-black ${toast.type === 'success' ? 'text-emerald-900' : 'text-rose-900'}`}>
                {toast.type === 'success' ? 'Berhasil' : 'Gagal'}
              </p>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{toast.message}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // =========================================================================
  // VIEW: DETAIL GRUP (list anggota + add-on + bukti transfer + tindakan)
  // =========================================================================
  if (detailId) {
    const selectedGrup = grup.find((g) => g.id === detailId) || null;

    return (
      <DetailGrupView
        detailId={detailId}
        selectedGrup={selectedGrup}
        loading={loading}
        actionLoading={actionLoading}
        onBack={() => setSearchParams({})}
        onKonfirmasi={handleKonfirmasi}
        onTolak={handleTolak}
        onHapus={(g) => setHapusModal(g)}
        onRefreshDetail={async (id) => {
          const d = await fetchGrupDetail(id);
          if (d) {
            setGrup((prev) => prev.map((x) => (x.id === id ? d : x)));
          }
        }}
        renderModals={renderModals}
      />
    );
  }

  // =========================================================================
  // VIEW: DAFTAR GRUP
  // =========================================================================
  const filtered = grup.filter((g) => {
    const matchFilter = filter === 'semua' || g.status === filter;
    const q = search.toLowerCase();
    const matchSearch =
      search === '' ||
      g.pic_nama.toLowerCase().includes(q) ||
      g.pic_whatsapp.includes(q) ||
      g.id.toLowerCase().includes(q) ||
      (g.pic_email || '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Verifikasi Pendaftaran Family Camp</h1>
          <p className="text-sm text-slate-500">
            Tinjau pendaftaran per grup/keluarga, verifikasi bukti transfer, dan terbitkan tiket QR.
          </p>
        </div>
      </div>

      {/* SEARCH & FILTER BAR */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200/90 shadow-xs flex flex-row items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-0">
          <svg
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Cari nama PIC, WhatsApp, ID grup..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
          />
        </div>

        <div className="shrink-0 relative">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="appearance-none pl-8 pr-8 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 transition"
            title="Filter Status"
          >
            <option value="semua">Semua Status ({grup.length})</option>
            <option value="menunggu_pembayaran">Menunggu Pembayaran ({grup.filter((g) => g.status === 'menunggu_pembayaran').length})</option>
            <option value="menunggu_verifikasi">Menunggu Verifikasi ({grup.filter((g) => g.status === 'menunggu_verifikasi').length})</option>
            <option value="lunas">Lunas ({grup.filter((g) => g.status === 'lunas').length})</option>
            <option value="ditolak">Ditolak ({grup.filter((g) => g.status === 'ditolak').length})</option>
          </select>
          <svg
            className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <svg
            className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-slate-400 space-y-2">
            <div className="inline-block animate-spin rounded-full h-7 w-7 border-3 border-[#06305d] border-t-transparent"></div>
            <p className="text-xs font-medium">Memuat data grup...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400 space-y-1">
            <p className="text-2xl">🏕️</p>
            <p className="text-sm font-semibold text-slate-700">Tidak ada pendaftaran grup ditemukan</p>
            <p className="text-xs">Coba sesuaikan kata kunci pencarian atau filter status.</p>
          </div>
        ) : (
          <>
            {/* MOBILE */}
            <div className="md:hidden divide-y divide-slate-100">
              {filtered.map((g) => (
                <div
                  key={g.id}
                  onClick={() => setSearchParams({ id: g.id })}
                  className="p-3.5 sm:p-4 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-slate-900 text-sm truncate group-hover:text-[#06305d] transition">
                        {g.pic_nama}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {g.tipe === 'keluarga' ? '👨‍👩‍👧 Keluarga' : '👥 Non-Keluarga'} • {g.jumlah_anggota} anggota
                      </p>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">{formatRupiah(g.grand_total)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadge(g.status)}`}>
                        {statusLabel(g.status)}
                      </span>
                      <svg
                        className="w-4 h-4 text-slate-400 group-hover:text-[#06305d] transition shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* DESKTOP */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="px-5 py-3.5">PIC / Grup</th>
                    <th className="px-5 py-3.5">Tipe</th>
                    <th className="px-5 py-3.5">Anggota</th>
                    <th className="px-5 py-3.5">Grand Total</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filtered.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-5 py-3.5">
                        <div className="font-semibold text-slate-900">{g.pic_nama}</div>
                        <div className="text-[11px] font-normal text-slate-400 font-mono">{g.id}</div>
                        <div className="text-[11px] font-normal text-slate-400">{g.pic_whatsapp}</div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {g.tipe === 'keluarga' ? 'Keluarga' : 'Non-Keluarga'}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">{g.jumlah_anggota} orang</td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">{formatRupiah(g.grand_total)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold ${statusBadge(g.status)}`}>
                          {statusLabel(g.status)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSearchParams({ id: g.id })}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition cursor-pointer flex items-center gap-1"
                          >
                            <span>👁️</span>
                            <span>Detail</span>
                          </button>
                          {g.status === 'menunggu_verifikasi' && (
                            <>
                              <button
                                type="button"
                                disabled={actionLoading === g.id}
                                onClick={() => handleKonfirmasi(g)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-lg text-[11px] font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                              >
                                {actionLoading === g.id ? '...' : '✓ Lunas'}
                              </button>
                              <button
                                type="button"
                                disabled={actionLoading === g.id}
                                onClick={() => handleTolak(g)}
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-semibold transition disabled:opacity-50 cursor-pointer"
                              >
                                ✕ Tolak
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            title="Hapus Data"
                            disabled={actionLoading === g.id}
                            onClick={() => setHapusModal(g)}
                            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg text-[11px] transition disabled:opacity-50 cursor-pointer"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {renderModals()}
    </div>
  );
}

// =========================================================================
// KOMPONEN: Detail Grup
// =========================================================================
function DetailGrupView(props: {
  detailId: string;
  selectedGrup: Grup | null;
  loading: boolean;
  actionLoading: string | null;
  onBack: () => void;
  onKonfirmasi: (g: Grup) => void;
  onTolak: (g: Grup) => void;
  onHapus: (g: Grup) => void;
  onRefreshDetail: (id: string) => void;
  renderModals: () => JSX.Element;
}) {
  const { detailId, selectedGrup, loading, actionLoading, onBack, onKonfirmasi, onTolak, onHapus, onRefreshDetail, renderModals } = props;

  useEffect(() => {
    if (detailId) onRefreshDetail(detailId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  if (loading && !selectedGrup) {
    return (
      <div className="py-24 text-center text-slate-400 space-y-3">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-[#06305d] border-t-transparent"></div>
        <p className="text-xs font-semibold text-slate-600">Memuat detail grup...</p>
      </div>
    );
  }

  if (!selectedGrup) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center space-y-4 max-w-lg mx-auto my-12 shadow-sm">
        <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center text-2xl mx-auto">⚠️</div>
        <h2 className="text-lg font-black text-slate-900">Data Grup Tidak Ditemukan</h2>
        <p className="text-xs text-slate-500">
          Grup dengan ID <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{detailId}</code> tidak
          ditemukan atau telah dihapus.
        </p>
        <div>
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2.5 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer inline-flex items-center gap-1.5"
          >
            <span>←</span>
            <span>Kembali ke Verifikasi</span>
          </button>
        </div>
      </div>
    );
  }

  const g = selectedGrup;

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 active:scale-95 text-slate-700 border border-slate-200/90 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Kembali ke Verifikasi</span>
        </button>
      </div>

      {/* HEADER */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-slate-200/90 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h1 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight">
                {g.pic_nama}
              </h1>
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold uppercase ${statusBadge(g.status)}`}>
                {statusLabel(g.status)}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              ID: {g.id} • {g.tipe === 'keluarga' ? 'Keluarga' : 'Non-Keluarga'} • Terdaftar: {formatTanggal(g.created_at)}
            </p>
          </div>

          <div className="flex items-center justify-end shrink-0">
            <button
              type="button"
              disabled={actionLoading === g.id}
              onClick={() => onHapus(g)}
              className="px-4 py-2 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
            >
              <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              <span>Hapus Data</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* KIRI: Info grup + anggota + addon */}
        <div className="lg:col-span-7 space-y-4">
          {/* Info PIC & Biaya */}
          <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#06305d]"></span>
                <span>Informasi Penanggung Jawab & Rincian Biaya</span>
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5 text-xs">
              <div>
                <span className="text-slate-400 font-semibold block text-[11px]">Nama PIC</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{g.pic_nama}</p>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block text-[11px]">Nomor WhatsApp</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="font-mono font-bold text-slate-800 text-sm">{g.pic_whatsapp}</p>
                  <a
                    href={`https://wa.me/${g.pic_whatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-emerald-600 hover:text-emerald-700 font-bold hover:underline"
                  >
                    Chat WA ↗
                  </a>
                </div>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block text-[11px]">Email</span>
                <p className="font-semibold text-slate-700 text-xs mt-0.5 truncate">{g.pic_email || '-'}</p>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block text-[11px]">Total Anggota</span>
                <p className="font-bold text-slate-800 mt-0.5">{g.jumlah_anggota} orang</p>
              </div>

              <div className="sm:col-span-2 mt-2 border-t border-slate-100 pt-3 grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-400 font-semibold block text-[11px]">Biaya Wajib</span>
                  <p className="font-bold text-slate-800 mt-0.5">{formatRupiah(g.biaya_wajib)}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block text-[11px]">Biaya Add-on</span>
                  <p className="font-bold text-slate-800 mt-0.5">{formatRupiah(g.biaya_addon)}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block text-[11px]">Kode Unik</span>
                  <p className="font-bold text-slate-800 mt-0.5">{g.kode_unik}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold block text-[11px]">Grand Total</span>
                  <p className="font-black text-[#06305d] text-sm mt-0.5">{formatRupiah(g.grand_total)}</p>
                </div>
              </div>
            </div>

            {g.status === 'ditolak' && g.alasan_tolak && (
              <div className="bg-rose-50/90 border border-rose-200 p-3.5 rounded-2xl mt-2">
                <div className="flex items-center gap-1.5 text-rose-800 font-bold text-xs mb-0.5">
                  <span>⚠️</span>
                  <span>Alasan Penolakan:</span>
                </div>
                <p className="text-xs text-rose-700 leading-relaxed font-medium">{g.alasan_tolak}</p>
              </div>
            )}
          </div>

          {/* Daftar Anggota */}
          <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                <span>Daftar Anggota ({g.anggota.length})</span>
              </h2>
            </div>

            <div className="space-y-2.5">
              {g.anggota.map((a, idx) => (
                <div key={a.id} className="flex items-start justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 text-sm">{a.nama}</span>
                      <span className="inline-block px-2 py-0.5 rounded-full bg-[#06305d]/10 text-[#06305d] text-[10px] font-bold">{a.peran}</span>
                      {a.is_gratis === 1 && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">GRATIS (balita)</span>
                      )}
                      {a.status_hadir === 'hadir' && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">✓ Hadir</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.jenis_kelamin} • {a.usia != null ? `${a.usia} th` : '-'}
                      {a.ukuran_kaos ? ` • Kaos ${a.ukuran_kaos}` : ''}
                    </p>
                    {a.catatan_medis && (
                      <p className="text-[11px] text-rose-600 mt-0.5 italic">Medis: {a.catatan_medis}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-slate-400 font-mono">#{idx + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* KANAN: Bukti transfer + Add-on */}
        <div className="lg:col-span-5 space-y-4">
          {/* Bukti transfer */}
          <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-black text-slate-900">Bukti Transfer</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Verifikasi kesesuaian nominal transfer</p>
              </div>
              {g.bukti_url && (
                <a
                  href={`${API_URL}${g.bukti_url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-[#06305d] border border-slate-200 rounded-lg text-[11px] font-bold transition inline-flex items-center gap-1 shadow-2xs"
                >
                  <span>Buka Penuh</span>
                  <span>↗</span>
                </a>
              )}
            </div>

            {g.bukti_url ? (
              <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 flex items-center justify-center p-2 min-h-[200px] max-h-[360px]">
                <img
                  src={`${API_URL}${g.bukti_url}`}
                  alt="Bukti Transfer"
                  className="max-h-[330px] max-w-full rounded-xl object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                    const parent = (e.target as HTMLElement).parentElement;
                    if (parent) {
                      parent.innerHTML = '<p class="text-xs text-slate-400 p-8 text-center">Gambar bukti transfer tidak dapat dimuat.</p>';
                    }
                  }}
                />
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl text-center">
                Peserta belum mengunggah bukti transfer.
              </p>
            )}
          </div>

          {/* Add-on */}
          <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-3">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>Item Add-on ({g.addons?.length || 0})</span>
              </h2>
            </div>

            {g.addons && g.addons.length > 0 ? (
              <div className="space-y-2">
                {g.addons.map((add) => (
                  <div key={add.id} className="flex items-center justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                    <div>
                      <p className="font-bold text-slate-800">{add.nama_item}</p>
                      <p className="text-slate-500">{add.qty} × {formatRupiah(add.harga_satuan)}</p>
                    </div>
                    <span className="font-black text-slate-800">{formatRupiah(add.subtotal)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic bg-slate-50 p-3 rounded-xl text-center">
                Tidak ada item add-on yang dipesan.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tindakan */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            <span>Tindakan Verifikasi Panitia</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Tinjau bukti transfer lalu konfirmasi lunas untuk menerbitkan QR seluruh anggota, atau tolak.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {g.status === 'menunggu_verifikasi' && (
            <>
              <button
                type="button"
                disabled={actionLoading === g.id}
                onClick={() => onKonfirmasi(g)}
                className="flex-1 min-w-[160px] px-5 py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span>{actionLoading === g.id ? 'Memproses...' : 'Konfirmasi Lunas & Terbitkan QR'}</span>
              </button>

              <button
                type="button"
                disabled={actionLoading === g.id}
                onClick={() => onTolak(g)}
                className="px-5 py-3 bg-rose-50 hover:bg-rose-100 active:scale-98 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Tolak</span>
              </button>
            </>
          )}

          {g.status === 'lunas' && (
            <div className="w-full bg-emerald-50/90 border border-emerald-200 p-3.5 rounded-2xl text-xs">
              <span className="text-emerald-900 font-bold flex items-center gap-1.5">
                <span>✅</span>
                <span>Pembayaran telah dikonfirmasi LUNAS. QR tiket seluruh anggota telah diterbitkan.</span>
              </span>
              {g.confirmed_at && (
                <p className="text-emerald-700 mt-0.5">
                  Dikonfirmasi oleh {g.confirmed_by || 'Panitia'} pada {formatTanggal(g.confirmed_at)}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onBack}
            className="px-5 py-3 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Kembali ke Daftar
          </button>
        </div>
      </div>

      {renderModals()}
    </div>
  );
}
