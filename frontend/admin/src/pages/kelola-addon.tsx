import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface AddonItem {
  id: string;
  nama: string;
  deskripsi: string;
  harga: number;
  stok: number;
  aktif: number;
  urutan: number;
  kategori?: string;
  fasilitas?: string;
  created_at?: string;
}

type StatusFilter = 'all' | 'aktif' | 'nonaktif';
type SortOption = 'urutan' | 'harga_asc' | 'harga_desc' | 'nama_asc';

const formatRupiah = (n: number): string => {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
};

const parseFasilitasList = (fasilitas?: string): string[] => {
  if (!fasilitas) return [];
  return fasilitas
    .split('|')
    .map((f) => f.trim())
    .filter(Boolean);
};

const formatKelengkapanText = (item: AddonItem): string => {
  const list = parseFasilitasList(item.fasilitas);
  if (list.length > 0) return list.join(' • ');
  return item.deskripsi || 'Belum ada keterangan kelengkapan';
};

const emptyForm = {
  nama: '',
  deskripsi: '',
  harga: '',
  stok: '-1',
  aktif: '1',
  urutan: '0',
  fasilitas: '',
};

export function KelolaAddon() {
  const [searchParams, setSearchParams] = useSearchParams();
  const detailId = searchParams.get('id');

  const [items, setItems] = useState<AddonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Filter & Sort (via popup modal agar layout tidak bergeser)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('urutan');
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<StatusFilter>('all');
  const [draftSort, setDraftSort] = useState<SortOption>('urutan');

  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<AddonItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchItems = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/addon-items`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch addon items:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems(false);
  }, []);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setEditingId(null);
    setFormError('');
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const startEdit = (item: AddonItem) => {
    setEditingId(item.id);
    setForm({
      nama: item.nama,
      deskripsi: item.deskripsi || '',
      harga: String(item.harga),
      stok: String(item.stok),
      aktif: String(item.aktif),
      urutan: String(item.urutan || 0),
      fasilitas: item.fasilitas || '',
    });
    setFormError('');
    setShowForm(true);
  };

  const openFilterModal = () => {
    setDraftStatus(statusFilter);
    setDraftSort(sortBy);
    setFilterModalOpen(true);
  };

  const applyFilterModal = () => {
    setStatusFilter(draftStatus);
    setSortBy(draftSort);
    setFilterModalOpen(false);
  };

  const resetFilterModal = () => {
    setDraftStatus('all');
    setDraftSort('urutan');
    setStatusFilter('all');
    setSortBy('urutan');
    setFilterModalOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const nama = form.nama.trim();
    const harga = parseInt(form.harga, 10);
    const stok = parseInt(form.stok, 10);
    const aktif = parseInt(form.aktif, 10);
    const urutan = parseInt(form.urutan, 10);

    if (!nama) {
      setFormError('Nama paket wajib diisi.');
      return;
    }
    if (isNaN(harga) || harga < 0) {
      setFormError('Harga wajib berupa angka positif.');
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const payload = {
        nama,
        deskripsi: form.deskripsi.trim(),
        harga,
        stok: isNaN(stok) ? -1 : stok,
        aktif: aktif === 0 ? 0 : 1,
        urutan: isNaN(urutan) ? 0 : urutan,
        kategori: 'paket',
        fasilitas: form.fasilitas.trim(),
      };

      const url = editingId
        ? `${API_URL}/api/admin/addon-items/${editingId}`
        : `${API_URL}/api/admin/addon-items`;
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({
          type: 'success',
          message: editingId ? 'Paket add-on berhasil diperbarui.' : 'Paket add-on baru berhasil ditambahkan.',
        });
        resetForm();
        setShowForm(false);
        await fetchItems(true);
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menyimpan paket add-on.' });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan saat menyimpan.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleAktif = async (item: AddonItem) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/addon-items/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ aktif: item.aktif === 1 ? 0 : 1 }),
      });
      if (res.ok) {
        await fetchItems(true);
        setToast({
          type: 'success',
          message: `Paket "${item.nama}" ${item.aktif === 1 ? 'dinonaktifkan' : 'diaktifkan'} pada halaman pendaftaran.`,
        });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Gagal mengubah status paket.' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/admin/addon-items/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast({ type: 'success', message: `Paket "${deleteTarget.nama}" berhasil dihapus.` });
        const deletedId = deleteTarget.id;
        await fetchItems(true);
        if (editingId === deletedId) resetForm();
        if (detailId === deletedId) setSearchParams({});
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menghapus paket.' });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan saat menghapus.' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Hanya tampilkan produk paketan (produk satuan ditiadakan)
  const paketItems = useMemo(() => {
    return items.filter((it) => it.kategori === 'paket');
  }, [items]);

  const filtered = useMemo(() => {
    const list = paketItems.filter((it) => {
      if (statusFilter === 'aktif' && it.aktif !== 1) return false;
      if (statusFilter === 'nonaktif' && it.aktif !== 0) return false;
      const q = search.toLowerCase().trim();
      if (!q) return true;
      return (
        it.nama.toLowerCase().includes(q) ||
        (it.deskripsi || '').toLowerCase().includes(q) ||
        (it.fasilitas || '').toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'harga_asc') return a.harga - b.harga;
      if (sortBy === 'harga_desc') return b.harga - a.harga;
      if (sortBy === 'nama_asc') return a.nama.localeCompare(b.nama, 'id');
      return (a.urutan || 0) - (b.urutan || 0);
    });
  }, [paketItems, statusFilter, search, sortBy]);

  const detailItem = useMemo(() => {
    if (!detailId) return null;
    return paketItems.find((it) => it.id === detailId) || null;
  }, [paketItems, detailId]);

  const hasActiveFilter = statusFilter !== 'all' || sortBy !== 'urutan';

  return (
    <div className="space-y-4 sm:space-y-5">
      {detailId ? (
        /* HALAMAN DETAIL PRODUK PAKET */
        <div className="space-y-4">
          <div>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 shadow-xs transition active:scale-95 cursor-pointer"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Kembali</span>
            </button>
          </div>

          {loading ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs text-center py-16 text-slate-400 space-y-2">
              <div className="inline-block animate-spin rounded-full h-7 w-7 border-3 border-[#06305d] border-t-transparent"></div>
              <p className="text-xs font-medium">Memuat detail paket...</p>
            </div>
          ) : !detailItem ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs text-center py-12 px-4 space-y-3">
              <p className="text-sm font-bold text-slate-800">Paket tidak ditemukan</p>
              <button
                type="button"
                onClick={() => setSearchParams({})}
                className="px-4 py-2 rounded-xl bg-[#06305d] text-white text-xs font-bold cursor-pointer"
              >
                Kembali ke Daftar
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5">
              {/* Header Detail */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="min-w-0">
                  <span className="inline-block px-2 py-0.5 rounded-md bg-violet-100 text-violet-700 border border-violet-200 text-[10px] font-bold uppercase tracking-wider">
                    Paket Sewa
                  </span>
                  <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1.5 leading-snug">
                    {detailItem.nama}
                  </h1>
                  {detailItem.deskripsi && (
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{detailItem.deskripsi}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                    detailItem.aktif === 1
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {detailItem.aktif === 1 ? 'Aktif' : 'Nonaktif'}
                </span>
              </div>

              {/* Ringkasan Harga, Stok, Urutan */}
              <div className="grid grid-cols-12 gap-2.5">
                <div className="col-span-6 sm:col-span-4 bg-slate-50 rounded-2xl p-3 border border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Harga Paket</p>
                  <p className="text-base font-black text-[#06305d] mt-0.5">{formatRupiah(detailItem.harga)}</p>
                </div>
                <div className="col-span-3 sm:col-span-4 bg-slate-50 rounded-2xl p-3 border border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stok</p>
                  <p className="text-base font-black text-slate-800 mt-0.5">
                    {detailItem.stok === -1 ? 'Unlimited' : detailItem.stok}
                  </p>
                </div>
                <div className="col-span-3 sm:col-span-4 bg-slate-50 rounded-2xl p-3 border border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Urutan</p>
                  <p className="text-base font-black text-slate-800 mt-0.5">#{detailItem.urutan}</p>
                </div>
              </div>

              {/* Kelengkapan Paket */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Kelengkapan / Fasilitas Paket
                </p>
                {parseFasilitasList(detailItem.fasilitas).length > 0 ? (
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {parseFasilitasList(detailItem.fasilitas).map((fas, idx) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs font-semibold text-slate-700"
                      >
                        <span className="w-2 h-2 rounded-full bg-[#06305d] shrink-0" />
                        <span>{fas}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400 italic">Belum ada rincian kelengkapan yang ditambahkan.</p>
                )}
              </div>

              {/* Status Tampil di FE Peserta */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600">
                Status di form pendaftaran peserta:{' '}
                <strong className={detailItem.aktif === 1 ? 'text-emerald-700' : 'text-slate-600'}>
                  {detailItem.aktif === 1 ? 'Ditampilkan & dapat dipilih peserta' : 'Disembunyikan dari peserta'}
                </strong>
              </div>

              {/* Tombol Aksi */}
              <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => toggleAktif(detailItem)}
                  className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer ${
                    detailItem.aktif === 1
                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {detailItem.aktif === 1 ? 'Nonaktifkan di Pendaftaran' : 'Aktifkan di Pendaftaran'}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(detailItem)}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  Edit Paket
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(detailItem)}
                  className="py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  Hapus
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* HALAMAN DAFTAR PAKET ADD-ON */
        <>
          <div className="space-y-2.5">
            <Link
              to="/pengaturan"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 shadow-xs transition active:scale-95"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Kembali</span>
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Kelola Add-on</h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Kelola paket sewa perlengkapan yang tampil pada formulir pendaftaran peserta.
              </p>
            </div>
          </div>

          {/* TOOLBAR: SEARCH SEJAJAR FILTER/SORT, TOMBOL TAMBAH ITEM DI BAWAH */}
          <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200/90 shadow-xs space-y-2.5">
            <div className="flex items-center gap-2">
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
                  placeholder="Cari nama atau kelengkapan paket..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
                />
              </div>
              <button
                type="button"
                onClick={openFilterModal}
                className={`relative shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-bold transition active:scale-95 cursor-pointer ${
                  hasActiveFilter
                    ? 'bg-[#06305d]/10 border-[#06305d] text-[#06305d]'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
                <span>Filter</span>
                {hasActiveFilter && <span className="w-2 h-2 rounded-full bg-[#06305d]" />}
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={openCreate}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-xl text-xs font-bold transition shadow-xs active:scale-95 cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <span className="text-base leading-none">+</span>
                <span>Tambah Item</span>
              </button>
            </div>
          </div>

          {/* DAFTAR CARD PAKET (2 SISI, 2 BARIS) */}
          {loading ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs text-center py-16 text-slate-400 space-y-2">
              <div className="inline-block animate-spin rounded-full h-7 w-7 border-3 border-[#06305d] border-t-transparent"></div>
              <p className="text-xs font-medium">Memuat data paket add-on...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs text-center py-16 text-slate-400 space-y-1">
              <p className="text-2xl">🎒</p>
              <p className="text-sm font-semibold text-slate-700">Belum ada paket add-on</p>
              <p className="text-xs">Tambahkan paket baru melalui tombol "Tambah Item".</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSearchParams({ id: it.id })}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 hover:border-[#06305d]/40 hover:shadow-sm p-4 transition active:scale-[0.995] cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Sisi Kiri: Baris 1 Nama Paket, Baris 2 Keterangan Kelengkapan */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-black text-slate-900 truncate">{it.nama}</p>
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {formatKelengkapanText(it)}
                      </p>
                    </div>

                    {/* Sisi Kanan: Baris 1 Status Aktif/Tidak di Pendaftaran */}
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                          it.aktif === 1
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        {it.aktif === 1 ? 'Aktif' : 'Nonaktif'}
                      </span>
                      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* MODAL FILTER & SORT */}
      {filterModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          onClick={() => setFilterModalOpen(false)}
        >
          <div
            className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm p-5 shadow-2xl border border-slate-100 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">Filter & Urutkan Paket</h2>
              <button
                type="button"
                onClick={() => setFilterModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">Status di Form Pendaftaran</label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'all', label: 'Semua' },
                      { id: 'aktif', label: 'Aktif' },
                      { id: 'nonaktif', label: 'Nonaktif' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDraftStatus(opt.id)}
                      className={`py-2 px-2 rounded-xl font-bold border transition cursor-pointer ${
                        draftStatus === opt.id
                          ? 'bg-[#06305d] text-white border-[#06305d]'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">Urutkan</label>
                <select
                  value={draftSort}
                  onChange={(e) => setDraftSort(e.target.value as SortOption)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d]"
                >
                  <option value="urutan">Urutan Tampil (Default)</option>
                  <option value="harga_asc">Harga Termurah</option>
                  <option value="harga_desc">Harga Termahal</option>
                  <option value="nama_asc">Nama Paket (A - Z)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={resetFilterModal}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={applyFilterModal}
                className="flex-1 py-2.5 rounded-xl bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-bold transition cursor-pointer"
              >
                Terapkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL FORM TAMBAH / EDIT */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[92vh] flex flex-col shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#06305d]"></span>
                <span>{editingId ? 'Edit Paket Add-on' : 'Tambah Paket Add-on Baru'}</span>
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form id="addon-form" noValidate onSubmit={handleSubmit} className="overflow-y-auto px-5 py-4 space-y-4 text-xs">
              {formError && (
                <div className="p-3.5 bg-rose-50 text-rose-700 text-xs rounded-2xl border border-rose-200 flex items-center gap-2">
                  <span>⚠</span>
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  Nama Paket <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Misal: Paket A"
                  value={form.nama}
                  onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">Keterangan Kelengkapan / Fasilitas</label>
                <input
                  type="text"
                  placeholder="Pisahkan dengan | contoh: 1 Tenda|4 Matras|4 Sleeping Bag"
                  value={form.fasilitas}
                  onChange={(e) => setForm((f) => ({ ...f, fasilitas: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">Deskripsi Singkat</label>
                <textarea
                  rows={2}
                  placeholder="Catatan tambahan paket (opsional)"
                  value={form.deskripsi}
                  onChange={(e) => setForm((f) => ({ ...f, deskripsi: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition resize-none"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block font-bold text-slate-700 mb-1.5">
                    Harga (Rp) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="120000"
                    value={form.harga}
                    onChange={(e) => setForm((f) => ({ ...f, harga: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">Stok</label>
                  <input
                    type="number"
                    placeholder="-1 = unlimited"
                    value={form.stok}
                    onChange={(e) => setForm((f) => ({ ...f, stok: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">Urutan Tampil</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={form.urutan}
                    onChange={(e) => setForm((f) => ({ ...f, urutan: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">Status di Form Pendaftaran</label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="aktif"
                      value="1"
                      checked={form.aktif === '1'}
                      onChange={() => setForm((f) => ({ ...f, aktif: '1' }))}
                    />
                    <span className="font-semibold text-emerald-700">Aktif (tampil di form)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="aktif"
                      value="0"
                      checked={form.aktif === '0'}
                      onChange={() => setForm((f) => ({ ...f, aktif: '0' }))}
                    />
                    <span className="font-semibold text-slate-500">Nonaktif</span>
                  </label>
                </div>
              </div>
            </form>

            <div className="flex items-center justify-end gap-2.5 sm:gap-3 px-5 py-4 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={closeForm}
                className="flex-1 sm:flex-none px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                form="addon-form"
                disabled={saving}
                className="flex-1 sm:flex-none px-5 py-2.5 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-xl text-xs font-bold transition shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : '+ Tambah Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HAPUS */}
      {deleteTarget && (
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
            <h3 className="text-base font-black text-slate-900 mb-1.5">Hapus Paket Add-on?</h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              Hapus paket <strong className="text-slate-800">{deleteTarget.nama}</strong>? Item yang sudah dipesan peserta
              tidak akan terpengaruh (tersimpan sebagai snapshot).
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition active:scale-95 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
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
    </div>
  );
}
