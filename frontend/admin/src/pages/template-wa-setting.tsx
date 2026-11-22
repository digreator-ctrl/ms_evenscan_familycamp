import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface WaTemplate {
  id: string;
  nama: string;
  body: string;
  aktif: number;
}

const VARIABEL = [
  '{nama_pic}',
  '{nama_acara}',
  '{total}',
  '{jumlah_anggota}',
  '{nomor_grup}',
  '{link_pembayaran}',
  '{link_status}',
];

function renderPreview(body: string): string {
  return body
    .replace(/\{nama_pic\}/g, 'Ustadz Ahmad')
    .replace(/\{nama_acara\}/g, 'Family Camp')
    .replace(/\{total\}/g, 'Rp 600.000')
    .replace(/\{jumlah_anggota\}/g, '4')
    .replace(/\{nomor_grup\}/g, 'K-001')
    .replace(/\{link_pembayaran\}/g, 'https://contoh.id/pembayaran?token=XXX')
    .replace(/\{link_status\}/g, 'https://contoh.id/status?wa=0812...');
}

export function TemplateWaSetting({ onBack }: { onBack: () => void }) {
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/wa-templates`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        });
        if (res.ok) setTemplates((await res.json()).data || []);
      } catch {
        setToast({ type: 'error', message: 'Gagal memuat template.' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const updateBody = (id: string, body: string) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, body } : t)));
  };

  const save = async (id: string) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setSavingId(id);
    try {
      const res = await fetch(`${API_URL}/api/admin/wa-templates/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: tpl.body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setToast({ type: 'success', message: 'Template tersimpan.' });
      else setToast({ type: 'error', message: data.error || 'Gagal menyimpan.' });
    } catch {
      setToast({ type: 'error', message: 'Terjadi kesalahan jaringan.' });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
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
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Template WhatsApp</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Gunakan variabel seperti <code className="bg-slate-100 px-1 rounded">{'{nama_pic}'}</code> agar terisi otomatis saat link dibuat.
        </p>
      </div>

      <div className="bg-sky-50 border border-sky-200 rounded-2xl p-3 text-[11px] text-sky-800">
        <p className="font-bold mb-1">Variabel tersedia:</p>
        <div className="flex flex-wrap gap-1.5">
          {VARIABEL.map((v) => (
            <code key={v} className="bg-white px-1.5 py-0.5 rounded border border-sky-200 font-mono">{v}</code>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">
          <div className="inline-block animate-spin rounded-full h-7 w-7 border-3 border-[#06305d] border-t-transparent"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map((tpl) => (
            <div key={tpl.id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
              <h2 className="text-sm font-black text-slate-900">{tpl.nama}</h2>
              <textarea
                rows={7}
                value={tpl.body}
                onChange={(e) => updateBody(tpl.id, e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d]"
              />
              <details className="text-xs text-slate-500">
                <summary className="cursor-pointer font-bold text-[#06305d] select-none">Pratinjau</summary>
                <div className="mt-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200 whitespace-pre-wrap text-slate-700 leading-relaxed">
                  {renderPreview(tpl.body)}
                </div>
              </details>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => save(tpl.id)}
                  disabled={savingId === tpl.id}
                  className="px-5 py-2 bg-[#06305d] hover:bg-[#0a4583] text-white rounded-xl text-xs font-bold transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {savingId === tpl.id ? 'Menyimpan...' : 'Simpan Template'}
                </button>
              </div>
            </div>
          ))}
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
