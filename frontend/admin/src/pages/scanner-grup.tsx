import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import {
  GrupScanPayload,
  GrupAnggotaItem,
  MealSesiId,
  MEAL_SESI_LIST,
  SESI_LIST,
  SesiId,
  playScannerBeep,
} from '../types/scanner';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

const STICKY_TAB_KEY = 'evenscan_scanner_tab';
const STICKY_MEAL_KEY = 'evenscan_scanner_meal';

type ActiveTab = 'checkin' | 'makan';

function readStickyTab(): ActiveTab {
  try {
    return sessionStorage.getItem(STICKY_TAB_KEY) === 'makan' ? 'makan' : 'checkin';
  } catch {
    return 'checkin';
  }
}

function readStickyMeal(): MealSesiId {
  try {
    const val = sessionStorage.getItem(STICKY_MEAL_KEY);
    if (MEAL_SESI_LIST.some((m) => m.id === val)) return val as MealSesiId;
  } catch {
    /* ignore */
  }
  return 'makan_sabtu_siang';
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  try {
    let s = String(dateStr).trim();
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) s = s.replace(' ', 'T') + 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return dateStr!;
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }).format(d);
  } catch {
    return dateStr!;
  }
}

function getDefaultSelection(payload: GrupScanPayload, sesi: SesiId): string[] {
  if (payload.grup.status !== 'lunas') return [];

  const target = payload.scanned_anggota_id
    ? payload.anggota.find((a) => a.id === payload.scanned_anggota_id)
    : payload.anggota.length === 1
    ? payload.anggota[0]
    : undefined;

  if (!target) return [];
  if (target.scan_history?.[sesi]?.scanned) return [];
  if (sesi !== 'checkin' && !target.dapat_jatah_makan) return [];
  return [target.id];
}

function statusGrupBadge(status: string) {
  if (status === 'lunas') {
    return { label: 'Lunas', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  }
  if (status === 'menunggu_verifikasi') {
    return { label: 'Menunggu Verifikasi', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
  }
  if (status === 'ditolak') {
    return { label: 'Ditolak', cls: 'bg-rose-100 text-rose-800 border-rose-200' };
  }
  return { label: 'Menunggu Pembayaran', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
}

export function ScannerGrup() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const initialStateData = (location.state as { initialData?: GrupScanPayload } | null)?.initialData || null;
  const grupIdParam = searchParams.get('grup') || '';
  const anggotaIdParam = searchParams.get('anggota') || '';

  const [data, setData] = useState<GrupScanPayload | null>(initialStateData);
  const [loading, setLoading] = useState(!initialStateData);
  const [loadError, setLoadError] = useState('');

  const [activeTab, setActiveTab] = useState<ActiveTab>(readStickyTab);
  const [activeMeal, setActiveMeal] = useState<MealSesiId>(readStickyMeal);
  const activeSesi: SesiId = activeTab === 'checkin' ? 'checkin' : activeMeal;

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    initialStateData ? getDefaultSelection(initialStateData, readStickyTab() === 'checkin' ? 'checkin' : readStickyMeal()) : []
  );

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const [undoTarget, setUndoTarget] = useState<GrupAnggotaItem | null>(null);
  const [undoLoading, setUndoLoading] = useState(false);

  // Simpan pilihan tab & jadwal makan terakhir (Sticky Mode)
  useEffect(() => {
    try {
      sessionStorage.setItem(STICKY_TAB_KEY, activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STICKY_MEAL_KEY, activeMeal);
    } catch {
      /* ignore */
    }
  }, [activeMeal]);

  // Muat data grup jika halaman di-refresh atau diakses langsung lewat query param
  useEffect(() => {
    if (initialStateData && (!grupIdParam || initialStateData.grup.id === grupIdParam)) {
      return;
    }
    if (!grupIdParam) {
      setLoading(false);
      setLoadError('Data grup tidak ditentukan. Silakan scan QR terlebih dahulu.');
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const authToken = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/absensi/lookup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            grup_id: grupIdParam,
            anggota_id: anggotaIdParam || null,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json.data) {
          const payload = json.data as GrupScanPayload;
          setData(payload);
          setSelectedIds(getDefaultSelection(payload, activeSesi));
        } else {
          setLoadError(json.error || 'Gagal memuat data grup peserta.');
        }
      } catch (err: any) {
        if (!cancelled) setLoadError('Gangguan koneksi: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupIdParam, anggotaIdParam]);

  const handleChangeTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    setFeedback(null);
    if (data) {
      const nextSesi: SesiId = tab === 'checkin' ? 'checkin' : activeMeal;
      setSelectedIds(getDefaultSelection(data, nextSesi));
    }
  };

  const handleChangeMeal = (meal: MealSesiId) => {
    setActiveMeal(meal);
    setFeedback(null);
    if (data) {
      setSelectedIds(getDefaultSelection(data, meal));
    }
  };

  const isLunas = data?.grup.status === 'lunas';

  const selectableMembers = useMemo(() => {
    if (!data || !isLunas) return [];
    return data.anggota.filter((m) => {
      if (m.scan_history?.[activeSesi]?.scanned) return false;
      if (activeTab === 'makan' && !m.dapat_jatah_makan) return false;
      return true;
    });
  }, [data, isLunas, activeSesi, activeTab]);

  const sessionStats = useMemo(() => {
    if (!data) {
      return {
        checkin: { done: 0, total: 0 },
        makan_sabtu_siang: { done: 0, total: 0 },
        makan_sabtu_malam: { done: 0, total: 0 },
        makan_ahad_pagi: { done: 0, total: 0 },
        tanpaJatahCount: 0,
      };
    }
    const eligibleMeal = data.anggota.filter((a) => a.dapat_jatah_makan);
    const countDone = (sesi: SesiId, pool: GrupAnggotaItem[]) =>
      pool.filter((a) => a.scan_history?.[sesi]?.scanned).length;

    return {
      checkin: { done: countDone('checkin', data.anggota), total: data.anggota.length },
      makan_sabtu_siang: { done: countDone('makan_sabtu_siang', eligibleMeal), total: eligibleMeal.length },
      makan_sabtu_malam: { done: countDone('makan_sabtu_malam', eligibleMeal), total: eligibleMeal.length },
      makan_ahad_pagi: { done: countDone('makan_ahad_pagi', eligibleMeal), total: eligibleMeal.length },
      tanpaJatahCount: data.anggota.length - eligibleMeal.length,
    };
  }, [data]);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSelectAllPending = () => {
    setSelectedIds(selectableMembers.map((m) => m.id));
  };

  const handleClearSelection = () => {
    setSelectedIds([]);
  };

  const handleConfirmBatch = async () => {
    if (!data || !isLunas || selectedIds.length === 0) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const authToken = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/scan-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          grup_id: data.grup.id,
          anggota_ids: selectedIds,
          sesi: activeSesi,
          scanned_anggota_id: data.scanned_anggota_id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        playScannerBeep('success');
        setData(json.data as GrupScanPayload);
        setSelectedIds([]);
        setFeedback({ ok: true, message: json.message || 'Presensi berhasil dicatat.' });
      } else {
        playScannerBeep('error');
        setFeedback({ ok: false, message: json.error || 'Gagal mencatat presensi.' });
      }
    } catch (err: any) {
      playScannerBeep('error');
      setFeedback({ ok: false, message: 'Gagal terhubung ke server: ' + err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmUndo = async () => {
    if (!data || !undoTarget) return;
    setUndoLoading(true);
    setFeedback(null);
    try {
      const authToken = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/scan-undo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          grup_id: data.grup.id,
          anggota_id: undoTarget.id,
          sesi: activeSesi,
          scanned_anggota_id: data.scanned_anggota_id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        playScannerBeep('warning');
        setData(json.data as GrupScanPayload);
        setUndoTarget(null);
        setFeedback({ ok: true, message: json.message || 'Catatan berhasil dibatalkan.' });
      } else {
        playScannerBeep('error');
        setUndoTarget(null);
        setFeedback({ ok: false, message: json.error || 'Gagal membatalkan catatan.' });
      }
    } catch (err: any) {
      playScannerBeep('error');
      setUndoTarget(null);
      setFeedback({ ok: false, message: 'Gagal terhubung ke server: ' + err.message });
    } finally {
      setUndoLoading(false);
    }
  };

  const activeSesiLabel = SESI_LIST.find((s) => s.id === activeSesi)?.label || activeSesi;
  const activeSesiShort = SESI_LIST.find((s) => s.id === activeSesi)?.short || activeSesi;

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-[#06305d] text-white px-4 py-3 shadow-sm">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <h1 className="text-sm font-black tracking-tight truncate">Presensi & Konsumsi Grup</h1>

          <button
            type="button"
            onClick={() => navigate('/')}
            title="Ke Dashboard"
            aria-label="Ke Dashboard"
            className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition active:scale-95 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-4 pb-28 space-y-4">
        {loading ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs">
            <div className="w-9 h-9 border-3 border-[#06305d] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold text-slate-500">Memuat data grup peserta...</p>
          </div>
        ) : loadError || !data ? (
          <div className="bg-white rounded-3xl border border-rose-200 p-8 text-center shadow-xs space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">Data Grup Tidak Ditemukan</h2>
              <p className="text-xs text-slate-500 mt-1">{loadError || 'Silakan scan ulang QR peserta.'}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/scanner')}
              className="px-5 py-2.5 rounded-xl bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-bold shadow-sm transition cursor-pointer"
            >
              Kembali ke Kamera Scanner
            </button>
          </div>
        ) : (
          <>
            {/* Kartu Identitas Grup */}
            <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {data.grup.nomor_grup && (
                      <span className="px-2 py-0.5 rounded-md bg-[#06305d] text-white font-mono text-[10px] font-bold">
                        {data.grup.nomor_grup}
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        statusGrupBadge(data.grup.status).cls
                      }`}
                    >
                      {isLunas ? '✓ ' : ''}
                      {statusGrupBadge(data.grup.status).label}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">
                      • {data.grup.jumlah_anggota} peserta
                    </span>
                  </div>
                  <h2 className="text-base sm:text-lg font-black text-slate-900 mt-1.5 leading-snug">
                    {data.grup.nama_grup}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
                    <span>PIC: {data.grup.pic_nama}</span>
                    {data.grup.pic_whatsapp && (
                      <>
                        <span>•</span>
                        <a
                          href={`https://wa.me/${data.grup.pic_whatsapp.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 hover:underline font-semibold"
                        >
                          {data.grup.pic_whatsapp} ↗
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {!isLunas && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="text-xs text-rose-800">
                    <p className="font-bold">Grup Belum Lunas</p>
                    <p className="text-[11px] text-rose-700 mt-0.5">
                      Check-in dan absen makan hanya tersedia setelah pembayaran dikonfirmasi lunas.
                    </p>
                  </div>
                  <Link
                    to={`/peserta?id=${encodeURIComponent(data.grup.id)}`}
                    className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold shrink-0 transition"
                  >
                    Detail Verifikasi
                  </Link>
                </div>
              )}
            </section>

            {/* 2 Tab Utama: Check-in & Makan */}
            <section className="space-y-3">
              <div className="grid grid-cols-2 gap-2 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-xs">
                <button
                  type="button"
                  onClick={() => handleChangeTab('checkin')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                    activeTab === 'checkin'
                      ? 'bg-[#06305d] text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span>Check-in</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                      activeTab === 'checkin' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {sessionStats.checkin.done}/{sessionStats.checkin.total}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleChangeTab('makan')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 cursor-pointer ${
                    activeTab === 'makan'
                      ? 'bg-[#06305d] text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span>Makan</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                      activeTab === 'makan' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {sessionStats[activeMeal].done}/{sessionStats[activeMeal].total}
                  </span>
                </button>
              </div>

              {/* Pemilih 3 Jadwal Makan (Terpisah) saat di Tab Makan */}
              {activeTab === 'makan' && (
                <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Pilih Jadwal Makan
                    </p>
                    {sessionStats.tanpaJatahCount > 0 && (
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                        {sessionStats.tanpaJatahCount} balita tanpa jatah makan
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {MEAL_SESI_LIST.map((m) => {
                      const stat = sessionStats[m.id];
                      const active = activeMeal === m.id;
                      const allTaken = stat.total > 0 && stat.done === stat.total;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleChangeMeal(m.id)}
                          className={`p-2.5 rounded-xl border text-center transition cursor-pointer ${
                            active
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : allTaken
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100/70'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <p className="text-[11px] font-extrabold leading-tight">{m.short}</p>
                          <p
                            className={`text-[10px] font-bold mt-1 ${
                              active ? 'text-emerald-100' : 'text-slate-500'
                            }`}
                          >
                            {stat.done}/{stat.total} sudah
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* Feedback Banner Hasil Simpan / Undo */}
            {feedback && (
              <div
                className={`p-3.5 rounded-2xl text-xs font-bold flex items-start gap-2.5 border shadow-xs ${
                  feedback.ok
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
              >
                <span className="text-base leading-none shrink-0">{feedback.ok ? '✓' : '⚠'}</span>
                <p className="flex-1 leading-snug">{feedback.message}</p>
                <button
                  type="button"
                  onClick={() => setFeedback(null)}
                  className="text-current opacity-75 hover:opacity-100 text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Kontrol Cepat Pilih Semua / Kosongkan */}
            {isLunas && selectableMembers.length > 0 && (
              <div className="flex items-center justify-between gap-2 bg-white rounded-2xl border border-slate-200 px-3.5 py-2.5 shadow-xs">
                <p className="text-xs font-semibold text-slate-600">
                  <strong className="text-[#06305d]">{selectedIds.length}</strong> dipilih dari{' '}
                  {selectableMembers.length} belum {activeTab === 'checkin' ? 'check-in' : 'ambil makan'}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSelectAllPending}
                    disabled={selectedIds.length === selectableMembers.length}
                    className="px-2.5 py-1.5 rounded-lg bg-[#06305d]/10 hover:bg-[#06305d]/15 text-[#06305d] text-[11px] font-bold transition disabled:opacity-40 cursor-pointer"
                  >
                    Pilih Semua
                  </button>
                  {selectedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold transition cursor-pointer"
                    >
                      Kosongkan
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Daftar Anggota Grup */}
            <section className="space-y-2.5">
              {data.anggota.map((member) => {
                const isScannedOwner = member.id === data.scanned_anggota_id;
                const scanInfo = member.scan_history?.[activeSesi];
                const alreadyDone = Boolean(scanInfo?.scanned);
                const noMealQuota = activeTab === 'makan' && !member.dapat_jatah_makan;
                const canSelect = isLunas && !alreadyDone && !noMealQuota;
                const isChecked = selectedIds.includes(member.id);

                return (
                  <div
                    key={member.id}
                    onClick={() => {
                      if (canSelect) toggleMember(member.id);
                    }}
                    className={`rounded-2xl border p-3.5 transition ${
                      alreadyDone
                        ? 'bg-emerald-50/70 border-emerald-200'
                        : noMealQuota || !isLunas
                        ? 'bg-slate-50 border-slate-200 opacity-85'
                        : isChecked
                        ? 'bg-sky-50/70 border-[#06305d] ring-2 ring-[#06305d]/15 cursor-pointer'
                        : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox / Status Icon */}
                      <div className="pt-0.5 shrink-0">
                        {alreadyDone ? (
                          <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        ) : noMealQuota || !isLunas ? (
                          <div className="w-6 h-6 rounded-lg bg-slate-200 text-slate-500 flex items-center justify-center text-xs font-bold">
                            —
                          </div>
                        ) : (
                          <div
                            className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition ${
                              isChecked
                                ? 'bg-[#06305d] border-[#06305d] text-white'
                                : 'bg-white border-slate-300'
                            }`}
                          >
                            {isChecked && (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Info Peserta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-mono font-bold text-[#06305d]">
                            {member.nomor_peserta}
                          </span>
                          {isScannedOwner && (
                            <span className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[10px] font-bold border border-sky-200">
                              QR Di-scan
                            </span>
                          )}
                          {member.is_gratis && (
                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                              {member.makan_dicover ? 'Balita (cover)' : 'Gratis'}
                            </span>
                          )}
                        </div>

                        <p className="text-sm font-black text-slate-900 mt-0.5 leading-snug">{member.nama}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {member.peran} • {member.jenis_kelamin} •{' '}
                          {member.usia != null ? `${member.usia} th` : '-'} ({member.kategori_usia_label})
                        </p>

                        {member.catatan_medis && (
                          <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-800 font-semibold">
                            ⚠ Catatan Medis: {member.catatan_medis}
                          </div>
                        )}

                        {noMealQuota && (
                          <p className="mt-1.5 text-[11px] font-semibold text-amber-700">
                            Tanpa jatah makan panitia (balita gratis)
                          </p>
                        )}
                      </div>

                      {/* Kanan: Status Sudah + Tombol Kecil Batal/Undo */}
                      {alreadyDone && (
                        <div
                          className="shrink-0 flex flex-col items-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-right">
                            <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                              Sudah
                            </span>
                            {scanInfo?.scanned_at && (
                              <p className="text-[10px] text-emerald-700 mt-0.5 font-medium">
                                {formatDateTime(scanInfo.scanned_at)}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setUndoTarget(member)}
                            className="px-2 py-1 rounded-lg bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-[10px] font-bold transition active:scale-95 cursor-pointer"
                            title={`Batalkan ${activeSesiLabel} untuk ${member.nama}`}
                          >
                            Batal
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}
      </main>

      {/* Sticky Bottom Action Bar */}
      {data && !loading && !loadError && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
          <div className="max-w-3xl mx-auto flex items-center gap-2.5">
            {isLunas && selectedIds.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate('/scanner')}
                  disabled={submitting}
                  className="px-4 py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition active:scale-95 shrink-0 cursor-pointer"
                >
                  Scan Lagi
                </button>
                <button
                  type="button"
                  onClick={handleConfirmBatch}
                  disabled={submitting}
                  className="flex-1 py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-black shadow-md transition active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                      </svg>
                      <span>
                        Konfirmasi {activeSesiShort} ({selectedIds.length} Orang)
                      </span>
                    </>
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/scanner')}
                className="w-full py-3.5 px-4 rounded-2xl bg-[#06305d] hover:bg-[#0a4583] text-white text-xs sm:text-sm font-black shadow-md transition active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.2"
                    d="M3 7V5a2 2 0 012-2h2m10 0h2a2 2 0 012 2v2m0 10v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"
                  />
                </svg>
                <span>Scan QR Berikutnya</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Pembatalan / Undo (Bawaan Aplikasi) */}
      {undoTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            if (!undoLoading) setUndoTarget(null);
          }}
        >
          <div
            className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Batalkan {activeSesiShort}?</h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Status <strong>{undoTarget.nama}</strong> ({undoTarget.nomor_peserta}) pada sesi{' '}
                <strong>{activeSesiLabel}</strong> akan dikembalikan menjadi belum tercatat.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setUndoTarget(null)}
                disabled={undoLoading}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={handleConfirmUndo}
                disabled={undoLoading}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black shadow-sm transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {undoLoading ? 'Membatalkan...' : 'Ya, Batalkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
