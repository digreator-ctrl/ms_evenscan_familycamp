export type SesiId = 'checkin' | 'makan_sabtu_siang' | 'makan_sabtu_malam' | 'makan_ahad_pagi';
export type MealSesiId = 'makan_sabtu_siang' | 'makan_sabtu_malam' | 'makan_ahad_pagi';

export const SESI_LIST: { id: SesiId; label: string; short: string }[] = [
  { id: 'checkin', label: 'Check-in Kehadiran', short: 'Check-in' },
  { id: 'makan_sabtu_siang', label: 'Makan Sabtu Siang', short: 'Sabtu Siang' },
  { id: 'makan_sabtu_malam', label: 'Makan Sabtu Malam', short: 'Sabtu Malam' },
  { id: 'makan_ahad_pagi', label: 'Makan Ahad Pagi', short: 'Ahad Pagi' },
];

export const MEAL_SESI_LIST: { id: MealSesiId; label: string; short: string }[] = [
  { id: 'makan_sabtu_siang', label: 'Makan Sabtu Siang', short: 'Sabtu Siang' },
  { id: 'makan_sabtu_malam', label: 'Makan Sabtu Malam', short: 'Sabtu Malam' },
  { id: 'makan_ahad_pagi', label: 'Makan Ahad Pagi', short: 'Ahad Pagi' },
];

export interface ScanHistoryItem {
  scanned: boolean;
  scanned_at?: string;
  scanned_by?: string;
}

export interface GrupAnggotaItem {
  id: string;
  nomor_peserta: string;
  nama: string;
  peran: string;
  jenis_kelamin: string;
  usia: number | null;
  kategori_usia: string;
  kategori_usia_label: string;
  ukuran_kaos?: string | null;
  catatan_medis?: string | null;
  is_gratis: boolean;
  makan_dicover: boolean;
  dapat_jatah_makan: boolean;
  status_hadir: string;
  attended_at: string | null;
  qr_token: string | null;
  scan_history: Record<string, ScanHistoryItem>;
}

export interface GrupScanPayload {
  grup: {
    id: string;
    nomor_grup: string | null;
    tipe: string;
    nama_grup: string;
    pic_nama: string;
    pic_whatsapp: string;
    status: string;
    jumlah_anggota: number;
  };
  scanned_anggota_id: string | null;
  anggota: GrupAnggotaItem[];
  sesi_tersedia?: { id: string; label: string }[];
}

export function playScannerBeep(type: 'scan' | 'success' | 'warning' | 'error') {
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
  } catch {
    /* ignore audio errors */
  }
}
