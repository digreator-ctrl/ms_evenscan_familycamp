import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { GrupScanPayload, playScannerBeep } from '../types/scanner';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

export function Scanner() {
  const navigate = useNavigate();

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [scanError, setScanError] = useState('');

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState('');

  const scannerRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const isProcessingRef = useRef(false);
  const manualOpenRef = useRef(false);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    manualOpenRef.current = manualModalOpen;
    if (manualModalOpen) {
      setTimeout(() => manualInputRef.current?.focus(), 80);
    }
  }, [manualModalOpen]);

  useEffect(() => {
    isMountedRef.current = true;
    const timer = setTimeout(() => {
      if (isMountedRef.current) startScanner('environment');
    }, 180);

    return () => {
      isMountedRef.current = false;
      clearTimeout(timer);
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScanner = async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    if (inst) {
      try {
        if (inst.isScanning) await inst.stop();
      } catch {
        /* ignore stop errors */
      }
      try {
        inst.clear();
      } catch {
        /* ignore clear errors */
      }
    }
    if (isMountedRef.current) {
      setCameraActive(false);
      setTorchOn(false);
      setTorchSupported(false);
    }
  };

  const startScanner = async (targetMode: 'environment' | 'user' = facingMode) => {
    if (!isMountedRef.current) return;
    setCameraLoading(true);
    setCameraError('');
    setTorchOn(false);
    setTorchSupported(false);

    await stopScanner();
    if (!isMountedRef.current) return;

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      const scanConfig = {
        fps: 12,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.max(170, Math.min(280, Math.floor(minEdge * 0.68)));
          return { width: size, height: size };
        },
      };

      try {
        await scanner.start(
          { facingMode: targetMode },
          scanConfig,
          (decodedText: string) => handleDetectedCode(decodedText),
          () => {}
        );
      } catch (firstErr) {
        if (targetMode === 'environment') {
          await scanner.start(
            { facingMode: 'user' },
            scanConfig,
            (decodedText: string) => handleDetectedCode(decodedText),
            () => {}
          );
          if (isMountedRef.current) setFacingMode('user');
        } else {
          throw firstErr;
        }
      }

      if (!isMountedRef.current) {
        await stopScanner();
        return;
      }

      setCameraActive(true);
      setCameraLoading(false);

      // Deteksi dukungan senter / torch pada kamera yang aktif
      try {
        const caps = scanner.getRunningTrackCameraCapabilities();
        const torch = caps?.torchFeature?.();
        if (torch && torch.isSupported()) {
          setTorchSupported(true);
        }
      } catch {
        setTorchSupported(false);
      }
    } catch (err: any) {
      console.error('Kamera error:', err);
      if (!isMountedRef.current) return;
      setCameraActive(false);
      setCameraLoading(false);
      setCameraError(
        'Tidak dapat mengakses kamera perangkat. Pastikan izin kamera aktif atau gunakan input manual kode akses / nomor WA PIC.'
      );
    }
  };

  const handleExitToDashboard = async () => {
    await stopScanner();
    navigate('/');
  };

  const handleSwitchCamera = async () => {
    const nextMode: 'environment' | 'user' = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    await startScanner(nextMode);
  };

  const handleToggleTorch = async () => {
    const inst = scannerRef.current;
    if (!inst || !torchSupported) return;
    try {
      const torch = inst.getRunningTrackCameraCapabilities()?.torchFeature?.();
      if (!torch || !torch.isSupported()) return;
      const next = !torchOn;
      await torch.apply(next);
      setTorchOn(next);
    } catch (err) {
      console.warn('Gagal mengubah status flash:', err);
    }
  };

  const resumeCameraAfterError = async () => {
    setScanError('');
    isProcessingRef.current = false;
    if (scannerRef.current) {
      try {
        await scannerRef.current.resume();
        return;
      } catch {
        /* fallback restart */
      }
    }
    await startScanner(facingMode);
  };

  const navigateToGroup = async (payload: GrupScanPayload) => {
    await stopScanner();
    const params = new URLSearchParams({ grup: payload.grup.id });
    if (payload.scanned_anggota_id) {
      params.set('anggota', payload.scanned_anggota_id);
    }
    navigate(`/scanner/grup?${params.toString()}`, {
      state: { initialData: payload },
    });
  };

  const handleDetectedCode = async (rawCode: string) => {
    if (isProcessingRef.current || manualOpenRef.current) return;
    const clean = rawCode.trim();
    if (!clean) return;

    isProcessingRef.current = true;
    playScannerBeep('scan');
    setScanError('');
    setLookupLoading(true);

    if (scannerRef.current) {
      try {
        await scannerRef.current.pause();
      } catch {
        /* ignore pause failure */
      }
    }

    try {
      const authToken = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ token: clean }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        await navigateToGroup(json.data as GrupScanPayload);
      } else {
        playScannerBeep('error');
        setScanError(json.error || 'QR Code tidak terdaftar di sistem.');
      }
    } catch (err: any) {
      playScannerBeep('error');
      setScanError('Gagal terhubung ke server: ' + err.message);
    } finally {
      if (isMountedRef.current) setLookupLoading(false);
    }
  };

  const handleOpenManualModal = async () => {
    setManualError('');
    setManualModalOpen(true);
    if (scannerRef.current) {
      try {
        await scannerRef.current.pause();
      } catch {
        /* ignore */
      }
    }
  };

  const handleCloseManualModal = async () => {
    setManualModalOpen(false);
    setManualError('');
    if (!scanError && scannerRef.current) {
      try {
        await scannerRef.current.resume();
      } catch {
        await startScanner(facingMode);
      }
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = manualQuery.trim();
    if (!query) {
      setManualError('Masukkan kode akses grup atau nomor WA penanggung jawab.');
      return;
    }

    setManualLoading(true);
    setManualError('');
    try {
      const authToken = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ query }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        playScannerBeep('scan');
        await navigateToGroup(json.data as GrupScanPayload);
      } else {
        playScannerBeep('error');
        setManualError(json.error || 'Data grup tidak ditemukan.');
      }
    } catch (err: any) {
      playScannerBeep('error');
      setManualError('Terjadi gangguan koneksi: ' + err.message);
    } finally {
      if (isMountedRef.current) setManualLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black text-white overflow-hidden select-none flex flex-col">
      {/* Layer 1: Video Kamera Penuh Layar */}
      <div className="absolute inset-0 bg-slate-950">
        <div id="qr-reader" className="qr-fullscreen-reader w-full h-full" />
      </div>

      {/* Layer 2: Frame Bidik QR di Tengah (saat kamera aktif) */}
      {cameraActive && !lookupLoading && !scanError && !manualModalOpen && (
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-10 px-6">
          <div className="w-64 h-64 sm:w-72 sm:h-72 relative rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
            <div className="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-4 border-l-4 border-sky-400 rounded-tl-2xl" />
            <div className="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-4 border-r-4 border-sky-400 rounded-tr-2xl" />
            <div className="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-4 border-l-4 border-sky-400 rounded-bl-2xl" />
            <div className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-4 border-r-4 border-sky-400 rounded-br-2xl" />
            <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_14px_#34d399] animate-pulse" />
          </div>
          <p className="mt-6 px-4 py-1.5 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-xs font-medium text-white/95 text-center">
            Arahkan kamera ke QR Code tiket peserta
          </p>
        </div>
      )}

      {/* Layer 3: Header Kontrol Atas (Pojok Kiri X + Kontrol Kamera Kanan) */}
      <header className="relative z-20 flex items-center justify-between px-4 pt-4 pb-6 bg-gradient-to-b from-black/75 via-black/35 to-transparent">
        <button
          type="button"
          onClick={handleExitToDashboard}
          aria-label="Keluar dari scanner"
          title="Kembali ke Dashboard"
          className="w-11 h-11 rounded-full bg-black/50 hover:bg-black/75 border border-white/25 text-white flex items-center justify-center backdrop-blur-md active:scale-95 transition cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 border border-white/15 backdrop-blur-md text-[11px] font-bold">
          <span
            className={`w-2 h-2 rounded-full ${
              cameraActive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
          <span>{cameraActive ? 'Siap Memindai QR' : cameraLoading ? 'Menyiapkan Kamera...' : 'Kamera Nonaktif'}</span>
        </div>

        <div className="flex items-center gap-2">
          {cameraActive && torchSupported && (
            <button
              type="button"
              onClick={handleToggleTorch}
              aria-label="Lampu senter"
              title={torchOn ? 'Matikan Senter' : 'Nyalakan Senter'}
              className={`w-11 h-11 rounded-full border flex items-center justify-center backdrop-blur-md active:scale-95 transition cursor-pointer ${
                torchOn
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-lg shadow-amber-400/30'
                  : 'bg-black/50 hover:bg-black/75 text-white border-white/25'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleSwitchCamera}
            aria-label="Ganti kamera"
            title="Ganti Kamera Depan / Belakang"
            className="w-11 h-11 rounded-full bg-black/50 hover:bg-black/75 border border-white/25 text-white flex items-center justify-center backdrop-blur-md active:scale-95 transition cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Spacer Tengah */}
      <div className="flex-1" />

      {/* Loading Kamera */}
      {cameraLoading && (
        <div className="absolute inset-0 z-15 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-10 h-10 border-3 border-sky-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm font-bold">Mengaktifkan Kamera...</p>
          <p className="text-xs text-slate-400 mt-1">Izinkan akses kamera pada browser bila diminta.</p>
        </div>
      )}

      {/* Loading Lookup Setelah Scan */}
      {lookupLoading && (
        <div className="absolute inset-0 z-30 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
          <div className="w-11 h-11 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm font-bold tracking-wide">Membaca Data Grup Peserta...</p>
        </div>
      )}

      {/* Error Kamera */}
      {cameraError && !cameraLoading && (
        <div className="absolute inset-0 z-15 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-base font-black text-white mb-1.5">Kamera Tidak Tersedia</h2>
          <p className="text-xs text-slate-300 max-w-xs leading-relaxed mb-5">{cameraError}</p>
          <div className="flex flex-col sm:flex-row gap-2.5 w-full max-w-xs">
            <button
              type="button"
              onClick={() => startScanner(facingMode)}
              className="flex-1 py-3 px-4 rounded-xl bg-white text-slate-900 font-bold text-xs shadow-md active:scale-95 transition cursor-pointer"
            >
              Coba Lagi
            </button>
            <button
              type="button"
              onClick={handleOpenManualModal}
              className="flex-1 py-3 px-4 rounded-xl bg-[#06305d] border border-sky-400/30 text-white font-bold text-xs shadow-md active:scale-95 transition cursor-pointer"
            >
              Input Manual
            </button>
          </div>
        </div>
      )}

      {/* Error QR Tidak Dikenal */}
      {scanError && !lookupLoading && (
        <div className="absolute inset-0 z-30 bg-black/75 backdrop-blur-sm flex items-center justify-center p-5">
          <div className="w-full max-w-sm bg-slate-900 border border-rose-500/40 rounded-3xl p-6 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-base font-black text-white mb-1">QR Tidak Valid</h3>
            <p className="text-xs text-rose-300 leading-relaxed mb-5">{scanError}</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={resumeCameraAfterError}
                className="w-full py-3 rounded-xl bg-white text-slate-900 text-xs font-black active:scale-95 transition cursor-pointer"
              >
                Scan Ulang
              </button>
              <button
                type="button"
                onClick={() => {
                  setScanError('');
                  isProcessingRef.current = false;
                  handleOpenManualModal();
                }}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition cursor-pointer"
              >
                Cari via Kode Akses / No. WA PIC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer: Tombol Input Manual Kode Akses / Nomor WA PIC */}
      <footer className="relative z-20 px-4 pb-6 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex justify-center">
        <button
          type="button"
          onClick={handleOpenManualModal}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 backdrop-blur-md text-xs font-bold text-white shadow-xl active:scale-95 transition cursor-pointer"
        >
          <svg className="w-4 h-4 text-sky-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          <span>Input Kode Akses / No. WA PIC</span>
        </button>
      </footer>

      {/* Modal Input Manual */}
      {manualModalOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={handleCloseManualModal}
        >
          <div
            className="w-full sm:max-w-md bg-white text-slate-900 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900">Cari Grup Secara Manual</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Masukkan <strong>Kode Akses</strong> atau <strong>Nomor WA Penanggung Jawab</strong> grup.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseManualModal}
                aria-label="Tutup popup"
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Kode Akses / No. WA PIC
                </label>
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  placeholder="Contoh: ahmad1234 atau 081234567890"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06305d]/20 focus:border-[#06305d]"
                />
              </div>

              {manualError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                  {manualError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCloseManualModal}
                  disabled={manualLoading}
                  className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={manualLoading || !manualQuery.trim()}
                  className="flex-[2] py-3 rounded-xl bg-[#06305d] hover:bg-[#0a4583] text-white text-xs font-black shadow-md transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {manualLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Mencari...</span>
                    </>
                  ) : (
                    <span>Buka Data Grup</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
