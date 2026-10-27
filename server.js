const http = require('node:http');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { execFile } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = 3210;
const ROOT = __dirname;
const ORIGIN = `http://${HOST}:${PORT}`;
const MEXC_API = 'https://api.mexc.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 5000;
const MAX_WINDOW = 89 * 24 * 60 * 60 * 1000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};
const PUBLIC_FILES = new Set(['index.html', 'app.js', 'styles.css', 'logo sin fondo dorado.png', 'logo dorado icono.ico', 'logoverde.png']);

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 8192) {
        reject(new Error('La solicitud excede el tamaño permitido.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('El cuerpo de la solicitud no es JSON válido.')); }
    });
    request.on('error', reject);
  });
}

function pageItems(body) {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.resultList)) return data.resultList;
  return [];
}

function checkMexcResponse(body) {
  if (!body || (body.code !== undefined && Number(body.code) !== 0)) {
    const code = body?.code ?? 'desconocido';
    const message = typeof body?.message === 'string' ? body.message : 'MEXC rechazó la solicitud.';
    throw new Error(`MEXC respondió ${code}: ${message}`);
  }
}

function signedQuery(apiKey, secretKey, pathname, parameters) {
  const sorted = Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right));
  const query = new URLSearchParams(sorted).toString();
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secretKey).update(`${apiKey}${timestamp}${query}`).digest('hex');
  const url = `${MEXC_API}${pathname}?${query}`;
  return fetch(url, {
    method: 'GET',
    headers: { ApiKey: apiKey, 'Request-Time': timestamp, Signature: signature, 'Content-Type': 'application/json', 'Recv-Window': '10' },
    signal: AbortSignal.timeout(20000),
  }).then(async (response) => {
    let body;
    try { body = await response.json(); } catch { throw new Error(`MEXC devolvió una respuesta no válida (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(`MEXC respondió HTTP ${response.status}.`);
    checkMexcResponse(body);
    return body;
  });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function collectPages(apiKey, secretKey, pathname, baseParameters) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (items.length) await sleep(120);
    const body = await signedQuery(apiKey, secretKey, pathname, { ...baseParameters, page_num: page, page_size: PAGE_SIZE });
    const batch = pageItems(body);
    items.push(...batch);
    const totalPage = Number(body?.data?.totalPage || body?.data?.total_page || 0);
    if (batch.length < PAGE_SIZE || (totalPage && page >= totalPage)) return items;
  }
  throw new Error('MEXC superó el límite de páginas de seguridad. Reduce el rango de datos consultado.');
}

function timestamp(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value ?? ''))) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
  }
  return Date.parse(value);
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function hasNumber(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key) && object[key] !== null && object[key] !== '' && Number.isFinite(Number(object[key]));
}

function normalizePosition(position, orders) {
  const positionId = String(position.positionId);
  const related = orders.filter((order) => String(order.positionId) === positionId && Number(order.state) === 3);
  const hasPositionAccounting = hasNumber(position, 'closeProfitLoss') && (hasNumber(position, 'totalFee') || hasNumber(position, 'fee'));
  if (!hasPositionAccounting && !related.length) throw new Error(`No se pudieron asociar las órdenes y comisiones de la posición ${positionId}. No se cargaron datos incompletos.`);
  const closeOrders = related.filter((order) => Number(order.side) === 2 || Number(order.side) === 4);
  const closeVolume = numeric(position.closeVol) || closeOrders.reduce((sum, order) => sum + numeric(order.dealVol), 0);
  const closeNotional = closeOrders.reduce((sum, order) => sum + numeric(order.dealAvgPrice) * numeric(order.dealVol), 0);
  const closeOrderVolume = closeOrders.reduce((sum, order) => sum + numeric(order.dealVol), 0);
  const tradeFees = hasNumber(position, 'totalFee') ? Math.abs(numeric(position.totalFee))
    : (hasNumber(position, 'fee') ? Math.abs(numeric(position.fee))
      : related.reduce((sum, order) => sum + Math.abs(numeric(order.takerFee)) + Math.abs(numeric(order.makerFee)), 0));
  const fees = tradeFees - numeric(position.holdFee);
  const openedAt = timestamp(position.createTime);
  const closedAt = timestamp(position.updateTime);
  const grossPnl = hasNumber(position, 'closeProfitLoss') ? numeric(position.closeProfitLoss)
    : closeOrders.reduce((sum, order) => sum + numeric(order.profit), 0);
  if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt) || !position.symbol || !closeVolume) {
    throw new Error(`MEXC devolvió datos incompletos para la posición ${positionId}.`);
  }
  return {
    date: new Date(openedAt).toISOString(), close: new Date(closedAt).toISOString(),
    symbol: String(position.symbol).replace(/_/g, ''), direction: Number(position.positionType) === 1 ? 'Long' : 'Short',
    entry: numeric(position.openAvgPrice),
    exit: closeOrderVolume ? closeNotional / closeOrderVolume : numeric(position.closeAvgPrice),
    volume: closeVolume, fee: fees, pnl: grossPnl - fees, status: 'Closed',
  };
}

async function getMexcTrades(apiKey, secretKey) {
  const positions = await collectPages(apiKey, secretKey, '/api/v1/private/position/list/history_positions', {});
  const closed = positions.filter((position) => Number(position.state) === 3);
  if (!closed.length) return [];

  const orderMap = new Map();
  const fallbackPositions = closed.filter((position) => !hasNumber(position, 'closeProfitLoss') || (!hasNumber(position, 'totalFee') && !hasNumber(position, 'fee')));
  if (fallbackPositions.length) {
    const times = fallbackPositions.flatMap((position) => [timestamp(position.createTime), timestamp(position.updateTime)]).filter(Number.isFinite);
    if (!times.length) throw new Error('MEXC no devolvió fechas válidas para consultar las comisiones.');
    const earliest = times.reduce((minimum, value) => Math.min(minimum, value), Infinity);
    const latest = times.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
    for (let start = earliest; start <= latest; start += MAX_WINDOW) {
      const end = Math.min(start + MAX_WINDOW, latest);
      const batch = await collectPages(apiKey, secretKey, '/api/v1/private/order/list/history_orders', {
        start_time: start, end_time: end, states: '3',
      });
      batch.forEach((order) => {
        const id = String(order.orderId);
        if (id && id !== 'undefined') orderMap.set(id, order);
      });
      if (end === latest) break;
      await sleep(120);
    }
  }

  const orders = [...orderMap.values()];
  return closed.map((position) => normalizePosition(position, orders)).sort((a, b) => a.date.localeCompare(b.date));
}

async function handleApi(request, response) {
  if (request.method !== 'POST' || request.url !== '/api/mexc/trades') return sendJson(response, 404, { error: 'Ruta no encontrada.' });
  if (request.headers.host !== `${HOST}:${PORT}` || request.headers.origin !== ORIGIN || request.headers['sec-fetch-site'] === 'cross-site') {
    return sendJson(response, 403, { error: 'Solicitud local no autorizada. Abre TradeMetrics con “Abrir analizador.bat”.' });
  }
  try {
    const credentials = await readJson(request);
    if (typeof credentials.apiKey !== 'string' || typeof credentials.secretKey !== 'string' || credentials.apiKey.length > 256 || credentials.secretKey.length > 256 || !credentials.apiKey.trim() || !credentials.secretKey.trim()) {
      return sendJson(response, 400, { error: 'Completa una API Key y una Secret Key válidas.' });
    }
    const trades = await getMexcTrades(credentials.apiKey.trim(), credentials.secretKey.trim());
    return sendJson(response, 200, { trades });
  } catch (error) {
    const message = error.name === 'TimeoutError' ? 'MEXC tardó demasiado en responder. Intenta otra vez.' : error.message;
    return sendJson(response, 502, { error: message || 'No se pudo consultar MEXC.' });
  }
}

const server = http.createServer(async (request, response) => {
  if (request.url?.startsWith('/api/')) return handleApi(request, response);
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Método no permitido.' });
  if (request.headers.host !== `${HOST}:${PORT}`) return sendJson(response, 403, { error: 'Host no autorizado.' });
  let name;
  try { name = decodeURIComponent(new URL(request.url, ORIGIN).pathname).replace(/^\/+/, '') || 'index.html'; }
  catch { return sendJson(response, 400, { error: 'Ruta inválida.' }); }
  if (!PUBLIC_FILES.has(name) || name.includes('..') || path.basename(name) !== name) return sendJson(response, 404, { error: 'Archivo no encontrado.' });
  response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(name)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  if (request.method === 'HEAD') return response.end();
  createReadStream(path.join(ROOT, name)).on('error', () => {
    if (!response.headersSent) response.writeHead(404);
    response.end('Archivo no encontrado.');
  }).pipe(response);
});

server.listen(PORT, HOST, () => {
  const url = `${ORIGIN}/`;
  console.log(`TradeMetrics local disponible en ${url}. Cierra esta ventana para detener el conector.`);
  execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, () => {});
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
