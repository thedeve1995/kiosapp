import { useState, useMemo } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, X, CheckCircle2, Search, ChevronDown, ChevronUp,
  Banknote, Building2, QrCode, Loader2, ArrowLeft, Wallet, History, AlertCircle
} from 'lucide-react';
import {
  KASBON_PAYMENT_METHODS,
  getKasbonMethodMeta,
  getKasbonSummary,
} from '../lib/kasbon';

const METHOD_ICONS = {
  cash: Banknote,
  transfer: Building2,
  qris: QrCode,
};

function formatDateTime(msOrTs) {
  if (!msOrTs) return '-';
  const d = typeof msOrTs === 'number'
    ? new Date(msOrTs)
    : msOrTs.seconds
      ? new Date(msOrTs.seconds * 1000)
      : new Date(msOrTs);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function KasbonModal({
  open,
  onClose,
  kasbonList,
  loadingCancel,
  onRequestCancel,
  onSubmitPayment,
}) {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [selectedKasbon, setSelectedKasbon] = useState(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [payAmountInput, setPayAmountInput] = useState('');
  const [payNote, setPayNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const totalSisaPiutang = useMemo(
    () => kasbonList.reduce((sum, k) => sum + getKasbonSummary(k).remaining, 0),
    [kasbonList]
  );

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return kasbonList;
    return kasbonList.filter(
      (k) =>
        (k.kasbonName || '').toLowerCase().includes(q) ||
        k.items?.some((it) => (it.name || '').toLowerCase().includes(q))
    );
  }, [kasbonList, search]);

  // Keep selectedKasbon synced with live kasbonList updates
  const liveSelectedKasbon = useMemo(() => {
    if (!selectedKasbon) return null;
    return kasbonList.find((k) => k.id === selectedKasbon.id) || selectedKasbon;
  }, [kasbonList, selectedKasbon]);

  const openPayForm = (kasbon) => {
    const { remaining } = getKasbonSummary(kasbon);
    setSelectedKasbon(kasbon);
    setPayMethod('cash');
    setPayAmountInput(String(remaining));
    setPayNote('');
    setFormError('');
  };

  const closePayForm = () => {
    if (submitting) return;
    setSelectedKasbon(null);
    setFormError('');
  };

  const handleCloseModal = () => {
    if (submitting) return;
    setSelectedKasbon(null);
    setFormError('');
    onClose();
  };

  const selectedSummary = liveSelectedKasbon ? getKasbonSummary(liveSelectedKasbon) : null;
  const parsedAmount = Math.round(Number(payAmountInput) || 0);
  const remainingAfter = selectedSummary
    ? Math.max(0, selectedSummary.remaining - parsedAmount)
    : 0;
  const isFullPayment = selectedSummary && parsedAmount > 0 && parsedAmount === selectedSummary.remaining;
  const isAmountValid =
    selectedSummary && parsedAmount > 0 && parsedAmount <= selectedSummary.remaining;
  const selectedMethodMeta = getKasbonMethodMeta(payMethod);

  const handleQuickAmount = (ratio) => {
    if (!selectedSummary) return;
    if (ratio >= 1) {
      setPayAmountInput(String(selectedSummary.remaining));
      setFormError('');
      return;
    }
    const raw = selectedSummary.remaining * ratio;
    const rounded = selectedSummary.remaining >= 10000
      ? Math.max(1000, Math.round(raw / 1000) * 1000)
      : Math.max(1, Math.round(raw));
    setPayAmountInput(String(Math.min(selectedSummary.remaining, rounded)));
    setFormError('');
  };

  const handleConfirmPayment = async (e) => {
    e.preventDefault();
    if (!liveSelectedKasbon || !selectedSummary) return;
    if (parsedAmount <= 0) {
      setFormError('Masukkan nominal pembayaran yang valid.');
      return;
    }
    if (parsedAmount > selectedSummary.remaining) {
      setFormError(
        `Nominal melebihi sisa tagihan (Rp ${selectedSummary.remaining.toLocaleString('id-ID')}).`
      );
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await onSubmitPayment({
        kasbon: liveSelectedKasbon,
        amount: parsedAmount,
        paymentMethod: payMethod,
        note: payNote,
      });
      setSelectedKasbon(null);
      setPayNote('');
    } catch (err) {
      setFormError(err?.message || 'Gagal memproses pembayaran kasbon.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCloseModal}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />
          <Motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28 }}
            className="fixed bottom-0 left-0 right-0 max-h-[85vh] bg-white dark:bg-slate-800 rounded-t-3xl p-5 sm:p-6 z-50 flex flex-col border-t border-slate-200/50 dark:border-slate-700/50"
          >
            {/* ── Header ── */}
            <div className="flex justify-between items-center mb-4 gap-2">
              {liveSelectedKasbon ? (
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    onClick={closePayForm}
                    disabled={submitting}
                    className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-all shrink-0"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-slate-900 dark:text-white truncate">
                      Bayar / Cicil Kasbon
                    </h2>
                    <p className="text-[11px] font-bold text-slate-500 truncate">
                      {liveSelectedKasbon.kasbonName || 'Konsumen'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="min-w-0">
                  <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <ClipboardList size={22} className="text-amber-600 dark:text-amber-400 shrink-0" />
                    Daftar Kasbon
                    <span className="bg-red-500 text-white text-[10px] font-black min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center">
                      {kasbonList.length}
                    </span>
                  </h2>
                  {kasbonList.length > 0 && (
                    <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mt-0.5">
                      Total Sisa Piutang: Rp {totalSisaPiutang.toLocaleString('id-ID')}
                    </p>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={submitting}
                className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-400 shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {/* ── Body: Payment Form View vs List View ── */}
            {liveSelectedKasbon && selectedSummary ? (
              <form onSubmit={handleConfirmPayment} className="flex-1 overflow-y-auto space-y-4 pr-0.5">
                {/* Bill summary box */}
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-600 dark:text-slate-400 font-bold">Total Utang Awal</span>
                    <span className="font-black text-slate-800 dark:text-slate-200">
                      Rp {selectedSummary.total.toLocaleString('id-ID')}
                    </span>
                  </div>
                  {selectedSummary.paid > 0 && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">Sudah Dibayar</span>
                      <span className="font-black text-emerald-600 dark:text-emerald-400">
                        Rp {selectedSummary.paid.toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-2 border-t border-amber-500/20">
                    <span className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      Sisa Tagihan
                    </span>
                    <span className="text-lg font-black text-amber-600 dark:text-amber-400">
                      Rp {selectedSummary.remaining.toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>

                {/* Payment method selector */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
                    Metode Pembayaran
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {KASBON_PAYMENT_METHODS.map((m) => {
                      const Icon = METHOD_ICONS[m.id] || Banknote;
                      const active = payMethod === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPayMethod(m.id)}
                          className={`py-3 px-2 rounded-2xl border font-black text-xs flex flex-col items-center gap-1.5 transition-all active:scale-95 ${
                            active ? m.activeCls : m.idleCls
                          }`}
                        >
                          <Icon size={18} />
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Amount input + quick chips */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      Nominal Bayar / Cicilan (Rp)
                    </label>
                    <div className="flex gap-1.5">
                      {[
                        { label: '25%', ratio: 0.25 },
                        { label: '50%', ratio: 0.5 },
                        { label: 'Lunas', ratio: 1 },
                      ].map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => handleQuickAmount(chip.ratio)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all active:scale-95 ${
                            chip.ratio === 1 && isFullPayment
                              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                              : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-500/40'
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={selectedSummary.remaining}
                    required
                    value={payAmountInput}
                    onChange={(e) => {
                      setPayAmountInput(e.target.value);
                      setFormError('');
                    }}
                    placeholder="Masukkan nominal..."
                    className="w-full px-4 py-3.5 bg-slate-100 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-2xl text-2xl font-black text-slate-900 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                {/* Optional note */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                    Catatan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    placeholder="Contoh: Cicilan ke-1, TF a.n Budi..."
                    className="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-indigo-500 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none"
                  />
                </div>

                {/* Live projection banner */}
                {isAmountValid && (
                  <div className="bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl p-3.5 space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-bold flex items-center gap-1.5">
                        <Wallet size={13} /> Masuk ke {selectedMethodMeta.balanceLabel}
                      </span>
                      <span className="font-black text-emerald-600 dark:text-emerald-400">
                        +Rp {parsedAmount.toLocaleString('id-ID')}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
                      <span className="text-slate-500 font-bold">Status Setelah Bayar</span>
                      {isFullPayment ? (
                        <span className="font-black text-emerald-600 dark:text-emerald-400">
                          ✓ LUNAS
                        </span>
                      ) : (
                        <span className="font-black text-blue-600 dark:text-blue-400">
                          Cicilan • Sisa Rp {remainingAfter.toLocaleString('id-ID')}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {formError && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 px-3.5 py-2.5 rounded-xl text-xs font-bold">
                    <AlertCircle size={15} className="shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={submitting || !isAmountValid}
                  className={`w-full py-3.5 rounded-2xl font-black text-sm text-white shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 ${
                    isFullPayment
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/25'
                      : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/25'
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> Memproses...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={18} />
                      {isFullPayment
                        ? `Lunasi Rp ${parsedAmount.toLocaleString('id-ID')} (${selectedMethodMeta.shortLabel})`
                        : `Terima Cicilan Rp ${parsedAmount.toLocaleString('id-ID')} (${selectedMethodMeta.shortLabel})`}
                    </>
                  )}
                </button>
              </form>
            ) : (
              <>
                {/* Search bar */}
                {kasbonList.length > 2 && (
                  <div className="relative mb-3">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600"
                    />
                    <input
                      type="text"
                      placeholder="Cari nama konsumen atau item..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full bg-slate-100/60 dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-700/50 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-amber-500/50 font-medium"
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )}

                {/* List */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
                  {filteredList.length === 0 ? (
                    <p className="text-center text-slate-400 dark:text-slate-600 text-sm py-10 italic">
                      {kasbonList.length === 0
                        ? 'Tidak ada kasbon aktif'
                        : 'Kasbon tidak ditemukan'}
                    </p>
                  ) : (
                    filteredList.map((k) => {
                      const isRequested =
                        k.status === 'cancellation_requested' ||
                        k.status === 'pending_cancellation';
                      const { total, paid, remaining, progressPct, isPartiallyPaid, payments } =
                        getKasbonSummary(k);
                      const isExpanded = expandedId === k.id;

                      return (
                        <div
                          key={k.id}
                          className="bg-slate-100/60 dark:bg-slate-900/60 rounded-2xl p-4 border border-slate-200/50 dark:border-slate-700/50 space-y-3"
                        >
                          <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-black text-slate-900 dark:text-white text-sm">
                                  {k.kasbonName || 'Konsumen'}
                                </p>
                                {isPartiallyPaid && (
                                  <span className="text-[9px] font-black bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">
                                    Dicicil {progressPct}%
                                  </span>
                                )}
                                {isRequested && (
                                  <span className="text-[9px] font-black bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full animate-pulse">
                                    Menunggu Batal
                                  </span>
                                )}
                              </div>

                              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                                <p className="text-amber-600 dark:text-amber-400 font-black text-base">
                                  {isPartiallyPaid ? 'Sisa ' : ''}Rp {remaining.toLocaleString('id-ID')}
                                </p>
                                {isPartiallyPaid && (
                                  <span className="text-[10px] font-bold text-slate-500">
                                    dari Rp {total.toLocaleString('id-ID')}
                                  </span>
                                )}
                              </div>

                              {/* Progress bar for partially paid kasbon */}
                              {isPartiallyPaid && (
                                <div className="mt-2 space-y-1">
                                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all"
                                      style={{ width: `${progressPct}%` }}
                                    />
                                  </div>
                                  <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                    Terbayar: Rp {paid.toLocaleString('id-ID')} ({payments.length}x cicilan)
                                  </p>
                                </div>
                              )}

                              <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">
                                {k.timestamp
                                  ? new Date(k.timestamp.seconds * 1000).toLocaleDateString('id-ID')
                                  : '-'}
                                {k.shift ? ` • Shift: ${k.shift}` : ''}
                              </p>
                              {k.items && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                                  {k.items.map((it) => it.name).join(', ')}
                                </p>
                              )}
                              {isRequested && k.cancellationReason && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400 italic mt-0.5 truncate">
                                  Alasan batal: {k.cancellationReason}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {!isRequested && (
                                <button
                                  type="button"
                                  disabled={loadingCancel === k.id}
                                  onClick={() => onRequestCancel(k)}
                                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                                  title="Batalkan Transaksi Kasbon"
                                >
                                  {loadingCancel === k.id ? '...' : 'Batal'}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isRequested}
                                onClick={() => openPayForm(k)}
                                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all active:scale-95 flex items-center gap-1 ${
                                  isRequested
                                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed border border-transparent'
                                    : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                }`}
                              >
                                <CheckCircle2 size={14} />
                                {isPartiallyPaid ? 'Cicil / Lunas' : 'Bayar'}
                              </button>
                            </div>
                          </div>

                          {/* Expandable installment history */}
                          {payments.length > 0 && (
                            <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                              <button
                                type="button"
                                onClick={() => setExpandedId(isExpanded ? null : k.id)}
                                className="w-full flex items-center justify-between text-[11px] font-bold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                              >
                                <span className="flex items-center gap-1.5">
                                  <History size={12} /> Riwayat Cicilan ({payments.length})
                                </span>
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                              {isExpanded && (
                                <div className="mt-2 space-y-1.5">
                                  {payments.map((p, idx) => {
                                    const meta = getKasbonMethodMeta(p.paymentMethod);
                                    return (
                                      <div
                                        key={p.txId || idx}
                                        className="flex items-center justify-between gap-2 bg-white/80 dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200/50 dark:border-slate-700/50 text-[11px]"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-bold text-slate-700 dark:text-slate-200">
                                              #{idx + 1}
                                            </span>
                                            <span
                                              className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${meta.badgeCls}`}
                                            >
                                              {meta.shortLabel}
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                              {formatDateTime(p.paidAt)}
                                            </span>
                                          </div>
                                          {(p.note || p.user) && (
                                            <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                              {p.user ? `Kasir: ${p.user}` : ''}
                                              {p.user && p.note ? ' • ' : ''}
                                              {p.note || ''}
                                            </p>
                                          )}
                                        </div>
                                        <span className="font-black text-emerald-600 dark:text-emerald-400 shrink-0">
                                          +Rp {(Number(p.amount) || 0).toLocaleString('id-ID')}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </Motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
