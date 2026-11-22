import { useState, useEffect } from 'react';

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

const formatRupiah = (n: number): string => {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
};

const emptyForm = {
  nama: '',
  deskripsi: '',
  harga: '',
  stok: '-1',
  aktif: '1',
  urutan: '0',
  kategori: 'satuan',
  fasilitas: '',
};

export function KelolaAddon() {
  const [items, setItems] = useState<AddonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);

  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const startEdit = (item: AddonItem) => {
    setEditingId(item.id);
    setForm({
      nama: item.nama,
      deskripsi: item.deskripsi || '',
      harga: String(item.harga),
      stok: String(item.stok),
      aktif: String(item.aktif),
      urutan: String(item.urutan || 0),
      kategori: item.kategori === 'paket' ? 'paket' : 'satuan',
      fasilitas: item.fasilitas || '',
    });
    setFormError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      setFormError('Nama item wajib diisi.');
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
        kategori: form.kategori,
        fasilitas: form.kategori === 'paket' ? form.fasilitas.trim() : '',
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
          message: editingId ? 'Item add-on berhasil diperbarui.' : 'Item add-on baru berhasil ditambahkan.',
        });
        resetForm();
        await fetchItems(true);
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menyimpan item add-on.' });
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
          message: `Item "${item.nama}" ${item.aktif === 1 ? 'dinonaktifkan' : 'diaktifkan'}.`,
        });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Gagal mengubah status item.' });
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
        setToast({ type: 'success', message: `Item "${deleteTarget.nama}" berhasil dihapus.` });
        await fetchItems(true);
        if (editingId === deleteTarget.id) resetForm();
      } else {
        setToast({ type: 'error', message: data.error || 'Gagal menghapus item.' });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan saat menghapus.' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const filtered = items.filter((it) => {
    if (!showInactive && it.aktif === 0) return false;
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      it.nama.toLowerCase().includes(q) ||
      (it.deskripsi || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Kelola Add-on</h1>
        <p className="text-sm text-slate-500">
          Kelola katalog barang sewa & layanan tambahan (tenda, matras, lampu, dll) beserta harga dan stok.
        </p>
      </div>

      {/* FORM TAMBAH / EDIT */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#06305d]"></span>
            <span>{editingId ? 'Edit Item Add-on' : 'Tambah Item Add-on Baru'}</span>
          </h2>
        </div>

        {formError && (
          <div className="p-3.5 bg-rose-50 text-rose-700 text-xs rounded-2xl border border-rose-200 flex items-center gap-2">
            <span>⚠</span>
            <span>{formError}</span>
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">Nama Item <span className="text-rose-500">*</span></label>
            <input
              type="text"
              placeholder="Misal: Sewa Tenda Dome 4 Orang"
              value={form.nama}
              onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1.5">Deskripsi</label>
            <textarea
              rows={2}
              placeholder="Keterangan singkat item (opsional)"
              value={form.deskripsi}
              onChange={(e) => setForm((f) => ({ ...f, deskripsi: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold text-slate-700 mb-1.5">Kategori</label>
              <select
                value={form.kategori}
                onChange={(e) => setForm((f) => ({ ...f, kategori: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
              >
                <option value="satuan">Satuan (dijual per unit)</option>
                <option value="paket">Paket Tenda (bundling)</option>
              </select>
            </div>
            {form.kategori === 'paket' && (
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">Fasilitas Paket</label>
                <input
                  type="text"
                  placeholder="Pisahkan dengan | contoh: 1 Tenda|4 Matras|4 Sleeping Bag"
                  value={form.fasilitas}
                  onChange={(e) => setForm((f) => ({ ...f, fasilitas: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-bold text-slate-700 mb-1.5">Harga (Rp) <span className="text-rose-500">*</span></label>
              <input
                type="number"
                min="0"
                placeholder="150000"
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
            <label className="block font-bold text-slate-700 mb-1.5">Status</label>
            <div className="flex items-center gap-4">
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

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-xl text-xs font-bold transition shadow-xs active:scale-95 disabled:opacity-50 cursor-pointer inline-flex items-center gap-2"
            >
              {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : '+ Tambah Item'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Batal Edit
              </button>
            )}
          </div>
        </form>
      </div>

      {/* SEARCH & TOGGLE */}
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
            placeholder="Cari item add-on..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d] transition"
          />
        </div>
        <label className="shrink-0 flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span>Tampilkan nonaktif</span>
        </label>
      </div>

      {/* LIST */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-slate-400 space-y-2">
            <div className="inline-block animate-spin rounded-full h-7 w-7 border-3 border-[#06305d] border-t-transparent"></div>
            <p className="text-xs font-medium">Memuat data add-on...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400 space-y-1">
            <p className="text-2xl">🎒</p>
            <p className="text-sm font-semibold text-slate-700">Belum ada item add-on</p>
            <p className="text-xs">Tambahkan item baru melalui form di atas.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3.5">Item</th>
                  <th className="px-5 py-3.5">Kategori</th>
                  <th className="px-5 py-3.5">Harga</th>
                  <th className="px-5 py-3.5">Stok</th>
                  <th className="px-5 py-3.5">Urutan</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-900">{it.nama}</div>
                      {it.deskripsi && <div className="text-[11px] text-slate-400">{it.deskripsi}</div>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          it.kategori === 'paket'
                            ? 'bg-violet-100 text-violet-700 border border-violet-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {it.kategori === 'paket' ? 'Paket' : 'Satuan'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-800">{formatRupiah(it.harga)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{it.stok === -1 ? 'Unlimited' : it.stok}</td>
                    <td className="px-5 py-3.5 text-slate-600">{it.urutan}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          it.aktif === 1
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        {it.aktif === 1 ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleAktif(it)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                            it.aktif === 1
                              ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {it.aktif === 1 ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(it)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(it)}
                          className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-semibold transition cursor-pointer"
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
        )}
      </div>

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
            <h3 className="text-base font-black text-slate-900 mb-1.5">Hapus Item Add-on?</h3>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              Hapus item <strong className="text-slate-800">{deleteTarget.nama}</strong>? Item yang sudah dipesan peserta
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
