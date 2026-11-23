import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

type SesiId = 'checkin' | 'makan_sabtu_siang' | 'makan_sabtu_malam' | 'makan_ahad_pagi';

const SESI_LIST: { id: SesiId; label: string; short: string; icon: string }[] = [
  { id: 'checkin', label: 'Check-in Kehadiran', short: 'Check-in', icon: '🚪' },
  { id: 'makan_sabtu_siang', label: 'Makan Sabtu Siang', short: 'Mkn Sbt Siang', icon: '🍽️' },
  { id: 'makan_sabtu_malam', label: 'Makan Sabtu Malam', short: 'Mkn Sbt Malam', icon: '🍲' },
  { id: 'makan_ahad_pagi', label: 'Makan Ahad Pagi', short: 'Mkn Ahad Pagi', icon: '🥣' },
];

interface ScanHistoryItem {
  scanned: boolean;
  scanned_at?: string;
  scanned_by?: string;
}

interface AnggotaData {
  tipe: string;
  id: string;
  nomor_peserta: string;
  nama: string;
  peran: string;
  jenis_kelamin: string;
  usia: number | null;
  kategori_usia_label: string;
  ukuran_kaos?: string | null;
  catatan_medis?: string | null;
  is_gratis: boolean;
  makan_dicover: boolean;
  dapat_jatah_makan: boolean;
  status_hadir: string;
  attended_at: string | null;
  qr_token: string;
  grup: string;
  nomor_grup?: string;
  pic_nama?: string;
  pic_whatsapp?: string;
  grup_status?: string;
  scan_history?: Record<string, ScanHistoryItem>;
  sesi_tersedia?: { id: string; label: string }[];
}

export function Scanner() {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [manualToken, setManualToken] = useState('');

  const [sesi, setSesi] = useState<SesiId>('checkin');

  const [scanned, setScanned] = useState<AnggotaData | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const scannerRef = useRef<any>(null);
  const isProcessingRef = useRef<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const initCamera = async () => {
      await new Promise((r) => setTimeout(r, 250));
      if (isMounted) await startScanner();
    };
    initCamera();
    return () => {
      isMounted = false;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScanner = async () => {
    setCameraLoading(true);
    setCameraError('');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch {}
      }
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 },
        (decodedText: string) => handleDetectedCode(decodedText),
        () => {}
      );
      setCameraActive(true);
      setCameraLoading(false);
    } catch (err: any) {
      console.error('Kamera error:', err);
      setCameraActive(false);
      setCameraLoading(false);
      setCameraError(
        'Tidak dapat mengakses kamera. Pastikan browser memiliki izin akses kamera atau masukkan kode token secara manual.'
      );
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  const playBeep = (type: 'scan' | 'success' | 'warning' | 'error') => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === 'scan') {
        osc.frequency.value = 850;
        gain.gain.value = 0.25;
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } else if (type === 'success') {
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
        gain.gain.value = 0.35;
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === 'warning') {
        osc.frequency.value = 350;
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.value = 220;
        gain.gain.value = 0.4;
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch {}
  };

  const handleDetectedCode = async (rawCode: string) => {
    if (isProcessingRef.current || scanned || lookupLoading) return;
    isProcessingRef.current = true;
    playBeep('scan');
    if (scannerRef.current) {
      try {
        await scannerRef.current.pause();
      } catch {}
    }
    await lookupParticipant(rawCode.trim());
  };

  const lookupParticipant = async (token: string) => {
    setLookupLoading(true);
    setErrorMessage('');
    setConfirmResult(null);
    try {
      const authToken = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (res.ok && json.data) {
        const data = json.data as AnggotaData;
        setScanned(data);
        const alreadyScanned = data.scan_history?.[sesi]?.scanned;
        if (alreadyScanned) playBeep('warning');
      } else {
        playBeep('error');
        setErrorMessage(json.error || 'QR Code tidak terdaftar di sistem');
      }
    } catch (err: any) {
      playBeep('error');
      setErrorMessage('Terjadi gangguan saat memvalidasi QR: ' + err.message);
    } finally {
      setLookupLoading(false);
    }
  };

  const handleConfirmScan = async () => {
    if (!scanned) return;
    setConfirmLoading(true);
    setConfirmResult(null);
    try {
      const authToken = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ token: scanned.qr_token, sesi }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        playBeep('success');
        setConfirmResult({ ok: true, message: json.message || 'Presensi berhasil dicatat.' });
        // Update riwayat lokal
        setScanned({
          ...scanned,
          status_hadir: sesi === 'checkin' ? 'hadir' : scanned.status_hadir,
          scan_history: {
            ...(scanned.scan_history || {}),
            [sesi]: { scanned: true, scanned_at: json.scanned_at || new Date().toISOString() },
          },
        });
      } else {
        playBeep('error');
        setConfirmResult({ ok: false, message: json.error || 'Gagal mencatat presensi.' });
      }
    } catch {
      playBeep('error');
      setConfirmResult({ ok: false, message: 'Terjadi kesalahan koneksi saat konfirmasi.' });
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleNextScan = async () => {
    setScanned(null);
    setConfirmResult(null);
    setErrorMessage('');
    isProcessingRef.current = false;
    if (scannerRef.current) {
      try {
        await scannerRef.current.resume();
      } catch {
        await startScanner();
      }
    } else {
      await startScanner();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualToken.trim()) {
      handleDetectedCode(manualToken.trim());
      setManualToken('');
    }
  };

  const formatDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '-';
    try {
      let s = String(dateStr).trim();
      if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) s = s.replace(' ', 'T') + 'Z';
      const d = new Date(s);
      if (isNaN(d.getTime())) return dateStr!;
      return new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Jakarta',
      }).format(d);
    } catch {
      return dateStr!;
    }
  };

  const sesiLabel = SESI_LIST.find((s) => s.id === sesi)?.label || sesi;
  const sudahScanSesiIni = scanned?.scan_history?.[sesi]?.scanned || false;
  const isGrupLunas = scanned?.grup_status ? scanned.grup_status === 'lunas' : true;
  const tanpaJatahMakan = sesi !== 'checkin' && scanned ? scanned.is_gratis && !scanned.makan_dicover : false;
  const bisaKonfirmasi = !!scanned && isGrupLunas && !sudahScanSesiIni && !tanpaJatahMakan && !confirmResult?.ok;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold mb-1 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Scanner Presensi & Makan
          </div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Scanner QR Peserta</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pilih sesi, arahkan kamera ke QR peserta. Data akan muncul untuk diverifikasi sebelum dicatat.
          </p>
        </div>
        <Link
          to="/peserta?tab=individu"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 shadow-xs transition active:scale-95 shrink-0"
        >
          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Data Peserta</span>
        </Link>
      </div>

      {/* Pemilih Sesi */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 px-1">Pilih Sesi Scan</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SESI_LIST.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSesi(s.id);
                setConfirmResult(null);
              }}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer border ${
                sesi === s.id
                  ? 'bg-[#06305d] text-white border-[#06305d] shadow-xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span className="text-base leading-none">{s.icon}</span>
              <span className="leading-tight text-center">{s.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Kamera */}
        <div className="md:col-span-7 bg-white rounded-3xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-xs font-bold text-slate-800">
                  {cameraActive ? 'Kamera Aktif & Siap Memindai' : 'Kamera Menghubungkan...'}
                </span>
              </div>
              {cameraActive && (
                <button
                  onClick={startScanner}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                  title="Mulai Ulang Kamera"
                >
                  Reset Kamera
                </button>
              )}
            </div>

            <div className="relative w-full rounded-2xl overflow-hidden bg-slate-950 aspect-square flex items-center justify-center border-2 border-slate-800">
              <div id="qr-reader" className="w-full h-full object-cover"></div>

              {cameraActive && !scanned && !lookupLoading && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-56 h-56 border-2 border-dashed border-white/60 rounded-3xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                    <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-sky-400 rounded-tl-xl" />
                    <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-sky-400 rounded-tr-xl" />
                    <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-sky-400 rounded-bl-xl" />
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-sky-400 rounded-br-xl" />
                    <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_#34d399] animate-pulse top-1/2 -translate-y-1/2" />
                  </div>
                </div>
              )}

              {cameraLoading && (
                <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xs flex flex-col items-center justify-center text-white p-4 text-center z-10">
                  <div className="w-8 h-8 border-3 border-sky-400 border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-xs font-semibold">Mengaktifkan kamera perangkat...</p>
                </div>
              )}

              {cameraError && (
                <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center text-white p-6 text-center z-10">
                  <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-slate-300 mb-4 max-w-xs">{cameraError}</p>
                  <button
                    onClick={startScanner}
                    className="px-4 py-2 bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-bold rounded-xl transition active:scale-95 shadow-md cursor-pointer"
                  >
                    Coba Akses Kamera Lagi
                  </button>
                </div>
              )}

              {lookupLoading && (
                <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-xs flex flex-col items-center justify-center text-white z-20">
                  <div className="w-9 h-9 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-2" />
                  <p className="text-xs font-bold tracking-wide">Membaca Data Tiket...</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Atau input kode QR token secara manual:</p>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="Contoh: qr_12345678"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d]"
              />
              <button
                type="submit"
                disabled={!manualToken.trim() || lookupLoading}
                className="px-4 py-2 bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-bold rounded-xl transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                Cek Data
              </button>
            </form>
          </div>
        </div>

        {/* Panel Hasil */}
        <div className="md:col-span-5 flex flex-col">
          {!scanned && !errorMessage ? (
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-3xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </div>
              <h3 className="text-base font-black text-slate-800 mb-1">Siap Memindai</h3>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed mb-4">
                Posisikan QR Code peserta di dalam kotak kamera. Sesi aktif:{' '}
                <strong className="text-[#06305d]">{sesiLabel}</strong>.
              </p>
              <div className="p-3 bg-sky-50 rounded-2xl border border-sky-100 text-[11px] text-sky-800 max-w-xs text-left space-y-1">
                <p className="font-bold flex items-center gap-1"><span>💡</span> Alur:</p>
                <p>1. Pilih sesi (Check-in / Makan)</p>
                <p>2. Scan QR peserta</p>
                <p>3. Verifikasi data lalu konfirmasi</p>
              </div>
            </div>
          ) : errorMessage ? (
            <div className="bg-white rounded-3xl p-6 border border-rose-200 shadow-xs flex-1 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-3 border border-rose-200">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-base font-black text-slate-800 mb-1">QR Tidak Valid</h3>
              <p className="text-xs text-rose-600 font-medium mb-5 max-w-xs">{errorMessage}</p>
              <button
                onClick={handleNextScan}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-md transition active:scale-95 cursor-pointer"
              >
                Scan Ulang
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-lg flex-1 flex flex-col justify-between animate-in fade-in zoom-in-95 duration-150">
              <div>
                {/* Badge status */}
                <div className="mb-3 space-y-2">
                  {!isGrupLunas ? (
                    <div className="p-3 bg-rose-50 rounded-2xl border border-rose-200 text-rose-900 flex items-center gap-2">
                      <span className="text-base shrink-0">✕</span>
                      <div>
                        <p className="text-xs font-bold leading-tight">Grup Belum Lunas</p>
                        <p className="text-[10px] text-rose-700">Status: {scanned?.grup_status}. Tidak dapat dicatat.</p>
                      </div>
                    </div>
                  ) : sudahScanSesiIni ? (
                    <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 flex items-center gap-2">
                      <span className="text-base shrink-0">⚠️</span>
                      <div>
                        <p className="text-xs font-black leading-tight">SUDAH SCAN {sesiLabel.toUpperCase()}</p>
                        <p className="text-[10px] text-amber-800 mt-0.5">
                          Pada: {formatDateTime(scanned?.scan_history?.[sesi]?.scanned_at)}
                        </p>
                      </div>
                    </div>
                  ) : tanpaJatahMakan ? (
                    <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 flex items-center gap-2">
                      <span className="text-base shrink-0">🍼</span>
                      <div>
                        <p className="text-xs font-black leading-tight">TANPA JATAH MAKAN PANITIA</p>
                        <p className="text-[10px] text-amber-800 mt-0.5">Balita gratis, makan dicover orang tua.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-800 flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block shrink-0" />
                      <div>
                        <p className="text-xs font-bold leading-tight">✓ Tiket Valid — Sesi: {sesiLabel}</p>
                        <p className="text-[10px] text-emerald-700">Verifikasi identitas sebelum konfirmasi.</p>
                      </div>
                    </div>
                  )}

                  {confirmResult && (
                    <div
                      className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 ${
                        confirmResult.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                      }`}
                    >
                      <span className="text-lg">{confirmResult.ok ? '🎉' : '⚠️'}</span>
                      <p className="leading-snug">{confirmResult.message}</p>
                    </div>
                  )}
                </div>

                {/* Profil */}
                <div className="space-y-3">
                  <div className="border-b border-slate-100 pb-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Nomor Peserta</p>
                    <p className="text-sm font-mono font-black text-[#06305d]">{scanned?.nomor_peserta}</p>
                    <h3 className="text-lg font-black text-slate-900 mt-1 leading-tight">{scanned?.nama}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-[#06305d]/10 text-[#06305d] text-[10px] font-bold">
                        {scanned?.peran}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold">
                        {scanned?.jenis_kelamin} • {scanned?.usia != null ? `${scanned.usia} th` : '-'}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[10px] font-semibold">
                        {scanned?.kategori_usia_label}
                      </span>
                      {scanned?.is_gratis && (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                          {scanned?.makan_dicover ? 'Balita (cover)' : 'Gratis'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-xl text-xs">
                    <p className="text-[10px] text-slate-400 font-medium">Grup / PIC</p>
                    <p className="font-semibold text-slate-800 mt-0.5">{scanned?.grup}</p>
                    {scanned?.pic_whatsapp && (
                      <a
                        href={`https://wa.me/${scanned.pic_whatsapp.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-emerald-600 hover:underline font-semibold"
                      >
                        {scanned.pic_whatsapp} ↗
                      </a>
                    )}
                  </div>

                  {scanned?.catatan_medis && (
                    <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-200 text-xs">
                      <p className="text-[10px] text-rose-500 font-bold uppercase">⚠ Catatan Medis</p>
                      <p className="font-semibold text-rose-800 mt-0.5">{scanned.catatan_medis}</p>
                    </div>
                  )}

                  {/* Riwayat sesi */}
                  <div className="pt-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Status Sesi</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {SESI_LIST.map((s) => {
                        const item = scanned?.scan_history?.[s.id];
                        return (
                          <div
                            key={s.id}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-semibold border ${
                              item?.scanned
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-50 text-slate-400 border-slate-200'
                            }`}
                          >
                            <span>{item?.scanned ? '✓' : '○'}</span>
                            <span className="truncate">{s.short}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
                {bisaKonfirmasi ? (
                  <>
                    <button
                      onClick={handleConfirmScan}
                      disabled={confirmLoading}
                      className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black tracking-wide shadow-md hover:shadow-lg transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {confirmLoading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Menyimpan...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                          </svg>
                          <span>CATAT {sesiLabel.toUpperCase()}</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleNextScan}
                      disabled={confirmLoading}
                      className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                    >
                      Batal & Scan Ulang
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleNextScan}
                    className="w-full py-3 rounded-2xl bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-bold shadow-md transition active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    <span>Scan Peserta Berikutnya</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
