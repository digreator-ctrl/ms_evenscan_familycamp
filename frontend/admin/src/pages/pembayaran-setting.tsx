import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export function PembayaranSetting({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({
    rekening_bank: '',
    rekening_nomor: '',
    rekening_atas_nama: '',
    kontak_panitia_wa: '',
    nama_acara: '',
    harga_per_orang: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'rekening' | 'umum'>('rekening');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/settings/app`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        });
        if (res.ok) {
          const json = await res.json();
          const d = json.data || {};
          setForm({
            rekening_bank: d.rekening_bank || '',
            rekening_nomor: d.rekening_nomor || '',
            rekening_atas_nama: d.rekening_atas_nama || '',
            kontak_panitia_wa: d.kontak_panitia_wa || '',
            nama_acara: d.nama_acara || '',
            harga_per_orang: d.harga_per_orang || '',
          });
        }
      } catch {
        setToast({ type: 'error', message: 'Gagal memuat pengaturan.' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/settings/app`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setToast({ type: 'success', message: 'Pengaturan pembayaran tersimpan.' });
      else setToast({ type: 'error', message: data.error || 'Gagal menyimpan.' });
    } catch {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan.' });
    } finally {
      setSaving(false);
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder = '',
    type = 'text'
  ) => (
    <label className="block text-xs font-bold text-slate-600">
      {label}
      <input
        type={type}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d]"
      />
    </label>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 shadow-xs transition active:scale-95 cursor-pointer"
      >
        <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
        </svg>
        <span>Kembali ke Pengaturan</span>
      </button>

      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Pembayaran & Rekening</h1>
        <p className="text-xs text-slate-500 mt-0.5">Data ini tampil di halaman pembayaran peserta dan pesan WhatsApp.</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">
          <div className="inline-block animate-spin rounded-full h-7 w-7 border-3 border-[#06305d] border-t-transparent"></div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex gap-1.5">
            {(
              [
                { id: 'rekening', label: 'Rekening Tujuan' },
                { id: 'umum', label: 'Umum' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer border ${
                  tab === t.id
                    ? 'bg-[#06305d] text-white border-[#06305d]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'rekening' && (
            <div className="space-y-3">
              {field('rekening_bank', 'Bank', 'BCA Syariah')}
              {field('rekening_nomor', 'Nomor Rekening', '0680909090')}
              {field('rekening_atas_nama', 'Atas Nama', 'Yayasan Muslim Scene Official')}
            </div>
          )}
          {tab === 'umum' && (
            <div className="space-y-3">
              {field('nama_acara', 'Nama Acara', 'Family Camp')}
              {field('kontak_panitia_wa', 'Kontak WA Panitia', '081234567890')}
              {field('harga_per_orang', 'Harga per Orang (Rp)', '200000', 'number')}
            </div>
          )}
          <div className="pt-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="w-full sm:w-auto px-6 py-3 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-xl text-xs font-bold shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-6 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div
            className={`pointer-events-auto w-full max-w-sm rounded-2xl border shadow-xl p-4 flex items-start gap-3 ${
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
            <p className="text-xs text-slate-700 leading-relaxed pt-1.5">{toast.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
