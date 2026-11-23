import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

const SESI_LIST: { id: string; label: string }[] = [
  { id: 'checkin', label: 'Check-in Kehadiran' },
  { id: 'makan_sabtu_siang', label: 'Makan Sabtu Siang' },
  { id: 'makan_sabtu_malam', label: 'Makan Sabtu Malam' },
  { id: 'makan_ahad_pagi', label: 'Makan Ahad Pagi' },
];

interface ScanLog {
  sesi: string;
  scanned_at: string;
  scanned_by?: string;
}

interface AnggotaDetail {
  id: string;
  nomor_peserta: string;
  nama: string;
  peran: string;
  jenis_kelamin: string;
  usia: number | null;
  kategori_usia: string;
  kategori_usia_label: string;
  ukuran_kaos: string | null;
  catatan_medis: string | null;
  is_gratis: number;
  makan_dicover: number;
  status_hadir: string;
  attended_at: string | null;
  qr_token: string | null;
  grup_id: string;
  nomor_grup: string | null;
  grup_tipe: string;
  pic_nama: string;
  pic_whatsapp: string;
  grup_status: string;
  grup_total: number;
  scan_log: ScanLog[];
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    const s = String(dateStr).trim();
    const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : s.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return dateStr!;
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }).format(d);
  } catch {
    return dateStr!;
  }
}

export function RiwayatDetail() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<AnggotaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/admin/anggota/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok) setError(json.error || 'Data peserta tidak ditemukan.');
        else setItem(json.data);
      } catch (err: any) {
        setError('Gagal memuat detail: ' + err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [id]);

  const sesiStatus = (sesi: string): ScanLog | undefined => item?.scan_log?.find((s) => s.sesi === sesi);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          to="/peserta?tab=individu"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 shadow-xs transition active:scale-95 cursor-pointer"
        >
          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
          <span>Kembali ke Data Peserta</span>
        </Link>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
          <div className="w-8 h-8 border-3 border-[#06305d] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-medium">Memuat detail peserta...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-xs">
          <h3 className="text-sm font-bold text-slate-800 mb-1">Data Tidak Ditemukan</h3>
          <p className="text-xs text-slate-500 mb-4">{error}</p>
          <Link to="/peserta?tab=individu" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-bold transition">
            Kembali ke Data Peserta
          </Link>
        </div>
      ) : item ? (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden max-w-3xl mx-auto">
          <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-mono font-black text-[#06305d]">{item.nomor_peserta}</p>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 mt-0.5">{item.nama}</h2>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="px-2 py-0.5 rounded-full bg-[#06305d]/10 text-[#06305d] text-[10px] font-bold">{item.peran}</span>
                <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-semibold">{item.kategori_usia_label}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    item.status_hadir === 'hadir' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {item.status_hadir === 'hadir' ? '✓ Hadir' : 'Belum Hadir'}
                </span>
                {Boolean(item.is_gratis) && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                    {item.makan_dicover ? 'Balita (cover panitia)' : 'Gratis'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-2xl">
              <div>
                <span className="text-slate-400 font-medium">Jenis Kelamin:</span>
                <p className="font-bold text-slate-800 mt-0.5">{item.jenis_kelamin}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Usia:</span>
                <p className="font-bold text-slate-800 mt-0.5">{item.usia != null ? `${item.usia} tahun` : '-'}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Ukuran Kaos:</span>
                <p className="font-semibold text-slate-700 mt-0.5">{item.ukuran_kaos || '-'}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Grup:</span>
                <p className="font-semibold text-slate-700 mt-0.5">
                  {item.nomor_grup || item.grup_id} ({item.grup_tipe === 'keluarga' ? 'Keluarga' : 'Non-Keluarga'})
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">PIC:</span>
                <p className="font-semibold text-slate-700 mt-0.5">{item.pic_nama}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Status Bayar Grup:</span>
                <p className="font-semibold text-slate-700 mt-0.5 capitalize">{item.grup_status.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Token QR:</span>
                <p className="font-mono font-bold text-sky-700 mt-0.5 truncate">{item.qr_token || '-'}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">Check-in:</span>
                <p className="font-semibold text-blue-700 mt-0.5">{formatDateTime(item.attended_at)}</p>
              </div>
            </div>

            {item.catatan_medis && (
              <div className="p-3.5 bg-rose-50 rounded-2xl border border-rose-200">
                <p className="text-[11px] font-bold text-rose-500 uppercase">⚠ Catatan Medis</p>
                <p className="font-semibold text-rose-800 mt-0.5">{item.catatan_medis}</p>
              </div>
            )}

            {/* Status sesi */}
            <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-2">
              <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Status Jatah Makan & Kehadiran:</p>
              {SESI_LIST.map((s) => {
                const log = sesiStatus(s.id);
                return (
                  <div key={s.id} className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className={log ? 'text-emerald-600' : 'text-slate-300'}>{log ? '✓' : '○'}</span>
                      {s.label}
                    </span>
                    <span className={`text-xs font-semibold ${log ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {log ? formatDateTime(log.scanned_at) : 'Belum'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 flex gap-2.5">
            {item.pic_whatsapp && (
              <a
                href={`https://wa.me/${item.pic_whatsapp.replace(/\D/g, '').replace(/^0/, '62')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold text-center shadow-xs transition flex items-center justify-center gap-1.5"
              >
                <span>📱</span> Hubungi PIC
              </a>
            )}
            <Link to="/peserta?tab=individu" className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition inline-flex items-center justify-center">
              Kembali
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
