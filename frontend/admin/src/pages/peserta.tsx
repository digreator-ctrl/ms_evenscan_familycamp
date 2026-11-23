import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Verifikasi } from './verifikasi';
import { RiwayatScan } from './riwayat-scan';

type Tab = 'verifikasi' | 'individu';

function initialTab(): Tab {
  try {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'individu' ? 'individu' : 'verifikasi';
  } catch {
    return 'verifikasi';
  }
}

export function Peserta() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(initialTab);
  const detailId = searchParams.get('id');

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 sm:flex-none inline-flex items-center justify-center px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
        tab === id ? 'bg-[#06305d] text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span>{label}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      {!detailId && (
        <div className="inline-flex w-full sm:w-auto p-1 bg-white border border-slate-200 rounded-xl shadow-xs gap-1">
          {tabBtn('verifikasi', 'Verifikasi Grup')}
          {tabBtn('individu', 'Data Individu')}
        </div>
      )}

      {tab === 'verifikasi' ? <Verifikasi /> : <RiwayatScan />}
    </div>
  );
}
