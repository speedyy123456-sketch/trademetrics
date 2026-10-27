import { createHmac } from 'node:crypto';

const MEXC_API = 'https://api.mexc.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 5000;
const PAGES_PER_INVOCATION = 10;
const MAX_WINDOW = 89 * 24 * 60 * 60 * 1000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'Netlify-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function pageItems(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.resultList)) return body.data.resultList;
  if (Array.isArray(body?.resultList)) return body.resultList;
  return [];
}

function pageTotal(body) {
  return Number(body?.data?.totalPage || body?.data?.total_page || body?.totalPage || body?.total_page || 0);
}

function validateMexcResponse(body) {
  if (!body || (body.code !== undefined && Number(body.code) !== 0)) {
    const code = body?.code ?? 'desconocido';
    const message = typeof body?.message === 'string' ? body.message : 'MEXC rechazó la solicitud.';
    throw new Error(`MEXC respondió ${code}: ${message}`);
  }
}

async function signedGet(apiKey, secretKey, pathname, params) {
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : (a > b ? 1 : 0)))).toString();
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', secretKey).update(`${apiKey}${timestamp}${query}`).digest('hex');
  const response = await fetch(`${MEXC_API}${pathname}?${query}`, {
    method: 'GET',
    headers: {
      ApiKey: apiKey,
      'Request-Time': timestamp,
      Signature: signature,
      'Content-Type': 'application/json',
      'Recv-Window': '10',
    },
    signal: AbortSignal.timeout(15000),
  });
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`MEXC devolvió una respuesta no válida (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(`MEXC respondió HTTP ${response.status}.`);
  validateMexcResponse(body);
  return body;
}

function timestamp(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value ?? ''))) return Number(value);
  return Date.parse(value);
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function hasNumber(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
    && object[key] !== null && object[key] !== '' && Number.isFinite(Number(object[key]));
}

async function collectOrderPages(apiKey, secretKey, params) {
  const orders = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (page > 1) await new Promise((resolve) => setTimeout(resolve, 120));
    const body = await signedGet(apiKey, secretKey, '/api/v1/private/order/list/history_orders', {
      ...params, page_num: page, page_size: PAGE_SIZE,
    });
    const batch = pageItems(body);
    orders.push(...batch);
    const totalPage = pageTotal(body);
    if (batch.length < PAGE_SIZE || (totalPage && page >= totalPage)) return orders;
  }
  throw new Error('MEXC superó el límite de páginas del historial de órdenes.');
}

async function getFallbackOrders(apiKey, secretKey, positions) {
  const times = positions.flatMap((position) => [timestamp(position.createTime), timestamp(position.updateTime)]).filter(Number.isFinite);
  if (!times.length) throw new Error('MEXC no devolvió fechas válidas para consultar las comisiones.');
  const earliest = times.reduce((minimum, value) => Math.min(minimum, value), Infinity);
  const latest = times.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
  const orderMap = new Map();
  for (let start = earliest; start <= latest; start += MAX_WINDOW) {
    const end = Math.min(start + MAX_WINDOW, latest);
    const batch = await collectOrderPages(apiKey, secretKey, { start_time: start, end_time: end, states: '3' });
    batch.forEach((order) => {
      const id = String(order.orderId);
      if (id && id !== 'undefined') orderMap.set(id, order);
    });
    if (end === latest) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return [...orderMap.values()];
}

function normalizePosition(position, orders) {
  const positionId = String(position.positionId);
  const related = orders.filter((order) => String(order.positionId) === positionId && Number(order.state) === 3);
  const hasPositionAccounting = hasNumber(position, 'closeProfitLoss')
    && (hasNumber(position, 'totalFee') || hasNumber(position, 'fee'));
  if (!hasPositionAccounting && !related.length) {
    throw new Error(`No se pudieron asociar las órdenes y comisiones de la posición ${positionId}. No se cargaron datos incompletos.`);
  }
  const closeOrders = related.filter((order) => Number(order.side) === 2 || Number(order.side) === 4);
  const closeOrderVolume = closeOrders.reduce((sum, order) => sum + numeric(order.dealVol), 0);
  const closeNotional = closeOrders.reduce((sum, order) => sum + numeric(order.dealAvgPrice) * numeric(order.dealVol), 0);
  const closeVolume = numeric(position.closeVol) || closeOrderVolume;
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
    date: new Date(openedAt).toISOString(),
    close: new Date(closedAt).toISOString(),
    symbol: String(position.symbol).replace(/_/g, ''),
    direction: Number(position.positionType) === 1 ? 'Long' : 'Short',
    entry: numeric(position.openAvgPrice),
    exit: closeOrderVolume ? closeNotional / closeOrderVolume : numeric(position.closeAvgPrice),
    volume: closeVolume,
    fee: fees,
    pnl: grossPnl - fees,
    status: 'Closed',
  };
}

export default async function handler(request) {
  if (request.method !== 'POST') return json(405, { error: 'Método no permitido.' });
  const requestUrl = new URL(request.url);
  if (request.headers.get('origin') !== requestUrl.origin) return json(403, { error: 'Origen de solicitud no autorizado.' });

  try {
    const rawBody = await request.text();
    if (rawBody.length > 4096) return json(413, { error: 'La solicitud excede el tamaño permitido.' });
    let credentials;
    try { credentials = JSON.parse(rawBody || '{}'); }
    catch { return json(400, { error: 'El cuerpo de la solicitud no es JSON válido.' }); }

    const { apiKey, secretKey } = credentials;
    const pageNum = Number(credentials.pageNum);
    if (typeof apiKey !== 'string' || typeof secretKey !== 'string'
      || !apiKey.trim() || !secretKey.trim() || apiKey.length > 256 || secretKey.length > 256) {
      return json(400, { error: 'Completa una API Key y una Secret Key válidas.' });
    }
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > MAX_PAGES) {
      return json(400, { error: `Número de página inválido (máximo ${MAX_PAGES}).` });
    }

    const positions = [];
    let nextPage = pageNum;
    let hasMore = false;
    for (let requestCount = 0; requestCount < PAGES_PER_INVOCATION; requestCount += 1) {
      if (nextPage > MAX_PAGES) throw new Error(`MEXC superó el límite de ${MAX_PAGES} páginas.`);
      if (requestCount > 0) await new Promise((resolve) => setTimeout(resolve, 120));
      const body = await signedGet(apiKey.trim(), secretKey.trim(), '/api/v1/private/position/list/history_positions', {
        page_num: nextPage,
        page_size: PAGE_SIZE,
      });
      const batch = pageItems(body);
      positions.push(...batch);
      const totalPage = pageTotal(body);
      hasMore = totalPage ? nextPage < totalPage : batch.length === PAGE_SIZE;
      nextPage += 1;
      if (!hasMore) break;
    }
    const closedPositions = positions.filter((position) => Number(position.state) === 3);
    const fallbackPositions = closedPositions.filter((position) => !hasNumber(position, 'closeProfitLoss')
      || (!hasNumber(position, 'totalFee') && !hasNumber(position, 'fee')));
    const orders = fallbackPositions.length ? await getFallbackOrders(apiKey.trim(), secretKey.trim(), fallbackPositions) : [];
    const trades = closedPositions.map((position) => normalizePosition(position, orders));

    return json(200, { pageNum, nextPage, hasMore, trades });
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? 'MEXC tardó demasiado en responder. Intenta nuevamente.'
      : (error.message || 'No se pudo consultar MEXC.');
    return json(502, { error: message });
  }
}

export const config = {
  path: '/api/mexc/trades',
  method: 'POST',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
