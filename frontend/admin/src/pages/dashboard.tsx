import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

type GenderKey = 'ikhwan' | 'akhwat' | 'tidak_diketahui';

interface KategoriBreakdown {
  total: number;
  ikhwan: number;
  akhwat: number;
}

interface PesertaBreakdown {
  total: number;
  gender: Record<GenderKey, number>;
  per_kategori: Record<string, KategoriBreakdown>;
}

interface PembayaranRow {
  jumlah_grup: number;
  jumlah_peserta: number;
  tagihan: number;
  diterima: number;
  kurang?: number;
  lebih?: number;
}

interface SesiKonsumsi {
  sudah: number;
  belum: number;
  total: number;
  persentase: number;
}

interface DashboardData {
  pembayaran: {
    menunggu_pembayaran: PembayaranRow;
    menunggu_verifikasi: PembayaranRow;
    lunas: PembayaranRow;
    ditolak: PembayaranRow;
    total: PembayaranRow;
  };
  peserta: {
    terdaftar: PesertaBreakdown;
    hadir: PesertaBreakdown;
  };
  konsumsi: {
    total_berjatah: number;
    tanpa_jatah: number;
    sesi: Record<string, SesiKonsumsi>;
  };
  persentase_kehadiran: {
    terhadap_semua_terdaftar: number;
    terhadap_lunas: number;
  };
  generated_at: string;
}

const KATEGORI_URUTAN = ['balita', 'anak', 'remaja', 'dewasa', 'lansia'];

const LABEL_KATEGORI: Record<string, string> = {
  balita: 'Balita (0-5 th)',
  anak: 'Anak-Anak (6-10 th)',
  remaja: 'Remaja (11-17 th)',
  dewasa: 'Dewasa (18-50 th)',
  lansia: 'Lansia (51+ th)',
  tidak_diketahui: 'Tidak diketahui',
};

const LABEL_SESI: Record<string, string> = {
  makan_sabtu_siang: 'Makan Sabtu Siang',
  makan_sabtu_malam: 'Makan Sabtu Malam',
  makan_ahad_pagi: 'Makan Ahad Pagi',
};

function barisKategori(data: PesertaBreakdown): { id: string; label: string }[] {
  const ids = Array.from(new Set([...KATEGORI_URUTAN, ...Object.keys(data.per_kategori)]))
    .filter((id) => id !== 'tidak_diketahui');
  return ids.map((id) => ({ id, label: LABEL_KATEGORI[id] ?? id.replace(/_/g, ' ') }));
}

const TONE_KELAS = {
  white: 'bg-white border-slate-200 text-slate-900',
  amber: 'bg-amber-50/70 border-amber-200 text-amber-950',
  sky: 'bg-sky-50/70 border-sky-200 text-sky-950',
  emerald: 'bg-emerald-50/70 border-emerald-200 text-emerald-950',
  slate: 'bg-slate-50 border-slate-200 text-slate-700',
} as const;

type Tone = keyof typeof TONE_KELAS;

type Tab = 'pembayaran' | 'peserta' | 'kehadiran';

const TAB_LIST: { id: Tab; label: string }[] = [
  { id: 'pembayaran', label: 'Pembayaran & Grup' },
  { id: 'peserta', label: 'Peserta' },
  { id: 'kehadiran', label: 'Kehadiran & Konsumsi' },
];

function buatKategoriKosong(): Record<string, KategoriBreakdown> {
  const rows: Record<string, KategoriBreakdown> = {};
  for (const id of KATEGORI_URUTAN) rows[id] = { total: 0, ikhwan: 0, akhwat: 0 };
  return rows;
}

function buatBreakdownKosong(): PesertaBreakdown {
  return {
    total: 0,
    gender: { ikhwan: 0, akhwat: 0, tidak_diketahui: 0 },
    per_kategori: buatKategoriKosong(),
  };
}

function dashboardKosong(): DashboardData {
  return {
    pembayaran: {
      menunggu_pembayaran: { jumlah_grup: 0, jumlah_peserta: 0, tagihan: 0, diterima: 0 },
      menunggu_verifikasi: { jumlah_grup: 0, jumlah_peserta: 0, tagihan: 0, diterima: 0 },
      lunas: { jumlah_grup: 0, jumlah_peserta: 0, tagihan: 0, diterima: 0, kurang: 0, lebih: 0 },
      ditolak: { jumlah_grup: 0, jumlah_peserta: 0, tagihan: 0, diterima: 0 },
      total: { jumlah_grup: 0, jumlah_peserta: 0, tagihan: 0, diterima: 0 },
    },
    peserta: {
      terdaftar: buatBreakdownKosong(),
      hadir: buatBreakdownKosong(),
    },
    konsumsi: {
      total_berjatah: 0,
      tanpa_jatah: 0,
      sesi: Object.fromEntries(
        Object.keys(LABEL_SESI).map((id) => [id, { sudah: 0, belum: 0, total: 0, persentase: 0 }])
      ),
    },
    persentase_kehadiran: { terhadap_semua_terdaftar: 0, terhadap_lunas: 0 },
    generated_at: new Date().toISOString(),
  };
}

function tabDariUrl(raw: string | null): Tab {
  return raw === 'peserta' || raw === 'kehadiran' ? raw : 'pembayaran';
}

function formatRupiah(n: number): string {
  return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
}

function StatCard({
  label,
  value,
  hint,
  tone = 'white',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`border rounded-2xl p-4 sm:p-5 shadow-xs ${TONE_KELAS[tone]}`}>
      <span className="text-xs font-bold uppercase tracking-wider opacity-70">{label}</span>
      <span className="block text-2xl sm:text-3xl font-black mt-1 leading-tight">{value}</span>
      {hint && <p className="text-[11px] opacity-70 mt-1">{hint}</p>}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'white',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`border rounded-2xl p-4 shadow-xs ${TONE_KELAS[tone]}`}>
      <div className="flex items-center justify-between gap-3 sm:block">
        <span className="text-xs font-bold uppercase tracking-wider opacity-70">{label}</span>
        <span className="text-2xl font-black leading-tight sm:block sm:mt-1 sm:text-3xl">{value}</span>
      </div>
      {hint && <p className="text-[11px] opacity-70 mt-1">{hint}</p>}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full bg-[#06305d] transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function MatrixTable({ data }: { data: PesertaBreakdown }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left font-bold px-3 py-2">Kategori</th>
            <th className="text-right font-bold px-3 py-2">Ikhwan</th>
            <th className="text-right font-bold px-3 py-2">Akhwat</th>
            <th className="text-right font-bold px-3 py-2">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {barisKategori(data).map((k) => {
            const row = data.per_kategori[k.id] || { total: 0, ikhwan: 0, akhwat: 0 };
            return (
              <tr key={k.id} className="text-slate-700">
                <td className="px-3 py-2">{k.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.ikhwan}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.akhwat}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{row.total}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="bg-slate-50 font-bold text-slate-900">
          <tr>
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right tabular-nums">{data.gender.ikhwan}</td>
            <td className="px-3 py-2 text-right tabular-nums">{data.gender.akhwat}</td>
            <td className="px-3 py-2 text-right tabular-nums">{data.total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function BlokPeserta({ title, data, tone }: { title: string; data: PesertaBreakdown; tone: Tone }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h2>

      {/* Mobile: satu card ringkas (total besar + ikhwan/akhwat di bawah) */}
      <div className={`sm:hidden border rounded-2xl p-4 shadow-xs ${TONE_KELAS[tone]}`}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-black leading-tight">{data.total}</span>
          <span className="text-xs font-medium opacity-70">peserta</span>
        </div>
        <p className="text-[11px] opacity-70 mt-1">
          {data.gender.ikhwan} ikhwan • {data.gender.akhwat} akhwat
        </p>
      </div>

      {/* Desktop/tablet: tiga card */}
      <div className="hidden sm:grid grid-cols-3 gap-3">
        <StatCard label="Total" value={data.total} tone={tone} />
        <StatCard label="Ikhwan" value={data.gender.ikhwan} tone={tone} />
        <StatCard label="Akhwat" value={data.gender.akhwat} tone={tone} />
      </div>

      <MatrixTable data={data} />
    </section>
  );
}

export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabDariUrl(searchParams.get('tab'));

  const [data, setData] = useState<DashboardData>(() => dashboardKosong());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/absensi/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardData;
      setData(json);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
      setError('Gagal memuat data dashboard. Pastikan sesi login masih valid.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(true), 15000);
    const handleFocus = () => fetchData(true);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchData]);

  const gantiTab = (next: Tab) => {
    setSearchParams({ tab: next }, { replace: true });
  };

  const { pembayaran, peserta, konsumsi, persentase_kehadiran } = data;

  const kartuPembayaran: { label: string; hint: string; row: PembayaranRow; tone: Tone }[] = [
    {
      label: 'Menunggu Bayar',
      hint: 'Belum unggah bukti transfer',
      row: pembayaran.menunggu_pembayaran,
      tone: 'amber',
    },
    {
      label: 'Menunggu Verifikasi',
      hint: 'Bukti transfer masuk, perlu ACC',
      row: pembayaran.menunggu_verifikasi,
      tone: 'sky',
    },
    {
      label: 'Lunas (Terverifikasi)',
      hint: 'QR tiket telah diterbitkan',
      row: pembayaran.lunas,
      tone: 'emerald',
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Dashboard Panitia</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Ringkasan pembayaran grup, data peserta, serta kehadiran & konsumsi Family Camp.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-semibold px-3 py-2">
          {error}
        </div>
      )}

      {/* Strip KPI */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Total Peserta"
          value={loading ? '...' : peserta.terdaftar.total}
          hint={`${peserta.terdaftar.gender.ikhwan} ikhwan • ${peserta.terdaftar.gender.akhwat} akhwat`}
          tone="white"
        />
        <KpiCard
          label="Total Grup"
          value={loading ? '...' : pembayaran.total.jumlah_grup}
          hint="Seluruh grup terdaftar"
          tone="white"
        />
        <KpiCard
          label="Hadir (Check-in)"
          value={loading ? '...' : peserta.hadir.total}
          hint={`dari ${peserta.terdaftar.total} peserta terdaftar`}
          tone="emerald"
        />
        <KpiCard
          label="% Kehadiran"
          value={loading ? '...' : `${persentase_kehadiran.terhadap_semua_terdaftar}%`}
          hint={`vs lunas: ${persentase_kehadiran.terhadap_lunas}%`}
          tone="sky"
        />
      </section>

      {/* Tab */}
      <div className="inline-flex w-full sm:w-auto p-1 bg-white border border-slate-200 rounded-xl shadow-xs gap-1 overflow-x-auto">
        {TAB_LIST.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => gantiTab(t.id)}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              tab === t.id ? 'bg-[#06305d] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab 1 — Pembayaran & Grup */}
      {tab === 'pembayaran' && (
        <section className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {kartuPembayaran.map((k) => {
              const selisihKurang = Math.max(k.row.kurang ?? 0, 0);
              const selisihLebih = Math.max(k.row.lebih ?? 0, 0);
              return (
                <div key={k.label} className={`border rounded-2xl p-4 sm:p-5 shadow-xs ${TONE_KELAS[k.tone]}`}>
                  <div className="flex items-center justify-between gap-3 sm:block">
                    <span className="text-xs font-bold uppercase tracking-wider opacity-70">{k.label}</span>
                    <span className="text-2xl sm:text-3xl font-black leading-tight whitespace-nowrap sm:block sm:mt-1">
                      {k.row.jumlah_grup} <span className="text-xs font-medium opacity-70">grup</span>
                    </span>
                  </div>

                  <div className="sm:hidden flex items-center justify-between gap-3 text-xs mt-2">
                    <span className="opacity-70">Jumlah peserta</span>
                    <span className="font-bold tabular-nums">{k.row.jumlah_peserta} peserta</span>
                  </div>

                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="opacity-70">Tagihan</dt>
                      <dd className="font-bold tabular-nums">{formatRupiah(k.row.tagihan)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="opacity-70">Diterima</dt>
                      <dd className="font-bold tabular-nums">{formatRupiah(k.row.diterima)}</dd>
                    </div>
                    {k.row.kurang !== undefined && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="opacity-70">Kurang / Lebih</dt>
                        <dd className="font-bold tabular-nums">
                          {formatRupiah(selisihKurang)} / {formatRupiah(selisihLebih)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <p className="text-[11px] opacity-70 mt-2">{k.hint}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Ditolak</span>
                <p className="text-[11px] text-slate-400 mt-0.5">Tidak dihitung sebagai peserta terdaftar</p>
              </div>
              <div className="text-right">
                <span className="block text-2xl font-black text-slate-700">{pembayaran.ditolak.jumlah_grup} grup</span>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {formatRupiah(pembayaran.ditolak.tagihan)}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-[#06305d]/20 bg-[#06305d] text-white p-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-sky-200">Total</span>
                <p className="text-[11px] text-sky-100/80 mt-0.5">Akumulasi seluruh grup aktif</p>
              </div>
              <div className="text-right">
                <span className="block text-2xl font-black">{pembayaran.total.jumlah_grup} grup</span>
                <span className="text-[11px] text-sky-100/90 tabular-nums">
                  Tagihan {formatRupiah(pembayaran.total.tagihan)} • Diterima{' '}
                  {formatRupiah(pembayaran.total.diterima)}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Tab 2 — Peserta */}
      {tab === 'peserta' && (
        <div className="space-y-6">
          <BlokPeserta title="Peserta Terdaftar" data={peserta.terdaftar} tone="white" />
          <BlokPeserta title="Hadir (Check-in)" data={peserta.hadir} tone="emerald" />
        </div>
      )}

      {/* Tab 3 — Kehadiran & Konsumsi */}
      {tab === 'kehadiran' && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Ringkasan Check-in</h2>
                <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">
                  {peserta.hadir.total}
                  <span className="text-sm font-medium text-slate-400 ml-1.5">/ {peserta.terdaftar.total} peserta</span>
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>
                  <span className="font-bold text-slate-700">{persentase_kehadiran.terhadap_semua_terdaftar}%</span>{' '}
                  dari terdaftar
                </p>
                <p>
                  <span className="font-bold text-slate-700">{persentase_kehadiran.terhadap_lunas}%</span> dari
                  peserta lunas
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Terhadap semua terdaftar</span>
                <span className="font-bold">{persentase_kehadiran.terhadap_semua_terdaftar}%</span>
              </div>
              <ProgressBar value={persentase_kehadiran.terhadap_semua_terdaftar} />
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>Terhadap peserta lunas</span>
                <span className="font-bold">{persentase_kehadiran.terhadap_lunas}%</span>
              </div>
              <ProgressBar value={persentase_kehadiran.terhadap_lunas} />
            </div>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <StatCard
              label="Total Berjatah Makan"
              value={konsumsi.total_berjatah}
              hint="Peserta lunas & berhak jatah makan panitia"
              tone="emerald"
            />
            <StatCard
              label="Tanpa Jatah"
              value={konsumsi.tanpa_jatah}
              hint="Balita gratis tanpa cover (makan dicover orang tua)"
              tone="slate"
            />
          </section>

          <section className="space-y-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Konsumsi per Sesi</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {Object.entries(konsumsi.sesi).map(([id, row]) => {
                return (
                  <div key={id} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {LABEL_SESI[id] ?? id.replace(/_/g, ' ')}
                    </span>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-2xl sm:text-3xl font-black text-slate-900">{row.sudah}</span>
                      <span className="text-xs font-medium text-slate-400">/ {row.total} sudah</span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={row.persentase} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Belum: {row.belum}</span>
                      <span className="font-bold text-slate-700">{row.persentase}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              Persentase konsumsi dihitung dari peserta lunas & berjatah makan.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
