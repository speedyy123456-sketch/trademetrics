const $ = (selector) => document.querySelector(selector);
let charts = {};
let currentTrades = [];
let calendarMonth = new Date();
let selectedExchange = '';

['fileInput', 'fileInputEmpty'].forEach((id) => {
  $('#' + id).addEventListener('change', (event) => {
    if (event.target.files[0]) loadFile(event.target.files[0]);
  });
});
document.querySelectorAll('.exchange-button').forEach((button) => button.addEventListener('click', () => selectExchange(button.dataset.exchange, button)));
$('#directionFilter').addEventListener('change', () => renderTradeTable());
$('#symbolFilter').addEventListener('change', () => renderTradeTable());
$('#durationSort').addEventListener('change', () => renderTradeTable());
$('#previousMonth').addEventListener('click', () => { calendarMonth.setMonth(calendarMonth.getMonth() - 1); renderCalendar(); });
$('#nextMonth').addEventListener('click', () => { calendarMonth.setMonth(calendarMonth.getMonth() + 1); renderCalendar(); });

const infoModal = $('#infoModal');
const infoModalTitle = $('#infoModalTitle');
const infoModalBody = $('#infoModalBody');
const closeInfoModalButton = $('#closeInfoModal');
let lastModalTrigger = null;
const infoModalContent = {
  privacy: { title: 'Política de Privacidad', body: 'TradeMetrics procesa los archivos seleccionados directamente en tu navegador. Los datos de tus trades no se suben ni se almacenan en un servidor de esta aplicación.' },
  terms: { title: 'Términos y Condiciones', body: 'Esta herramienta se ofrece de forma gratuita y local para fines informativos. Al utilizarla, aceptas revisar los resultados y la precisión de tus archivos antes de tomar cualquier decisión.' },
  disclaimer: { title: 'Disclaimer Financiero', body: 'TradeMetrics no ofrece asesoramiento financiero, de inversión, legal ni fiscal. Las métricas y gráficos son únicamente informativos y no constituyen una recomendación para comprar, vender o mantener ningún activo. Opera solo con capital y riesgos que comprendas.' },
};

function closeInfoModal() {
  infoModal.hidden = true;
  document.body.classList.remove('modal-open');
  lastModalTrigger?.focus();
}

function openInfoModal(type, trigger) {
  const content = infoModalContent[type];
  if (!content) return;
  lastModalTrigger = trigger;
  infoModalTitle.textContent = content.title;
  infoModalBody.textContent = content.body;
  infoModal.hidden = false;
  document.body.classList.add('modal-open');
  closeInfoModalButton.focus();
}

document.querySelectorAll('[data-info-modal]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  openInfoModal(link.dataset.infoModal, link);
}));
closeInfoModalButton.addEventListener('click', closeInfoModal);
document.querySelector('[data-close-modal]').addEventListener('click', closeInfoModal);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !infoModal.hidden) closeInfoModal();
});

async function copyWallet(button) {
  const wallet = button.dataset.wallet;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(wallet);
    } else {
      const helper = document.createElement('textarea');
      helper.value = wallet;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    document.querySelectorAll('.wallet-copy').forEach((item) => item.classList.remove('copied'));
    button.classList.add('copied');
    $('#walletCopyStatus').textContent = `${button.querySelector('span').textContent} copiada.`;
  } catch (error) {
    $('#walletCopyStatus').textContent = 'No se pudo copiar. Seleccioná la dirección manualmente.';
  }
}

document.querySelectorAll('.wallet-copy').forEach((button) => button.addEventListener('click', () => copyWallet(button)));

const colors = { green: '#42d39b', red: '#ff7b6b', blue: '#6bb8c9', grid: '#294239', text: '#91a49b' };
const logoSymbols = new Set(['btc', 'eth', 'sol', 'xrp', 'bnb', 'ada', 'doge', 'pepe', 'shib', 'avax', 'link', 'dot', 'matic', 'arb', 'op', 'trx', 'ltc', 'uni', 'atom', 'xaut']);
const logoUrls = { btc: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png', eth: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png', uni: 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg', pepe: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg', sol: 'https://assets.coingecko.com/coins/images/4128/small/solana.png', xrp: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png', shib: 'https://assets.coingecko.com/coins/images/11939/small/shiba.png', shiba: 'https://assets.coingecko.com/coins/images/11939/small/shiba.png', dot: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png', link: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png', hype: 'https://coin-images.coingecko.com/coins/images/50882/small/hyperliquid.jpg?1729431300' };

function selectExchange(exchange, button) {
  selectedExchange = exchange;
  document.querySelectorAll('.exchange-button').forEach((item) => item.classList.toggle('selected', item === button));
  $('#topUploadButton').classList.remove('disabled-upload');
  $('#emptyUploadButton').classList.remove('disabled-upload');
  const exchangeName = button.querySelector('span:last-child')?.textContent.trim() || exchange;
  $('#exchangeHelp').textContent = `${exchangeName} seleccionado. Ahora carga tu historial de posiciones cerradas.`;
}

function num(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return Number(text) || 0;
}

function toDate(value) {
  const result = value instanceof Date ? value : new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function toBingxDate(value) {
  if (value instanceof Date) return value;
  const text = String(value ?? '').trim().replace(' ', 'T');
  const result = new Date(`${text}+08:00`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function field(row, ...names) {
  const key = names.find((name) => Object.prototype.hasOwnProperty.call(row, name));
  return key ? row[key] : '';
}

function normalizeSymbol(symbol) {
  const value = String(symbol ?? '').trim().toUpperCase().replace(/[-_]/g, '');
  return /^GOLD\(XAU[T]?\)USDT$/.test(value) ? 'GOLD(XAU)USDT' : value;
}

function clean(rows) {
  return rows.map((row) => ({
    date: toDate(field(row, 'Open Time', 'Open Time(UTC-03:00)')), close: toDate(field(row, 'Close Time')), symbol: normalizeSymbol(field(row, 'Futures')), direction: String(field(row, 'Direction') ?? '').trim(),
    entry: num(field(row, 'Avg Entry Price')), exit: num(field(row, 'Avg Close Price')), volume: num(field(row, 'Closing Qty (Cont.)')), fee: Math.abs(num(field(row, 'Trading Fee', 'Fee'))), pnl: num(field(row, 'Realized PNL')) - Math.abs(num(field(row, 'Trading Fee', 'Fee'))), status: String(field(row, 'Status') ?? '').trim(),
  })).filter((trade) => trade.date && trade.close && trade.symbol && /closed/i.test(trade.status));
}

function rowsFromHeader(sheet, requiredHeader) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' });
  const headerIndex = matrix.findIndex((row) => row.some((value) => String(value).trim() === requiredHeader));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map((header) => String(header).trim());
  return matrix.slice(headerIndex + 1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function cleanBinance(rows) {
  return rows.map((row) => ({
    date: toDate(row.Opened), close: toDate(row.Closed), symbol: normalizeSymbol(row.Symbol), direction: String(row['Position Side'] ?? '').trim(),
    entry: num(row['Entry Price']), exit: num(row['Avg. Close Price']), volume: num(row['Closed Vol.']), fee: 0, pnl: num(row['Closing PNL']), status: String(row.Status ?? '').trim(),
  })).filter((trade) => trade.date && trade.close && trade.symbol && /closed/i.test(trade.status));
}

function tradeDirection(value) {
  return String(value ?? '').match(/Long|Short/i)?.[0] ?? '';
}

function cleanBingx(rows) {
  const openLots = new Map();
  const trades = [];
  const ordered = [...rows].sort((a, b) => (toBingxDate(a['Time(UTC+8)']) || 0) - (toBingxDate(b['Time(UTC+8)']) || 0));
  ordered.forEach((row) => {
    const type = String(row.Type ?? '');
    const action = type.match(/^Open|^Close/i)?.[0]?.toLowerCase();
    const direction = tradeDirection(type);
    const date = toBingxDate(row['Time(UTC+8)']);
    const symbol = normalizeSymbol(String(row.Pair ?? '').replace(/-/g, ''));
    const quantity = Math.abs(num(row.Quantity));
    if (!action || !direction || !date || !symbol || !quantity) return;
    const key = `${symbol}|${direction.toLowerCase()}`;
    if (action === 'open') {
      if (!openLots.has(key)) openLots.set(key, []);
      openLots.get(key).push({ quantity, baseQuantity: quantity, price: num(row.AvgPrice || row.DealPrice), fee: Math.abs(num(row.Fee)), date });
      return;
    }
    let remaining = quantity;
    const lots = openLots.get(key) || [];
    const matched = [];
    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const used = Math.min(remaining, lot.quantity);
      matched.push({ ...lot, quantity: used });
      lot.quantity -= used;
      remaining -= used;
      if (lot.quantity <= 0.000000001) lots.shift();
    }
    const matchedQuantity = matched.reduce((sum, lot) => sum + lot.quantity, 0);
    const entry = matchedQuantity ? matched.reduce((sum, lot) => sum + lot.price * lot.quantity, 0) / matchedQuantity : num(row.DealPrice || row.AvgPrice);
    const openingFee = matched.reduce((sum, lot) => sum + lot.fee * (lot.quantity / lot.baseQuantity), 0);
    const fee = openingFee + Math.abs(num(row.Fee));
    const grossPnl = num(row['Realized PNL']);
    trades.push({ date: matched[0]?.date || date, close: date, symbol, direction, entry, exit: num(row.DealPrice || row.AvgPrice), volume: quantity, fee, pnl: grossPnl - fee, status: 'Closed' });
  });
  return trades;
}

function cleanBitget(rows) {
  return rows.map((row) => {
    const openingFee = Math.abs(num(row['Opening fee']));
    const closingFee = Math.abs(num(row['Closing fee']));
    return {
      date: toDate(row['Opening time']), close: toDate(row['Closed time']), symbol: normalizeSymbol(String(row.Futures ?? '').split(/\s+/)[0]), direction: tradeDirection(row.Futures),
      entry: num(row['Average entry price']), exit: num(row['Average closing price']), volume: num(row['Closed amount']), fee: openingFee + closingFee, pnl: num(row['Position Pnl']) - openingFee - closingFee, status: 'Closed',
    };
  }).filter((trade) => trade.date && trade.close && trade.symbol && trade.direction);
}

function cleanBitunix(rows) {
  return rows.map((row) => {
    const futures = String(row.futures ?? '');
    const fee = Math.abs(num(row['position fee']));
    return {
      date: toDate(row['opening time']), close: toDate(row['closed time']), symbol: normalizeSymbol(futures.split(/\s+/)[0]), direction: tradeDirection(futures),
      entry: num(row['average entry price']), exit: num(row['average closing price']), volume: num(row['closed amount']), fee, pnl: num(row['position pnl']) - fee, status: 'Closed',
    };
  }).filter((trade) => trade.date && trade.close && trade.symbol && trade.direction);
}

async function loadFile(file) {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return alert('Selecciona un archivo válido (.xlsx, .xls o .csv).');
  if (!selectedExchange) return alert('Selecciona primero el exchange del archivo.');
  if (!['mexc', 'binance', 'bingx', 'bitget', 'bitunix'].includes(selectedExchange)) return alert('Selecciona un exchange válido.');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (selectedExchange === 'binance') {
    const trades = cleanBinance(rowsFromHeader(sheet, 'Symbol'));
    if (!trades.length) return alert('No se encontraron posiciones cerradas con el formato esperado de Binance.');
    return render(trades, file.name);
  }
  if (selectedExchange === 'bingx') {
    const trades = cleanBingx(rowsFromHeader(sheet, 'Pair'));
    if (!trades.length) return alert('No se encontraron trades cerrados con el formato esperado de BingX.');
    return render(trades, file.name);
  }
  if (selectedExchange === 'bitget') {
    const trades = cleanBitget(rowsFromHeader(sheet, 'Futures'));
    if (!trades.length) return alert('No se encontraron trades cerrados con el formato esperado de Bitget.');
    return render(trades, file.name);
  }
  if (selectedExchange === 'bitunix') {
    const trades = cleanBitunix(rowsFromHeader(sheet, 'futures'));
    if (!trades.length) return alert('No se encontraron trades cerrados con el formato esperado de Bitunix.');
    return render(trades, file.name);
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' });
  const headerIndex = matrix.findIndex((row) => row.some((value) => String(value).trim() === 'Status'));
  if (headerIndex < 0) return alert('No se encontró la fila de encabezados del archivo de MEXC.');
  const headers = matrix[headerIndex].map((header) => String(header).trim());
  const rows = matrix.slice(headerIndex + 1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  const trades = clean(rows);
  if (!trades.length) return alert('No se encontraron trades cerrados con el formato esperado de MEXC.');
  render(trades, file.name);
}

function money(value) { return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function price(value) {
  const numericValue = Number(value);
  const integerDigits = Math.max(1, Math.floor(Math.abs(numericValue)).toString().length);
  const decimalDigits = Math.max(0, 7 - integerDigits);
  return numericValue.toLocaleString('es-AR', { maximumFractionDigits: decimalDigits });
}
function assetCode(symbol) {
  const value = String(symbol ?? '').trim().toUpperCase().replace(/[-_]/g, '');
  const base = value.replace(/(?:USDT|USDC|BUSD|USD)$/i, '');
  return base.replace(/^GOLD\(XAUT\)$/i, 'XAUT').replace(/^GOLD\(XAU\)$/i, 'XAU').toLowerCase();
}
function assetInitials(symbol) { return assetCode(symbol).slice(0, 3).toUpperCase(); }
function assetCell(symbol) {
  const code = assetCode(symbol);
  const theme = /XAU|GOLD/i.test(symbol) ? 'gold' : (/XAG/i.test(symbol) ? 'silver' : (/OIL/i.test(symbol) ? 'oil' : ''));
  const logo = !theme && (logoUrls[code] || (logoSymbols.has(code) ? `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${code}.png` : ''));
  const fallback = theme === 'gold' ? '<span class="gold-bars"><i></i><i></i></span>' : (theme === 'silver' ? '<span class="silver-bars"><i></i><i></i></span>' : (theme === 'oil' ? '<span class="oil-drop"></span>' : assetInitials(symbol)));
  return `<span class="asset-cell">${logo ? `<img class="asset-logo" src="${logo}" alt="Logo de ${symbol}" loading="eager" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">` : ''}<span class="asset-fallback ${theme ? theme + '-fallback' : ''}" style="display:${logo ? 'none' : 'grid'}">${fallback}</span><b>${symbol}</b></span>`;
}
function directionCell(direction) {
  const isLong = String(direction).toLowerCase() === 'long';
  return `<span class="direction-cell"><span class="direction-arrow ${isLong ? 'long-arrow' : 'short-arrow'}">${isLong ? '↑' : '↓'}</span><span>${direction}</span></span>`;
}
function percent(value) { return `${value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function duration(open, close) {
  const minutes = Math.max(0, Math.round((close - open) / 60000));
  const days = Math.floor(minutes / 1440); const hours = Math.floor((minutes % 1440) / 60); const rest = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${rest}m`;
  return `${rest}m`;
}
function aggregate(trades, key) { return trades.reduce((result, trade) => { result[trade[key]] = (result[trade[key]] || 0) + trade.pnl; return result; }, {}); }
function dayKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function monthLabel(date) { return date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(/^./, (letter) => letter.toUpperCase()); }
function renderCalendar() {
  const totals = {};
  currentTrades.forEach((trade) => { const key = dayKey(trade.date); totals[key] = (totals[key] || 0) + trade.pnl; });
  const year = calendarMonth.getFullYear(); const month = calendarMonth.getMonth(); const firstDay = new Date(year, month, 1); const daysInMonth = new Date(year, month + 1, 0).getDate(); const mondayIndex = (firstDay.getDay() + 6) % 7;
  $('#calendarMonth').textContent = monthLabel(calendarMonth);
  const cells = [];
  for (let index = 0; index < mondayIndex; index += 1) cells.push('<div class="calendar-day empty"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = totals[dayKey(new Date(year, month, day))]; const state = value === undefined ? '' : (value >= 0 ? ' positive-day' : ' negative-day');
    cells.push(`<div class="calendar-day${state}"><span class="calendar-number">${day}</span>${value === undefined ? '<span class="calendar-pnl">-</span>' : `<span class="calendar-pnl">${money(value)}</span>`}</div>`);
  }
  $('#calendarGrid').innerHTML = cells.join('');
}
function renderStreaks() {
  const ordered = [...currentTrades].sort((a, b) => a.date - b.date); let currentType = ''; let currentLength = 0; let maxWin = 0; let maxLoss = 0; let currentRun = 0; let currentRunType = '';
  ordered.forEach((trade) => {
    const type = trade.pnl > 0 ? 'win' : (trade.pnl < 0 ? 'loss' : 'flat');
    if (type === 'flat') { currentType = ''; currentLength = 0; currentRun = 0; currentRunType = 'flat'; return; }
    if (type === currentType) currentLength += 1; else { currentType = type; currentLength = 1; }
    if (type === 'win') maxWin = Math.max(maxWin, currentLength); else maxLoss = Math.max(maxLoss, currentLength);
    currentRun = currentLength; currentRunType = type;
  });
  $('#streakMetrics').innerHTML = `<div class="streak-card"><div class="streak-card-label">Mejor racha positiva</div><div class="streak-card-value positive">${maxWin}</div><div class="card-note">trades consecutivos</div></div><div class="streak-card"><div class="streak-card-label">Peor racha negativa</div><div class="streak-card-value negative">${maxLoss}</div><div class="card-note">trades consecutivos</div></div>`;
  $('#streakSummary').innerHTML = ordered.length ? (currentRunType === 'flat' ? 'El último trade tuvo resultado neutro, por lo que no pertenece a una racha positiva o negativa.' : `Racha actual: <strong class="${currentRunType === 'win' ? 'positive' : 'negative'}">${currentRun} ${currentRunType === 'win' ? 'trade ganador' : 'trade perdedor'}${currentRun === 1 ? '' : 'es'}</strong> consecutivos.`) : 'No hay trades cerrados para analizar.';
}

function render(trades, fileName) {
  currentTrades = trades;
  calendarMonth = new Date(Math.max(...trades.map((trade) => trade.date.getTime())));
  $('#directionFilter').value = 'all';
  $('#symbolFilter').value = 'all';
  $('#durationSort').value = 'date';
  populateSymbolFilter();
  $('#emptyState').classList.add('hidden'); $('#landingInfo').classList.add('hidden'); $('#landingExtras').classList.add('hidden'); $('#dashboard').classList.remove('hidden'); $('#fileName').textContent = fileName; $('#tradeCount').textContent = `${trades.length} trades cerrados analizados`;
  const wins = trades.filter((trade) => trade.pnl > 0); const losses = trades.filter((trade) => trade.pnl < 0); const net = trades.reduce((sum, trade) => sum + trade.pnl, 0); const fees = trades.reduce((sum, trade) => sum + trade.fee, 0); const average = net / trades.length; const winRate = wins.length / trades.length * 100;
  const profitFactor = losses.length ? wins.reduce((sum, trade) => sum + trade.pnl, 0) / Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0)) : Infinity;
  const ordered = [...trades].sort((a, b) => a.date - b.date); let running = 0; let peak = 0; let maxDrawdown = 0;
  ordered.forEach((trade) => { running += trade.pnl; peak = Math.max(peak, running); maxDrawdown = Math.min(maxDrawdown, running - peak); });
  const metrics = [['PNL neto', money(net), 'Resultado realizado', net], ['Fees totales', money(-fees), 'Comisiones acumuladas', -fees], ['Tasa de acierto', percent(winRate), `${wins.length} ganadoras / ${losses.length} perdedoras`, winRate], ['Profit factor', Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞', 'Ganancia bruta / pérdida bruta', profitFactor], ['Promedio por trade', money(average), 'Resultado medio', average], ['Drawdown máx.', money(maxDrawdown), 'Desde el último máximo', maxDrawdown]];
  $('#metricCards').innerHTML = metrics.map(([label, value, note, tone]) => `<div class="card"><div class="card-label">${label}</div><div class="card-value ${tone < 0 ? 'negative' : 'positive'}">${value}</div><div class="card-note">${note}</div></div>`).join('');
  $('#tableSummary').textContent = `${wins.length} ganadoras · ${losses.length} perdedoras`; drawCharts(trades, ordered, wins, losses);
  renderCalendar();
  renderStreaks();
  setTimeout(renderTradeTable, 0);
  $('#tradeTable').innerHTML = [...trades].sort((a, b) => b.date - a.date).map((trade) => `<tr><td>${trade.date.toLocaleString('es-AR')}</td><td>${assetCell(trade.symbol)}</td><td>${trade.direction}</td><td>${price(trade.entry)}</td><td>${price(trade.exit)}</td><td>${duration(trade.date, trade.close)}</td><td>${trade.volume.toLocaleString('es-AR', { maximumFractionDigits: 4 })}</td><td class="negative">${money(-trade.fee)}</td><td class="${trade.pnl >= 0 ? 'positive' : 'negative'}"><b>${money(trade.pnl)}</b></td><td><span class="badge ${trade.pnl < 0 ? 'loss' : ''}">${trade.pnl >= 0 ? 'Ganadora' : 'Perdedora'}</span></td></tr>`).join('');
}

function renderTradeTable() {
  const filter = $('#directionFilter').value;
  const symbolFilter = $('#symbolFilter').value;
  const durationSort = $('#durationSort').value;
  const visibleTrades = currentTrades.filter((trade) => (filter === 'all' || trade.direction.toLowerCase() === filter) && (symbolFilter === 'all' || trade.symbol === symbolFilter));
  const sortedTrades = [...visibleTrades].sort((a, b) => {
    if (durationSort === 'longest') return (b.close - b.date) - (a.close - a.date);
    if (durationSort === 'shortest') return (a.close - a.date) - (b.close - b.date);
    return b.date - a.date;
  });
  $('#tableSummary').textContent = `${visibleTrades.length} de ${currentTrades.length} trades`;
  $('#tradeTable').innerHTML = sortedTrades.map((trade) => `<tr><td>${trade.date.toLocaleString('es-AR')}</td><td>${assetCell(trade.symbol)}</td><td>${directionCell(trade.direction)}</td><td>${price(trade.entry)}</td><td>${price(trade.exit)}</td><td>${duration(trade.date, trade.close)}</td><td>${trade.volume.toLocaleString('es-AR', { maximumFractionDigits: 4 })}</td><td class="negative">${money(-trade.fee)}</td><td class="${trade.pnl >= 0 ? 'positive' : 'negative'}"><b>${money(trade.pnl)}</b></td><td><span class="badge ${trade.pnl < 0 ? 'loss' : ''}">${trade.pnl >= 0 ? 'Ganadora' : 'Perdedora'}</span></td></tr>`).join('');
}

function populateSymbolFilter() {
  const symbols = [...new Set(currentTrades.map((trade) => trade.symbol))].sort();
  $('#symbolFilter').innerHTML = '<option value="all">Todos</option>' + symbols.map((symbol) => `<option value="${symbol}">${symbol}</option>`).join('');
}

function makeChart(id, type, data, options = {}) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($('#' + id), { type, data, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 850, easing: 'easeOutQuart' }, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0b1512', borderColor: '#315347', borderWidth: 1, titleColor: '#e8f1ed', bodyColor: '#b9cbc2', padding: 12, cornerRadius: 10, displayColors: false } }, scales: type === 'doughnut' ? {} : { x: { grid: { display: false }, border: { display: false }, ticks: { color: colors.text, maxRotation: 0, autoSkip: true } }, y: { grid: { color: colors.grid }, border: { display: false }, ticks: { color: colors.text } } }, ...options } });
}

function drawCharts(trades, ordered, wins, losses) {
  let running = 0; const equity = ordered.map((trade) => { running += trade.pnl; return running; }); const labels = ordered.map((trade) => trade.date.toLocaleDateString('es-AR')); const moneyTooltip = { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => money(context.raw) } } } };
  const equityContext = $('#equityChart').getContext('2d'); const equityGradient = equityContext.createLinearGradient(0, 0, 0, 280); equityGradient.addColorStop(0, '#42d39b66'); equityGradient.addColorStop(1, '#42d39b00');
  makeChart('equityChart', 'line', { labels, datasets: [{ data: equity, borderColor: colors.green, backgroundColor: equityGradient, fill: true, tension: .38, borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: colors.green }] }, moneyTooltip);
  makeChart('winLossChart', 'doughnut', { labels: ['Ganadoras', 'Perdedoras'], datasets: [{ data: [wins.length, losses.length], backgroundColor: [colors.green, colors.red], borderWidth: 5, borderColor: '#14221d', hoverOffset: 8 }] }, { cutout: '72%', plugins: { legend: { display: true, position: 'bottom', labels: { color: colors.text, usePointStyle: true, padding: 18 } } } });
  const byDay = {}; [...trades].sort((a, b) => a.date - b.date).forEach((trade) => { const key = trade.date.toLocaleDateString('es-AR'); byDay[key] = (byDay[key] || 0) + trade.pnl; });
  makeChart('dailyChart', 'bar', { labels: Object.keys(byDay), datasets: [{ data: Object.values(byDay), backgroundColor: Object.values(byDay).map((value) => value >= 0 ? colors.green : colors.red), borderRadius: 5 }] }, moneyTooltip);
  const byDirection = aggregate(trades, 'direction'); makeChart('directionChart', 'bar', { labels: Object.keys(byDirection), datasets: [{ data: Object.values(byDirection), backgroundColor: Object.values(byDirection).map((value) => value >= 0 ? colors.green : colors.red), borderRadius: 8, borderSkipped: false, barPercentage: .56 }] }, moneyTooltip);
  const symbolCounts = trades.reduce((result, trade) => { result[trade.symbol] = (result[trade.symbol] || 0) + 1; return result; }, {});
  const topSymbols = Object.entries(aggregate(trades, 'symbol')).sort((a, b) => b[1] - a[1]);
  const maxSymbolPnl = Math.max(...topSymbols.map(([, value]) => Math.abs(value)), 1);
  $('#assetList').innerHTML = topSymbols.map(([symbol, value]) => `<div class="asset-row"><div class="asset-row-heading">${assetCell(symbol)}<span class="asset-trades">${symbolCounts[symbol]} trades · PNL neto después de fees</span><strong class="${value >= 0 ? 'positive' : 'negative'}">${money(value)}</strong></div><div class="asset-bar-track"><div class="asset-bar ${value >= 0 ? 'profit' : 'loss-bar'}" style="width:${Math.max(5, Math.abs(value) / maxSymbolPnl * 100)}%"></div></div></div>`).join('');
  const byHour = Array.from({ length: 24 }, (_, hour) => [hour, 0]); trades.forEach((trade) => { byHour[trade.date.getHours()][1] += trade.pnl; }); makeChart('hourChart', 'bar', { labels: byHour.map(([hour]) => `${String(hour).padStart(2, '0')}:00`), datasets: [{ data: byHour.map(([, value]) => value), backgroundColor: byHour.map(([, value]) => value >= 0 ? colors.green : colors.red), borderRadius: 4 }] }, moneyTooltip);
}
