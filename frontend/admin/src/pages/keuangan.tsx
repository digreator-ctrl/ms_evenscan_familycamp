import { useState, useEffect, useMemo } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface Dompet {
  id: string;
  nama: string;
  jenis: 'tunai' | 'rekening';
  nomor_rekening: string | null;
  atas_nama: string | null;
  aktif: number;
  saldo?: number;
}

interface KasPos {
  id: string;
  nama: string;
  tipe: 'pemasukan' | 'pengeluaran';
  deskripsi: string | null;
  aktif: number;
}

interface Transaksi {
  id: string;
  tipe: 'pemasukan' | 'pengeluaran';
  pos_id: string;
  dompet_id: string;
  nominal: number;
  keterangan: string | null;
  grup_id: string | null;
  tanggal: string;
  dibatalkan: number;
  reversal_of: string | null;
  pos_nama?: string;
  dompet_nama?: string;
  grup_pic?: string | null;
  nomor_grup?: string | null;
}

interface Ringkasan {
  dari: string | null;
  sampai: string | null;
  total_pemasukan: number;
  total_pengeluaran: number;
  saldo: number;
  per_dompet: Dompet[];
  per_pos: Array<{ id: string; nama: string; tipe: string; total: number }>;
}

const formatRupiah = (n: number): string => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

function formatTanggal(iso?: string | null): string {
  if (!iso) return '-';
  try {
    const s = String(iso).trim();
    const d = s.length <= 10 ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d.getTime())) return iso!;
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso!;
  }
}

type Tab = 'ringkasan' | 'transaksi' | 'lpj' | 'pengaturan';

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export function Keuangan() {
  const [tab, setTab] = useState<Tab>('ringkasan');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [dompet, setDompet] = useState<Dompet[]>([]);
  const [pos, setPos] = useState<KasPos[]>([]);
  const [transaksi, setTransaksi] = useState<Transaksi[]>([]);
  const [ringkasan, setRingkasan] = useState<Ringkasan | null>(null);

  const [fTipe, setFTipe] = useState('semua');
  const [fDompet, setFDompet] = useState('');
  const [fPos, setFPos] = useState('');
  const [fDari, setFDari] = useState('');
  const [fSampai, setFSampai] = useState('');
  const [fSearch, setFSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    tipe: 'pemasukan' as 'pemasukan' | 'pengeluaran',
    pos_id: '',
    dompet_id: '',
    nominal: '',
    keterangan: '',
    tanggal: new Date().toISOString().slice(0, 10),
  });

  const [dompetFormOpen, setDompetFormOpen] = useState(false);
  const [dompetForm, setDompetForm] = useState({
    nama: '',
    jenis: 'rekening' as 'tunai' | 'rekening',
    nomor_rekening: '',
    atas_nama: '',
  });

  const [posFormOpen, setPosFormOpen] = useState(false);
  const [posForm, setPosForm] = useState({
    nama: '',
    tipe: 'pengeluaran' as 'pemasukan' | 'pengeluaran',
    deskripsi: '',
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [dRes, pRes] = await Promise.all([
        fetch(`${API_URL}/api/keuangan/dompet?semua=1`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/keuangan/pos?semua=1`, { headers: authHeaders() }),
      ]);
      if (dRes.ok) setDompet((await dRes.json()).data || []);
      if (pRes.ok) setPos((await pRes.json()).data || []);
      await Promise.all([loadRingkasan(), loadTransaksi()]);
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', message: 'Gagal memuat data keuangan.' });
    } finally {
      setLoading(false);
    }
  };

  const queryParams = (extra: Record<string, string> = {}): string => {
    const p = new URLSearchParams();
    Object.entries(extra).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    const qs = p.toString();
    return qs ? `?${qs}` : '';
  };

  const loadRingkasan = async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/keuangan/ringkasan${queryParams({ dari: fDari, sampai: fSampai })}`,
        { headers: authHeaders() }
      );
      if (res.ok) setRingkasan(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const loadTransaksi = async () => {
    try {
      const res = await fetch(
        `${API_URL}/api/keuangan/transaksi${queryParams({
          tipe: fTipe === 'semua' ? '' : fTipe,
          dompet_id: fDompet,
          pos_id: fPos,
          dari: fDari,
          sampai: fSampai,
          search: fSearch,
        })}`,
        { headers: authHeaders() }
      );
      if (res.ok) {
        const data = await res.json();
        setTransaksi(data.data || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const refresh = async () => {
    await Promise.all([loadRingkasan(), loadTransaksi()]);
  };

  const dompetAktif = useMemo(() => dompet.filter((d) => d.aktif === 1), [dompet]);
  const posByTipe = (tipe: 'pemasukan' | 'pengeluaran') => pos.filter((p) => p.tipe === tipe && p.aktif === 1);

  const submitTransaksi = async () => {
    const nominal = parseInt(form.nominal.replace(/\D/g, ''), 10);
    if (!form.pos_id || !form.dompet_id) {
      setToast({ type: 'error', message: 'Pilih pos dan dompet terlebih dahulu.' });
      return;
    }
    if (!nominal || nominal <= 0) {
      setToast({ type: 'error', message: 'Nominal harus lebih dari 0.' });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/keuangan/transaksi`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ ...form, nominal }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', message: 'Transaksi berhasil disimpan.' });
        setFormOpen(false);
        setForm({ ...form, nominal: '', keterangan: '' });
        await refresh();
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menyimpan transaksi.' });
      }
    } catch {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan.' });
    }
  };

  const batalTransaksi = async (t: Transaksi) => {
    if (!confirm(`Batalkan transaksi "${t.keterangan || t.id}"? Jurnal pembalik akan dibuat.`)) return;
    try {
      const res = await fetch(`${API_URL}/api/keuangan/transaksi/${t.id}/batal`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', message: 'Transaksi dibatalkan.' });
        await refresh();
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal membatalkan transaksi.' });
      }
    } catch {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan.' });
    }
  };

  const submitDompet = async () => {
    if (!dompetForm.nama.trim()) {
      setToast({ type: 'error', message: 'Nama dompet wajib diisi.' });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/keuangan/dompet`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(dompetForm),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', message: 'Dompet berhasil ditambahkan.' });
        setDompetFormOpen(false);
        setDompetForm({ nama: '', jenis: 'rekening', nomor_rekening: '', atas_nama: '' });
        await loadAll();
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menambah dompet.' });
      }
    } catch {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan.' });
    }
  };

  const toggleDompetAktif = async (d: Dompet) => {
    try {
      const res = await fetch(`${API_URL}/api/keuangan/dompet/${d.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ aktif: d.aktif ? 0 : 1 }),
      });
      if (res.ok) await loadAll();
    } catch {
      setToast({ type: 'error', message: 'Gagal mengubah status dompet.' });
    }
  };

  const submitPos = async () => {
    if (!posForm.nama.trim()) {
      setToast({ type: 'error', message: 'Nama pos wajib diisi.' });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/keuangan/pos`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(posForm),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', message: 'Pos berhasil ditambahkan.' });
        setPosFormOpen(false);
        setPosForm({ nama: '', tipe: 'pengeluaran', deskripsi: '' });
        await loadAll();
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menambah pos.' });
      }
    } catch {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan.' });
    }
  };

  const togglePosAktif = async (p: KasPos) => {
    try {
      const res = await fetch(`${API_URL}/api/keuangan/pos/${p.id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ aktif: p.aktif ? 0 : 1 }),
      });
      if (res.ok) await loadAll();
    } catch {
      setToast({ type: 'error', message: 'Gagal mengubah status pos.' });
    }
  };

  const exportLPJ = async () => {
    try {
      const res = await fetch(`${API_URL}/api/keuangan/lpj${queryParams({ dari: fDari, sampai: fSampai })}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setToast({ type: 'error', message: 'Gagal mengambil data LPJ.' });
        return;
      }
      const data = await res.json();
      const rows = (data.transaksi || []) as Transaksi[];
      const header = ['Tanggal', 'Tipe', 'Pos', 'Dompet', 'Nominal', 'Grup', 'Keterangan'];
      const lines = [header.join(',')];
      for (const t of rows) {
        const cells = [
          t.tanggal,
          t.tipe,
          t.pos_nama || '',
          t.dompet_nama || '',
          String(t.nominal),
          t.grup_pic || t.nomor_grup || '',
          t.keterangan || '',
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
        lines.push(cells.join(','));
      }
      const csv = '\uFEFF' + lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lpj-keuangan-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ type: 'success', message: 'CSV LPJ berhasil diunduh.' });
    } catch {
      setToast({ type: 'error', message: 'Terjadi kesalahan saat ekspor.' });
    }
  };

  const filteredTransaksi = transaksi;

  // =========================================================================
  const TabButton = ({ id, label }: { id: Tab; label: string }) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
        tab === id ? 'bg-[#06305d] text-white shadow-xs' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Keuangan & LPJ</h1>
          <p className="text-sm text-slate-500">Buku kas pemasukan, pengeluaran, dan laporan pertanggungjawaban.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm({ ...form, pos_id: posByTipe('pemasukan')[0]?.id || '', dompet_id: dompetAktif[0]?.id || '' });
            setFormOpen(true);
          }}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 cursor-pointer"
        >
          + Catat Transaksi
        </button>
      </div>

      {/* Ringkasan kartu */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">Total Pemasukan</p>
          <p className="text-xl font-black text-emerald-800 mt-1">{formatRupiah(ringkasan?.total_pemasukan || 0)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-rose-200 shadow-xs">
          <p className="text-[11px] font-bold text-rose-700 uppercase tracking-wide">Total Pengeluaran</p>
          <p className="text-xl font-black text-rose-800 mt-1">{formatRupiah(ringkasan?.total_pengeluaran || 0)}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-[#06305d]/20 shadow-xs">
          <p className="text-[11px] font-bold text-[#06305d] uppercase tracking-wide">Saldo (periode)</p>
          <p className="text-xl font-black text-[#06305d] mt-1">{formatRupiah(ringkasan?.saldo || 0)}</p>
        </div>
      </div>

      {/* Filter tanggal global */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-xs flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Dari</span>
          <input
            type="date"
            value={fDari}
            onChange={(e) => setFDari(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Sampai</span>
          <input
            type="date"
            value={fSampai}
            onChange={(e) => setFSampai(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
          />
        </label>
        <button
          type="button"
          onClick={refresh}
          className="px-4 py-2 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-lg text-xs font-bold cursor-pointer"
        >
          Terapkan
        </button>
        {(fDari || fSampai) && (
          <button
            type="button"
            onClick={() => {
              setFDari('');
              setFSampai('');
              setTimeout(refresh, 0);
            }}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold cursor-pointer"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <TabButton id="ringkasan" label="Ringkasan Saldo" />
        <TabButton id="transaksi" label="Buku Kas" />
        <TabButton id="lpj" label="LPJ" />
        <TabButton id="pengaturan" label="Dompet & Pos" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">
          <div className="inline-block animate-spin rounded-full h-7 w-7 border-3 border-[#06305d] border-t-transparent"></div>
        </div>
      ) : tab === 'ringkasan' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
            <h2 className="text-sm font-black text-slate-900 mb-3">Saldo per Dompet</h2>
            <div className="space-y-2">
              {(ringkasan?.per_dompet || []).map((d) => (
                <div key={d.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{d.nama}</p>
                    <p className="text-[11px] text-slate-500 capitalize">
                      {d.jenis}
                      {d.nomor_rekening ? ` • ${d.nomor_rekening}` : ''}
                    </p>
                  </div>
                  <span className="font-black text-[#06305d] text-sm">{formatRupiah(d.saldo || 0)}</span>
                </div>
              ))}
              {(ringkasan?.per_dompet || []).length === 0 && (
                <p className="text-xs text-slate-400 italic">Belum ada dompet aktif.</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
            <h2 className="text-sm font-black text-slate-900 mb-3">Rekap per Pos (periode)</h2>
            <div className="space-y-1.5">
              {(ringkasan?.per_pos || []).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        p.tipe === 'pemasukan' ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <span className="text-slate-700">{p.nama}</span>
                  </span>
                  <span className={`font-bold ${p.tipe === 'pemasukan' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatRupiah(p.total)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : tab === 'transaksi' ? (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Cari keterangan / grup..."
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              className="flex-1 min-w-[160px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
            <select value={fTipe} onChange={(e) => setFTipe(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <option value="semua">Semua Tipe</option>
              <option value="pemasukan">Pemasukan</option>
              <option value="pengeluaran">Pengeluaran</option>
            </select>
            <select value={fDompet} onChange={(e) => setFDompet(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <option value="">Semua Dompet</option>
              {dompet.map((d) => (
                <option key={d.id} value={d.id}>{d.nama}</option>
              ))}
            </select>
            <select value={fPos} onChange={(e) => setFPos(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <option value="">Semua Pos</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>{p.nama}</option>
              ))}
            </select>
            <button type="button" onClick={loadTransaksi} className="px-4 py-2 bg-[#06305d] text-white rounded-lg text-xs font-bold cursor-pointer">
              Filter
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <th className="px-4 py-3">Tanggal</th>
                  <th className="px-4 py-3">Pos / Ket</th>
                  <th className="px-4 py-3">Dompet</th>
                  <th className="px-4 py-3 text-right">Nominal</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransaksi.map((t) => (
                  <tr key={t.id} className={t.dibatalkan ? 'opacity-50 line-through' : ''}>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{formatTanggal(t.tanggal)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{t.pos_nama}</div>
                      <div className="text-[11px] text-slate-500">
                        {t.keterangan || '-'}
                        {t.grup_pic ? ` • ${t.grup_pic}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t.dompet_nama}</td>
                    <td className={`px-4 py-3 text-right font-bold ${t.tipe === 'pemasukan' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {t.tipe === 'pemasukan' ? '+' : '-'} {formatRupiah(t.nominal)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!t.dibatalkan && !t.grup_id && !t.reversal_of && (
                        <button
                          type="button"
                          onClick={() => batalTransaksi(t)}
                          className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-semibold cursor-pointer"
                        >
                          Batalkan
                        </button>
                      )}
                      {t.grup_id && <span className="text-[10px] text-slate-400">via Verifikasi</span>}
                    </td>
                  </tr>
                ))}
                {filteredTransaksi.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400 italic">
                      Belum ada transaksi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'lpj' ? (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900">Laporan Pertanggungjawaban</h2>
              <p className="text-xs text-slate-500">
                Periode: {fDari ? formatTanggal(fDari) : 'awal'} – {fSampai ? formatTanggal(fSampai) : 'sekarang'}
              </p>
            </div>
            <button
              type="button"
              onClick={exportLPJ}
              className="px-4 py-2 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-lg text-xs font-bold cursor-pointer"
            >
              ⬇ Ekspor CSV
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
              <p className="text-[11px] font-bold text-emerald-700">Pemasukan</p>
              <p className="text-lg font-black text-emerald-800">{formatRupiah(ringkasan?.total_pemasukan || 0)}</p>
            </div>
            <div className="bg-rose-50 rounded-xl p-3 border border-rose-200">
              <p className="text-[11px] font-bold text-rose-700">Pengeluaran</p>
              <p className="text-lg font-black text-rose-800">{formatRupiah(ringkasan?.total_pengeluaran || 0)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[11px] font-bold text-slate-600">Saldo</p>
              <p className="text-lg font-black text-[#06305d]">{formatRupiah(ringkasan?.saldo || 0)}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Tekan "Ekspor CSV" untuk mengunduh rincian transaksi sesuai periode filter di atas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Dompet */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Dompet</h2>
              <button type="button" onClick={() => setDompetFormOpen(true)} className="text-xs font-bold text-[#06305d] hover:underline cursor-pointer">
                + Tambah
              </button>
            </div>
            <div className="space-y-2">
              {dompet.map((d) => (
                <div key={d.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <p className="font-bold text-slate-800 text-sm">
                      {d.nama}
                      {d.aktif ? '' : ' (nonaktif)'}
                    </p>
                    <p className="text-[11px] text-slate-500 capitalize">
                      {d.jenis}
                      {d.nomor_rekening ? ` • ${d.nomor_rekening}` : ''}
                      {d.atas_nama ? ` • ${d.atas_nama}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleDompetAktif(d)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    {d.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Pos */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Pos Kas</h2>
              <button type="button" onClick={() => setPosFormOpen(true)} className="text-xs font-bold text-[#06305d] hover:underline cursor-pointer">
                + Tambah
              </button>
            </div>
            {(['pemasukan', 'pengeluaran'] as const).map((tipe) => (
              <div key={tipe}>
                <p className="text-[11px] font-bold text-slate-500 uppercase mb-1">{tipe}</p>
                <div className="space-y-1.5">
                  {pos
                    .filter((p) => p.tipe === tipe)
                    .map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-xs px-2 py-1.5 bg-slate-50 rounded-lg">
                        <span className={`${p.aktif ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{p.nama}</span>
                        <button
                          type="button"
                          onClick={() => togglePosAktif(p)}
                          className="text-[10px] font-semibold text-slate-400 hover:text-slate-700 cursor-pointer"
                        >
                          {p.aktif ? 'Nonaktif' : 'Aktifkan'}
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: Transaksi */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-3">
            <h3 className="text-base font-black text-slate-900">Catat Transaksi</h3>
            <div className="grid grid-cols-2 gap-2">
              {(['pemasukan', 'pengeluaran'] as const).map((tipe) => (
                <button
                  key={tipe}
                  type="button"
                  onClick={() => setForm({ ...form, tipe, pos_id: posByTipe(tipe)[0]?.id || '' })}
                  className={`py-2 rounded-xl text-xs font-bold capitalize cursor-pointer ${
                    form.tipe === tipe ? 'bg-[#06305d] text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tipe}
                </button>
              ))}
            </div>
            <label className="block text-xs font-bold text-slate-600">
              Pos
              <select
                value={form.pos_id}
                onChange={(e) => setForm({ ...form, pos_id: e.target.value })}
                className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              >
                <option value="">-- Pilih Pos --</option>
                {posByTipe(form.tipe).map((p) => (
                  <option key={p.id} value={p.id}>{p.nama}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Dompet
              <select
                value={form.dompet_id}
                onChange={(e) => setForm({ ...form, dompet_id: e.target.value })}
                className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              >
                <option value="">-- Pilih Dompet --</option>
                {dompetAktif.map((d) => (
                  <option key={d.id} value={d.id}>{d.nama}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Nominal (Rp)
              <input
                type="text"
                inputMode="numeric"
                value={form.nominal}
                onChange={(e) => setForm({ ...form, nominal: e.target.value.replace(/\D/g, '') })}
                placeholder="0"
                className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              />
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Tanggal
              <input
                type="date"
                value={form.tanggal}
                onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              />
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Keterangan
              <textarea
                rows={2}
                value={form.keterangan}
                onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
                placeholder="Misal: Beli gas & bahan bakar"
                className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs resize-none"
              />
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setFormOpen(false)} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer">
                Batal
              </button>
              <button type="button" onClick={submitTransaksi} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Dompet */}
      {dompetFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-3">
            <h3 className="text-base font-black text-slate-900">Tambah Dompet</h3>
            <label className="block text-xs font-bold text-slate-600">
              Nama
              <input type="text" value={dompetForm.nama} onChange={(e) => setDompetForm({ ...dompetForm, nama: e.target.value })} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs" />
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Jenis
              <select value={dompetForm.jenis} onChange={(e) => setDompetForm({ ...dompetForm, jenis: e.target.value as 'tunai' | 'rekening' })} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <option value="rekening">Rekening</option>
                <option value="tunai">Tunai</option>
              </select>
            </label>
            {dompetForm.jenis === 'rekening' && (
              <>
                <label className="block text-xs font-bold text-slate-600">
                  Nomor Rekening
                  <input type="text" value={dompetForm.nomor_rekening} onChange={(e) => setDompetForm({ ...dompetForm, nomor_rekening: e.target.value })} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs" />
                </label>
                <label className="block text-xs font-bold text-slate-600">
                  Atas Nama
                  <input type="text" value={dompetForm.atas_nama} onChange={(e) => setDompetForm({ ...dompetForm, atas_nama: e.target.value })} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs" />
                </label>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setDompetFormOpen(false)} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer">Batal</button>
              <button type="button" onClick={submitDompet} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Pos */}
      {posFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-3">
            <h3 className="text-base font-black text-slate-900">Tambah Pos Kas</h3>
            <label className="block text-xs font-bold text-slate-600">
              Nama
              <input type="text" value={posForm.nama} onChange={(e) => setPosForm({ ...posForm, nama: e.target.value })} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs" />
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Tipe
              <select value={posForm.tipe} onChange={(e) => setPosForm({ ...posForm, tipe: e.target.value as 'pemasukan' | 'pengeluaran' })} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <option value="pemasukan">Pemasukan</option>
                <option value="pengeluaran">Pengeluaran</option>
              </select>
            </label>
            <label className="block text-xs font-bold text-slate-600">
              Deskripsi
              <input type="text" value={posForm.deskripsi} onChange={(e) => setPosForm({ ...posForm, deskripsi: e.target.value })} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs" />
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setPosFormOpen(false)} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer">Batal</button>
              <button type="button" onClick={submitPos} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer">Simpan</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-6 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className={`pointer-events-auto w-full max-w-sm rounded-2xl border shadow-xl p-4 flex items-start gap-3 ${
            toast.type === 'success' ? 'bg-emerald-50/95 border-emerald-200' : 'bg-rose-50/95 border-rose-200'
          }`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-white ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
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
    </div>
  );
}
