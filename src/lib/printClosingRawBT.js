export function printClosingRawBT(data) {
  if (!data) return;

  const CPL = 32;
  const center = (str) => {
    const s = String(str || '').substring(0, CPL);
    return ' '.repeat(Math.max(0, Math.floor((CPL - s.length) / 2))) + s;
  };
  const right = (str) => {
    const s = String(str || '').substring(0, CPL);
    return ' '.repeat(Math.max(0, CPL - s.length)) + s;
  };
  const leftRight = (l, r) => {
    const ls = String(l || '').substring(0, CPL);
    const rs = String(r || '').substring(0, CPL);
    if (ls.length + rs.length > CPL - 1) return ls + '\n' + right(rs);
    return ls + ' '.repeat(Math.max(0, CPL - ls.length - rs.length)) + rs;
  };

  const divider = '-'.repeat(CPL);
  const dividerEq = '='.repeat(CPL);

  const timestamp = data.timestamp && data.timestamp.seconds
    ? new Date(data.timestamp.seconds * 1000).toLocaleString('id-ID')
    : new Date().toLocaleString('id-ID');

  let text = '';
  text += dividerEq + '\n';
  text += center('KIOS FINANCE') + '\n';
  text += center('STRUK CLOSING SHIFT') + '\n';
  text += dividerEq + '\n';

  text += leftRight('Tanggal', timestamp) + '\n';
  text += leftRight('Petugas', data.user || '-') + '\n';
  text += leftRight('Shift', data.shift || '-') + '\n';
  text += divider + '\n';

  // Modal Awal
  text += leftRight('Modal Awal', `Rp ${(data.modalAwal || 0).toLocaleString('id-ID')}`) + '\n';
  text += divider + '\n';

  // Penjualan Fisik
  text += center('[ PENJUALAN FISIK ]') + '\n';
  if (data.physicalSales && data.physicalSales.length > 0) {
    let subtotalRevenue = 0;
    let subtotalProfit = 0;
    data.physicalSales.forEach(s => {
      subtotalRevenue += (s.revenue || 0);
      subtotalProfit += (s.profit || 0);
      text += leftRight(`${s.name} x${s.sold}`, `Rp ${(s.revenue || 0).toLocaleString('id-ID')}`) + '\n';
    });
    text += leftRight('Subtotal Fisik', `Rp ${subtotalRevenue.toLocaleString('id-ID')}`) + '\n';
    text += leftRight('Laba Fisik', `Rp ${subtotalProfit.toLocaleString('id-ID')}`) + '\n';
  } else {
    text += center('(Tidak ada penjualan fisik)') + '\n';
  }
  text += divider + '\n';

  // Transaksi Digital
  text += center('[ TRANSAKSI DIGITAL ]') + '\n';
  if (data.digitalSummary && Object.keys(data.digitalSummary).length > 0) {
    Object.entries(data.digitalSummary).forEach(([cat, d]) => {
      text += leftRight(`${cat} (${d.count} tx)`, `Laba Rp ${(d.profit || 0).toLocaleString('id-ID')}`) + '\n';
    });
  }
  const labaDigital = data.realProfit !== undefined ? data.realProfit : (data.totalProfit - (data.physicalSales?.reduce((sum, s) => sum + (s.profit || 0), 0) || 0));
  if (labaDigital !== undefined) {
    text += leftRight('Subtotal Laba Dig', `Rp ${(labaDigital || 0).toLocaleString('id-ID')}`) + '\n';
  }
  text += divider + '\n';

  // Rincian Pengeluaran (Cash Out)
  text += center('[ PENGELUARAN (CASH OUT) ]') + '\n';
  if (data.expenseDetails && data.expenseDetails.length > 0) {
    data.expenseDetails.forEach(e => {
      text += leftRight(e.name, `Rp ${(e.amount || 0).toLocaleString('id-ID')}`) + '\n';
    });
    text += leftRight('Total Cash Out', `Rp ${(data.pengeluaran || 0).toLocaleString('id-ID')}`) + '\n';
  } else if (data.pengeluaran > 0) {
    text += leftRight('Total Cash Out', `Rp ${(data.pengeluaran || 0).toLocaleString('id-ID')}`) + '\n';
  } else {
    text += center('(Tidak ada pengeluaran)') + '\n';
  }
  text += divider + '\n';

  // Mutasi / Kasbon
  let hasMutation = false;
  if (data.kasbonBaru > 0) {
    text += leftRight('Kasbon Baru (Piutang)', `Rp ${data.kasbonBaru.toLocaleString('id-ID')}`) + '\n';
    hasMutation = true;
  }
  if (data.kasbonDilunasi > 0) {
    const hasBreakdown =
      data.kasbonDilunasiCash !== undefined ||
      data.kasbonDilunasiTransfer !== undefined ||
      data.kasbonDilunasiQris !== undefined;
    if (hasBreakdown) {
      if (data.kasbonDilunasiCash > 0) {
        text += leftRight('Bayar Kasbon (Tunai)', `Rp ${data.kasbonDilunasiCash.toLocaleString('id-ID')}`) + '\n';
      }
      if (data.kasbonDilunasiTransfer > 0) {
        text += leftRight('Bayar Kasbon (Bank)', `Rp ${data.kasbonDilunasiTransfer.toLocaleString('id-ID')}`) + '\n';
      }
      if (data.kasbonDilunasiQris > 0) {
        text += leftRight('Bayar Kasbon (QRIS)', `Rp ${data.kasbonDilunasiQris.toLocaleString('id-ID')}`) + '\n';
      }
    } else {
      text += leftRight('Pelunasan Masuk Laci', `Rp ${data.kasbonDilunasi.toLocaleString('id-ID')}`) + '\n';
    }
    hasMutation = true;
  }
  if (data.qrisTransfer > 0) {
    text += leftRight('Mutasi Masuk QRIS', `Rp ${data.qrisTransfer.toLocaleString('id-ID')}`) + '\n';
    hasMutation = true;
  }
  if (data.digitalTransfer > 0) {
    text += leftRight('Mutasi Transfer', `Rp ${data.digitalTransfer.toLocaleString('id-ID')}`) + '\n';
    hasMutation = true;
  }
  if (hasMutation) {
    text += divider + '\n';
  }

  // Audit Kas Laci
  text += center('[ REKAPITULASI KAS LACI ]') + '\n';
  text += leftRight('Kas Sistem (Exp)', `Rp ${(data.expectedCash || 0).toLocaleString('id-ID')}`) + '\n';
  text += leftRight('Fisik Laci (Act)', `Rp ${(data.actualCash || 0).toLocaleString('id-ID')}`) + '\n';
  const selisih = data.selisih || 0;
  const selisihStr = (selisih > 0 ? '+' : '') + `Rp ${selisih.toLocaleString('id-ID')}`;
  text += leftRight('Selisih Kas', selisihStr) + '\n';
  text += dividerEq + '\n';

  // Hasil Akhir
  text += leftRight('TOTAL LABA', `Rp ${(data.totalProfit || 0).toLocaleString('id-ID')}`) + '\n';
  text += leftRight('SETORAN OWNER', `Rp ${(data.setoran || 0).toLocaleString('id-ID')}`) + '\n';
  text += dividerEq + '\n';

  // Posisi Saldo Terakhir
  if (data.finalBalances) {
    const fb = data.finalBalances;
    const fbCash = Number(fb.cash) || 0;
    const fbBank = Number(fb.seabank) || 0;
    const fbApk = Number(fb.apk) || 0;
    const fbQris = Number(fb.qris) || 0;
    const fbTotal = fbCash + fbBank + fbApk + fbQris;

    text += center('[ POSISI SALDO TERAKHIR ]') + '\n';
    text += leftRight('Cash', `Rp ${fbCash.toLocaleString('id-ID')}`) + '\n';
    text += leftRight('Bank', `Rp ${fbBank.toLocaleString('id-ID')}`) + '\n';
    text += leftRight('APK', `Rp ${fbApk.toLocaleString('id-ID')}`) + '\n';
    text += leftRight('QRIS', `Rp ${fbQris.toLocaleString('id-ID')}`) + '\n';
    text += divider + '\n';
    text += leftRight('Total Saldo', `Rp ${fbTotal.toLocaleString('id-ID')}`) + '\n';
    text += dividerEq + '\n';
  }

  if (data.note) {
    text += `* ${data.note}\n`;
    text += divider + '\n';
  }

  text += '\n';
  text += leftRight('Kasir/Petugas', 'Owner/Penerima') + '\n\n\n';
  text += leftRight('(............)', '(............)') + '\n\n';
  text += center('*** SIMPAN BUKTI STRUK ***') + '\n\n\n\n';

  window.location.href = `rawbt:${encodeURIComponent(text)}`;
}
