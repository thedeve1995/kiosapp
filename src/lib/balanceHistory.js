/**
 * Helpers for computing per-balance transaction impacts and UI metadata.
 */

export const BALANCE_ORDER = ['cash', 'apk', 'seabank', 'qris'];

export const BALANCE_META = {
  cash: {
    key: 'cash',
    label: 'Kas',
    title: 'Saldo Kas',
    dot: 'bg-amber-400',
    glow: 'shadow-amber-500/20',
    hoverBorder: 'hover:border-amber-400/60',
    activeTab: 'bg-amber-500 text-white border-amber-500 shadow-amber-500/25',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  },
  apk: {
    key: 'apk',
    label: 'APK',
    title: 'Saldo APK',
    dot: 'bg-blue-400',
    glow: 'shadow-blue-500/20',
    hoverBorder: 'hover:border-blue-400/60',
    activeTab: 'bg-blue-600 text-white border-blue-600 shadow-blue-500/25',
    badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
  },
  seabank: {
    key: 'seabank',
    label: 'Bank',
    title: 'Saldo Bank',
    dot: 'bg-emerald-400',
    glow: 'shadow-emerald-500/20',
    hoverBorder: 'hover:border-emerald-400/60',
    activeTab: 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-500/25',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  },
  qris: {
    key: 'qris',
    label: 'QRIS',
    title: 'Saldo QRIS',
    dot: 'bg-purple-400',
    glow: 'shadow-purple-500/20',
    hoverBorder: 'hover:border-purple-400/60',
    activeTab: 'bg-purple-600 text-white border-purple-600 shadow-purple-500/25',
    badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
  },
};

// Admin audit/adjustment records are excluded per cashier/expenditure/pelunasan scope.
export const EXCLUDED_BALANCE_LOG_TYPES = new Set([
  'adjustment',
  'super_audit_header',
  'audit_reconstruction',
  'audit_reconstruction_physical',
]);

export const CANCELLED_STATUSES = new Set(['cancelled', 'voided_by_audit']);
export const PENDING_CANCEL_STATUSES = new Set(['cancellation_requested', 'pending_cancellation']);

export const PAYMENT_BADGE_MAP = {
  cash: {
    label: 'Cash',
    cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  transfer: {
    label: 'Transfer',
    cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  qris: {
    label: 'QRIS',
    cls: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
  kasbon: {
    label: 'Kasbon',
    cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
  },
  mixed: {
    label: 'Cash + Transfer',
    cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/20',
  },
};

/**
 * Computes balance deltas for a single POS item and payment method.
 * Shared across checkout, owner cancellation reversal, projection preview, and balance history modal.
 */
export function getItemBalanceDeltas(item, paymentMethod) {
  const q = item.qty || 1;
  const fee = (Number(item.fee) || 0) * q;
  const nominal = (Number(item.nominal) || 0) * q;
  const price = item.price != null ? (Number(item.price) || 0) * q : (Number(item.total) || 0);
  const cost = (Number(item.costPrice) || 0) * q;
  let cash = 0, seabank = 0, apk = 0, qris = 0;

  if (paymentMethod !== 'kasbon') {
    if (item.action === 'tarik') {
      cash -= nominal;
      if (item.feePaidVia === 'cash') cash += fee;
      else if (item.feePaidVia === 'qris') qris += fee;
    } else if (item.type === 'stok') {
      if (paymentMethod === 'transfer') seabank += price;
      else if (paymentMethod === 'qris') qris += price;
      else cash += price;
    } else {
      if (paymentMethod === 'transfer') seabank += price;
      else if (paymentMethod === 'qris') qris += price;
      else cash += price;
    }
  } else {
    if (item.action === 'tarik') cash -= nominal;
  }

  if (item.type === 'jasa' || item.type === 'saldo') {
    if (item.action === 'transfer') seabank -= cost;
    else if (item.action === 'tarik') {
      if (paymentMethod === 'qris') qris += nominal;
      else seabank += nominal;

      if (paymentMethod !== 'kasbon' && item.feePaidVia === 'transfer') seabank += fee;
    } else {
      apk -= cost;
    }
  }

  return { cash, seabank, apk, qris };
}

/**
 * Computes how a Firestore transaction document impacts each balance.
 * Returns { cash, seabank, apk, qris, mixedBalances } where mixedBalances lists
 * balances touched when exact split wasn't stored (e.g. closing mixed stock sales).
 */
export function getTransactionBalanceDeltas(log) {
  if (!log || EXCLUDED_BALANCE_LOG_TYPES.has(log.type)) {
    return { cash: 0, seabank: 0, apk: 0, qris: 0, mixedBalances: [] };
  }

  if (log.type === 'expenditure') {
    const itemsTotal = (log.items || []).reduce(
      (sum, it) => sum + (Number(it.total) || ((Number(it.price) || 0) * (it.qty || 1))),
      0
    );
    const total = Number(log.total) || itemsTotal;
    return { cash: -total, seabank: 0, apk: 0, qris: 0, mixedBalances: [] };
  }

  if (log.type === 'pelunasan_kasbon') {
    const total = Number(log.total) || 0;
    return { cash: total, seabank: 0, apk: 0, qris: 0, mixedBalances: [] };
  }

  // Physical stock tallied at closing with split payment doesn't persist exact cash vs transfer split
  if (log.type === 'stok' && log.paymentMethod === 'mixed') {
    return { cash: 0, seabank: 0, apk: 0, qris: 0, mixedBalances: ['cash', 'seabank'] };
  }

  const pm = log.paymentMethod || 'cash';
  return (log.items || []).reduce(
    (acc, item) => {
      const d = getItemBalanceDeltas(item, pm);
      acc.cash += d.cash;
      acc.seabank += d.seabank;
      acc.apk += d.apk;
      acc.qris += d.qris;
      return acc;
    },
    { cash: 0, seabank: 0, apk: 0, qris: 0, mixedBalances: [] }
  );
}

export function isTransactionAffectingBalance(log, balanceKey) {
  const deltas = getTransactionBalanceDeltas(log);
  return deltas.mixedBalances.includes(balanceKey) || deltas[balanceKey] !== 0;
}

export function summarizeMatchedLogs(logs, balanceKey) {
  let totalIn = 0;
  let totalOut = 0;
  let activeCount = 0;
  let cancelledCount = 0;

  for (const log of logs) {
    if (CANCELLED_STATUSES.has(log.status)) {
      cancelledCount += 1;
      continue;
    }
    activeCount += 1;
    const deltas = getTransactionBalanceDeltas(log);
    const delta = deltas[balanceKey] || 0;
    if (delta > 0) totalIn += delta;
    else if (delta < 0) totalOut += Math.abs(delta);
  }

  return { totalIn, totalOut, activeCount, cancelledCount };
}

export function getTransactionBadgeInfo(log) {
  if (log.type === 'expenditure') {
    const isRestock = log.items?.some(it => it.action === 'restock');
    return {
      label: isRestock ? 'Restok' : 'Belanja',
      cls: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20',
    };
  }
  if (log.type === 'pelunasan_kasbon') {
    return {
      label: 'Pelunasan Kasbon',
      cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    };
  }
  if (log.type === 'stok') {
    const pm = log.paymentMethod || 'cash';
    const base = PAYMENT_BADGE_MAP[pm] || PAYMENT_BADGE_MAP.cash;
    return {
      label: `Stok Closing • ${base.label}`,
      cls: base.cls,
    };
  }

  const pm = log.paymentMethod || 'cash';
  if (pm === 'kasbon') {
    return {
      label: log.kasbonName ? `Kasbon: ${log.kasbonName}` : 'Kasbon',
      cls: PAYMENT_BADGE_MAP.kasbon.cls,
    };
  }
  return PAYMENT_BADGE_MAP[pm] || PAYMENT_BADGE_MAP.cash;
}

export function formatLogDateTime(timestamp, now = new Date()) {
  if (!timestamp) return '--:--';
  const date = typeof timestamp.toDate === 'function'
    ? timestamp.toDate()
    : timestamp.seconds != null
      ? new Date(timestamp.seconds * 1000)
      : new Date(timestamp);

  if (Number.isNaN(date.getTime())) return '--:--';

  const timePart = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) return `Hari ini, ${timePart}`;

  const datePart = date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  return `${datePart}, ${timePart}`;
}
