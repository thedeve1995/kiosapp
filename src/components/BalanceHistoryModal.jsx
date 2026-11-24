import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion as Motion } from 'framer-motion';
import { X, RefreshCw, Loader2, ChevronDown, Ban, Clock, History } from 'lucide-react';
import { collection, query, orderBy, limit, getDocs, startAfter } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  BALANCE_ORDER,
  BALANCE_META,
  CANCELLED_STATUSES,
  PENDING_CANCEL_STATUSES,
  getTransactionBalanceDeltas,
  isTransactionAffectingBalance,
  summarizeMatchedLogs,
  getTransactionBadgeInfo,
  formatLogDateTime,
} from '../lib/balanceHistory';

const PAGE_SIZE = 20;
const RAW_BATCH_SIZE = 120;
const MAX_BATCHES_PER_SCAN = 5;

export default function BalanceHistoryModal({ initialBalance, balances, displayQris, onClose }) {
  const [activeBalance, setActiveBalance] = useState(initialBalance);
  const [rawLogs, setRawLogs] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [noNewMatchesNotice, setNoNewMatchesNotice] = useState(false);

  const rawLogsRef = useRef([]);
  const lastDocRef = useRef(null);
  const hasMoreRef = useRef(true);
  const fetchSeqRef = useRef(0);

  const runBatchScan = useCallback(async ({ reset = false, targetMatchCount = PAGE_SIZE, balanceKey }) => {
    const reqId = ++fetchSeqRef.current;
    setLoading(true);
    setErrorMsg(null);
    setNoNewMatchesNotice(false);

    let workingLogs = reset ? [] : [...rawLogsRef.current];
    let cursor = reset ? null : lastDocRef.current;
    let moreAvailable = reset ? true : hasMoreRef.current;

    if (reset) {
      rawLogsRef.current = [];
      lastDocRef.current = null;
      hasMoreRef.current = true;
      setRawLogs([]);
      setHasMore(true);
      setVisibleCount(PAGE_SIZE);
    }

    const initialMatches = workingLogs.filter(log => isTransactionAffectingBalance(log, balanceKey)).length;

    try {
      let batches = 0;
      while (
        moreAvailable &&
        batches < MAX_BATCHES_PER_SCAN &&
        workingLogs.filter(log => isTransactionAffectingBalance(log, balanceKey)).length < targetMatchCount
      ) {
        const constraints = [orderBy('timestamp', 'desc'), limit(RAW_BATCH_SIZE)];
        if (cursor) constraints.push(startAfter(cursor));

        const snap = await getDocs(query(collection(db, 'transactions'), ...constraints));
        if (reqId !== fetchSeqRef.current) return;

        const fetched = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        const seenIds = new Set(workingLogs.map(item => item.id));
        for (const item of fetched) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            workingLogs.push(item);
          }
        }

        cursor = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : cursor;
        moreAvailable = snap.docs.length === RAW_BATCH_SIZE;
        batches += 1;

        rawLogsRef.current = workingLogs;
        lastDocRef.current = cursor;
        hasMoreRef.current = moreAvailable;
        setRawLogs([...workingLogs]);
        setHasMore(moreAvailable);
      }

      if (reqId !== fetchSeqRef.current) return;

      const finalMatches = workingLogs.filter(log => isTransactionAffectingBalance(log, balanceKey)).length;
      if (!reset && batches > 0 && finalMatches === initialMatches && moreAvailable) {
        setNoNewMatchesNotice(true);
      }
    } catch (err) {
      if (reqId !== fetchSeqRef.current) return;
      console.error('Gagal memuat riwayat saldo:', err);
      setErrorMsg('Gagal memuat riwayat saldo. Silakan coba muat ulang.');
    } finally {
      if (reqId === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    setActiveBalance(initialBalance);
    runBatchScan({ reset: true, targetMatchCount: PAGE_SIZE, balanceKey: initialBalance });
    return () => {
      fetchSeqRef.current += 1;
    };
  }, [initialBalance, runBatchScan]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSwitchTab = (nextKey) => {
    if (nextKey === activeBalance && !errorMsg) return;
    setActiveBalance(nextKey);
    setVisibleCount(PAGE_SIZE);
    setNoNewMatchesNotice(false);
    setErrorMsg(null);

    const existingMatches = rawLogsRef.current.filter(log => isTransactionAffectingBalance(log, nextKey)).length;
    if (existingMatches < PAGE_SIZE && hasMoreRef.current) {
      runBatchScan({ reset: false, targetMatchCount: PAGE_SIZE, balanceKey: nextKey });
    } else if (loading) {
      fetchSeqRef.current += 1;
      setLoading(false);
    }
  };

  const handleLoadMore = () => {
    const nextVisible = visibleCount + PAGE_SIZE;
    setVisibleCount(nextVisible);
    const existingMatches = rawLogsRef.current.filter(log => isTransactionAffectingBalance(log, activeBalance)).length;
    if (existingMatches < nextVisible && hasMoreRef.current) {
      runBatchScan({ reset: false, targetMatchCount: nextVisible, balanceKey: activeBalance });
    }
  };

  const handleRefresh = () => {
    runBatchScan({ reset: true, targetMatchCount: Math.max(PAGE_SIZE, visibleCount), balanceKey: activeBalance });
  };

  const matchedLogs = useMemo(
    () => rawLogs.filter(log => isTransactionAffectingBalance(log, activeBalance)),
    [rawLogs, activeBalance]
  );

  const visibleLogs = useMemo(
    () => matchedLogs.slice(0, visibleCount),
    [matchedLogs, visibleCount]
  );

  const summary = useMemo(
    () => summarizeMatchedLogs(visibleLogs, activeBalance),
    [visibleLogs, activeBalance]
  );

  const meta = BALANCE_META[activeBalance] || BALANCE_META.cash;
  const currentNominal = activeBalance === 'qris' ? (displayQris || 0) : (balances?.[activeBalance] || 0);
  const canShowMore = matchedLogs.length > visibleCount || hasMore;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
      <Motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
      />
      <Motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="relative z-10 w-full sm:max-w-lg max-h-[86vh] bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-3xl p-5 flex flex-col border-t sm:border border-slate-200/60 dark:border-slate-700/60 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${meta.dot}`} />
              <h2 className="text-lg font-black text-slate-900 dark:text-white truncate">
                Riwayat {meta.title}
              </h2>
            </div>
            <p className="text-xl font-black text-slate-900 dark:text-white mt-1">
              Rp {Number(currentNominal).toLocaleString('id-ID')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              title="Muat ulang riwayat"
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700/70 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Balance Switcher Tabs */}
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {BALANCE_ORDER.map(key => {
            const itemMeta = BALANCE_META[key];
            const isActive = key === activeBalance;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSwitchTab(key)}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-black border transition-all ${
                  isActive
                    ? `${itemMeta.activeTab} shadow-md`
                    : 'bg-slate-100 dark:bg-slate-900/70 text-slate-600 dark:text-slate-400 border-slate-200/70 dark:border-slate-700/70 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : itemMeta.dot}`} />
                {itemMeta.label}
              </button>
            );
          })}
        </div>

        {activeBalance === 'qris' && (
          <p className="text-[11px] font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/10 border border-purple-500/20 rounded-xl px-3 py-2 mb-3">
            Saldo QRIS di-reset otomatis harian setiap pergantian hari. Transaksi hari sebelumnya tetap terlihat di bawah sebagai jejak.
          </p>
        )}

        {/* Active Summary Strip */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              Masuk ({visibleLogs.length} tampil)
            </p>
            <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
              +Rp {summary.totalIn.toLocaleString('id-ID')}
            </p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-red-700 dark:text-red-400">
              Keluar ({summary.cancelledCount > 0 ? `${summary.cancelledCount} batal` : `${summary.activeCount} aktif`})
            </p>
            <p className="text-sm font-black text-red-600 dark:text-red-400 mt-0.5">
              -Rp {summary.totalOut.toLocaleString('id-ID')}
            </p>
          </div>
        </div>

        {/* Transaction List */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
          {errorMsg ? (
            <div className="text-center py-10">
              <p className="text-xs font-bold text-red-500 mb-3">{errorMsg}</p>
              <button
                type="button"
                onClick={handleRefresh}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 transition-colors"
              >
                Coba Lagi
              </button>
            </div>
          ) : loading && visibleLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500">
              <Loader2 size={24} className="animate-spin mb-2 text-indigo-500" />
              <p className="text-xs font-bold">Memuat riwayat {meta.title}...</p>
            </div>
          ) : visibleLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500">
              <History size={28} className="mb-2 opacity-50" />
              <p className="text-xs font-bold">Belum ada transaksi terkait {meta.title}</p>
            </div>
          ) : (
            visibleLogs.map(log => {
              const isCancelled = CANCELLED_STATUSES.has(log.status);
              const isRequested = PENDING_CANCEL_STATUSES.has(log.status);
              const deltas = getTransactionBalanceDeltas(log);
              const delta = deltas[activeBalance] || 0;
              const isMixed = deltas.mixedBalances.includes(activeBalance);
              const badge = getTransactionBadgeInfo(log);
              const itemSummary = log.items?.length
                ? log.items.map(it => (it.qty > 1 ? `${it.name} x${it.qty}` : it.name)).join(', ')
                : log.name || 'Transaksi';
              const totalStruk = Number(log.total) || 0;
              const showStrukHint = !isMixed && totalStruk > 0 && Math.abs(delta) !== totalStruk;

              return (
                <div
                  key={log.id}
                  className={`rounded-xl px-3.5 py-3 border flex justify-between items-center gap-3 transition-all ${
                    isCancelled
                      ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20 opacity-75'
                      : isRequested
                        ? 'bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/20'
                        : 'bg-slate-100/70 dark:bg-slate-900/60 border-slate-200/60 dark:border-slate-700/60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {formatLogDateTime(log.timestamp)}
                      </span>
                      {(log.shift || log.user) && (
                        <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500">
                          • {[log.shift ? `Shift ${log.shift}` : null, log.user || null].filter(Boolean).join(' • ')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className={`inline-flex items-center text-[9px] font-black px-1.5 py-0.5 rounded-full border ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {isCancelled && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-black bg-red-500/15 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full border border-red-500/20">
                          <Ban size={9} /> {log.status === 'voided_by_audit' ? 'Void Audit' : 'Dibatalkan'}
                        </span>
                      )}
                      {isRequested && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-black bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/20 animate-pulse">
                          <Clock size={9} /> Menunggu Batal
                        </span>
                      )}
                    </div>

                    <p
                      className={`text-xs font-bold leading-snug break-words ${
                        isCancelled
                          ? 'text-slate-400 dark:text-slate-500 line-through'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {itemSummary}
                    </p>

                    {showStrukHint && (
                      <p className={`text-[10px] font-semibold mt-0.5 ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-500 dark:text-slate-400'}`}>
                        Total transaksi: Rp {totalStruk.toLocaleString('id-ID')}
                      </p>
                    )}

                    {isCancelled && log.cancellationReason && (
                      <p className="text-[10px] text-red-500/80 dark:text-red-400/70 italic mt-0.5">
                        Alasan: {log.cancellationReason}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    {isMixed ? (
                      <>
                        <p className={`font-black text-xs ${isCancelled ? 'text-slate-400 line-through' : 'text-sky-600 dark:text-sky-400'}`}>
                          Campuran
                        </p>
                        <p className={`text-[10px] font-bold ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-500'}`}>
                          Total Rp {totalStruk.toLocaleString('id-ID')}
                        </p>
                      </>
                    ) : (
                      <p
                        className={`font-black text-sm whitespace-nowrap ${
                          isCancelled
                            ? 'text-slate-400 dark:text-slate-500 line-through'
                            : delta > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {delta > 0 ? '+' : '-'}Rp {Math.abs(delta).toLocaleString('id-ID')}
                      </p>
                    )}
                    {isCancelled && (
                      <span className="block text-[9px] font-bold text-red-500/80 dark:text-red-400/80 mt-0.5">
                        Tidak dihitung
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {noNewMatchesNotice && hasMore && (
            <p className="text-center text-[11px] font-semibold text-amber-600 dark:text-amber-400 pt-2">
              Belum ditemukan tambahan transaksi {meta.label} pada batch berikutnya. Klik lagi untuk cek riwayat lebih lama.
            </p>
          )}

          {canShowMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loading}
              className="w-full mt-2 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700 text-xs font-black text-slate-700 dark:text-slate-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
              {loading ? 'Memuat transaksi...' : 'Lihat lebih banyak'}
            </button>
          )}

          {!canShowMore && visibleLogs.length > 0 && (
            <p className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 pt-2 pb-1">
              Semua riwayat {meta.title} telah ditampilkan
            </p>
          )}
        </div>
      </Motion.div>
    </div>
  );
}
