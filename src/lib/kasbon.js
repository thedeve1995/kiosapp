import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';

export const KASBON_PAYMENT_METHODS = [
  {
    id: 'cash',
    label: 'Tunai',
    shortLabel: 'Cash',
    balanceKey: 'cash',
    balanceLabel: 'Saldo Kas (Laci)',
    activeCls: 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-500/25',
    idleCls: 'bg-slate-100 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/40',
    badgeCls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  },
  {
    id: 'transfer',
    label: 'Transfer',
    shortLabel: 'Transfer',
    balanceKey: 'seabank',
    balanceLabel: 'Saldo Bank',
    activeCls: 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-500/25',
    idleCls: 'bg-slate-100 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-500/40',
    badgeCls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
  },
  {
    id: 'qris',
    label: 'QRIS',
    shortLabel: 'QRIS',
    balanceKey: 'qris',
    balanceLabel: 'Saldo QRIS',
    activeCls: 'bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-500/25',
    idleCls: 'bg-slate-100 dark:bg-slate-900/80 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-purple-500/40',
    badgeCls: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20',
  },
];

export const KASBON_METHOD_MAP = Object.fromEntries(
  KASBON_PAYMENT_METHODS.map((m) => [m.id, m])
);

export function getKasbonMethodMeta(method) {
  return KASBON_METHOD_MAP[method] || KASBON_METHOD_MAP.cash;
}

/**
 * Backward-compatible summary for a kasbon parent transaction document.
 */
export function getKasbonSummary(kasbon) {
  const total = Math.max(0, Number(kasbon?.total) || 0);
  const payments = Array.isArray(kasbon?.kasbonPayments) ? kasbon.kasbonPayments : [];
  const isLunas = kasbon?.kasbonStatus === 'lunas';

  let paid = Number(kasbon?.kasbonPaid);
  if (!Number.isFinite(paid) || paid < 0) {
    if (payments.length > 0) {
      paid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    } else {
      paid = isLunas ? total : 0;
    }
  }
  paid = Math.min(total, Math.max(0, paid));

  const remaining = isLunas ? 0 : Math.max(0, total - paid);
  const progressPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const isPartiallyPaid = paid > 0 && remaining > 0;

  return {
    total,
    paid,
    remaining,
    progressPct,
    isPartiallyPaid,
    isLunas,
    payments,
  };
}

/**
 * Builds the parent kasbon update payload when a kasbon payment/installment
 * transaction (`pelunasan_kasbon`) is cancelled.
 */
export function buildKasbonPaymentReversal(kasbonData, paymentLog) {
  const total = Math.max(0, Number(kasbonData?.total) || 0);
  const hadLegacyFullPay =
    kasbonData?.kasbonStatus === 'lunas' && kasbonData?.kasbonPaid == null;
  const prevPaid = hadLegacyFullPay
    ? total
    : Math.max(0, Number(kasbonData?.kasbonPaid) || 0);

  const payAmount = Math.max(0, Number(paymentLog?.total) || 0);
  const existingPayments = Array.isArray(kasbonData?.kasbonPayments)
    ? kasbonData.kasbonPayments
    : [];
  const filteredPayments = existingPayments.filter((p) => p.txId !== paymentLog?.id);

  const newPaid = Math.max(0, prevPaid - payAmount);
  const newRemaining = Math.max(0, total - newPaid);
  const isStillLunas = newRemaining === 0 && total > 0;

  return {
    kasbonPaid: newPaid,
    kasbonRemaining: newRemaining,
    kasbonPayments: filteredPayments,
    kasbonStatus: isStillLunas ? 'lunas' : 'belum_lunas',
    ...(isStillLunas
      ? {}
      : {
          pelunasanShift: null,
          pelunasanUser: null,
          pelunasanMethod: null,
          dipelunasiPada: null,
        }),
  };
}

/**
 * Processes a kasbon installment or full payment atomically via Firestore runTransaction.
 * Updates parent kasbon document, creates a `pelunasan_kasbon` transaction record,
 * and increments the chosen balance (`cash`, `seabank`, or `qris` with daily reset).
 */
export async function payKasbonInstallment({
  db,
  kasbonId,
  amount,
  paymentMethod = 'cash',
  user,
  shift = '',
  note = '',
}) {
  const payAmount = Math.round(Number(amount) || 0);
  if (payAmount <= 0) {
    throw new Error('Nominal pembayaran harus lebih dari Rp 0.');
  }
  if (!KASBON_METHOD_MAP[paymentMethod]) {
    throw new Error('Metode pembayaran tidak valid.');
  }

  const kasbonRef = doc(db, 'transactions', kasbonId);
  const balRef = doc(db, 'balances', 'current');
  const paymentTxRef = doc(collection(db, 'transactions'));
  const cleanNote = String(note || '').trim();
  const paidAtMs = Date.now();
  const todayStr = new Date().toLocaleDateString('id-ID');

  let createdTx = null;

  await runTransaction(db, async (tx) => {
    const kasbonSnap = await tx.get(kasbonRef);
    if (!kasbonSnap.exists()) {
      throw new Error('Data kasbon tidak ditemukan.');
    }

    const kasbonData = kasbonSnap.data();
    if (
      kasbonData.status === 'cancelled' ||
      kasbonData.status === 'voided_by_audit' ||
      kasbonData.kasbonStatus === 'batal'
    ) {
      throw new Error('Kasbon ini sudah dibatalkan.');
    }
    if (
      kasbonData.status === 'cancellation_requested' ||
      kasbonData.status === 'pending_cancellation'
    ) {
      throw new Error('Kasbon ini sedang dalam proses permintaan pembatalan.');
    }
    if (kasbonData.kasbonStatus === 'lunas') {
      throw new Error('Kasbon ini sudah lunas.');
    }

    const { total: kasbonTotal, paid: currentPaid, remaining: currentRemaining, payments: existingPayments } =
      getKasbonSummary(kasbonData);

    if (currentRemaining <= 0) {
      throw new Error('Sisa tagihan kasbon ini sudah Rp 0.');
    }
    if (payAmount > currentRemaining) {
      throw new Error(
        `Nominal bayar (Rp ${payAmount.toLocaleString('id-ID')}) melebihi sisa kasbon (Rp ${currentRemaining.toLocaleString('id-ID')}).`
      );
    }

    const balSnap = await tx.get(balRef);
    const balData = balSnap.exists() ? balSnap.data() : {};

    const newPaid = currentPaid + payAmount;
    const newRemaining = Math.max(0, kasbonTotal - newPaid);
    const isFullPayment = newRemaining === 0;
    const customerName = kasbonData.kasbonName || 'Konsumen';

    // Update target balance
    const balanceUpdate = {};
    if (paymentMethod === 'cash') {
      balanceUpdate.cash = (Number(balData.cash) || 0) + payAmount;
    } else if (paymentMethod === 'transfer') {
      balanceUpdate.seabank = (Number(balData.seabank) || 0) + payAmount;
    } else if (paymentMethod === 'qris') {
      const isNewDayForQris = balData.lastQrisResetDate !== todayStr;
      if (isNewDayForQris) {
        balanceUpdate.qris = payAmount;
        balanceUpdate.lastQrisResetDate = todayStr;
      } else {
        balanceUpdate.qris = (Number(balData.qris) || 0) + payAmount;
      }
    }

    tx.update(balRef, balanceUpdate);

    // Create payment transaction document
    const txPayload = {
      type: 'pelunasan_kasbon',
      status: 'success',
      user: user?.name || '',
      shift: shift || '',
      total: payAmount,
      paymentMethod,
      isPartial: !isFullPayment,
      kasbonLunasId: kasbonId,
      kasbonName: customerName,
      kasbonTotalInitial: kasbonTotal,
      kasbonPaidBefore: currentPaid,
      kasbonPaidAfter: newPaid,
      kasbonRemainingAfter: newRemaining,
      note: cleanNote || null,
      timestamp: serverTimestamp(),
      items: [
        {
          name: `${isFullPayment ? 'Pelunasan' : 'Cicilan'} Kasbon: ${customerName}`,
          action: 'pelunasan_kasbon',
          qty: 1,
          price: payAmount,
          total: payAmount,
        },
      ],
      profit: 0,
    };

    tx.set(paymentTxRef, txPayload);

    // Update parent kasbon document
    const newPaymentEntry = {
      txId: paymentTxRef.id,
      amount: payAmount,
      paymentMethod,
      user: user?.name || '',
      shift: shift || '',
      note: cleanNote || '',
      paidAt: paidAtMs,
    };

    const kasbonUpdate = {
      kasbonPaid: newPaid,
      kasbonRemaining: newRemaining,
      kasbonPayments: [...existingPayments, newPaymentEntry],
      lastPaymentMethod: paymentMethod,
      lastPaymentAt: serverTimestamp(),
      kasbonStatus: isFullPayment ? 'lunas' : 'belum_lunas',
    };

    if (isFullPayment) {
      kasbonUpdate.pelunasanShift = shift || '';
      kasbonUpdate.pelunasanUser = user?.name || '';
      kasbonUpdate.pelunasanMethod = paymentMethod;
      kasbonUpdate.dipelunasiPada = serverTimestamp();
    }

    tx.update(kasbonRef, kasbonUpdate);

    createdTx = {
      ...txPayload,
      id: paymentTxRef.id,
      timestamp: { seconds: Math.floor(paidAtMs / 1000) },
      isFullPayment,
    };
  });

  return createdTx;
}
