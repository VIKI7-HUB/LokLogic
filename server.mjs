import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8'
};

function loadLocalEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadLocalEnv();

const PORT = Number(process.env.PORT || 4173);
const DATA_RESOURCE = process.env.DATA_GOV_RESOURCE_ID || '9ef84268-d588-465a-a308-a864a43d0070';
const DATA_API = 'https://api.data.gov.in/resource/';
const DATA_CACHE_MS = 15 * 60 * 1000;
const priceCache = new Map();

function json(response, status, payload) {
  response.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  response.end(JSON.stringify(payload));
}

async function readBody(request, limit = 256_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function normalizedRecord(record) {
  const lookup = (names) => {
    const key = Object.keys(record).find((candidate) => names.some((name) => candidate.toLowerCase().replace(/[^a-z0-9]/g, '').includes(name)));
    return key ? record[key] : '';
  };
  return {
    state:String(lookup(['state'])), district:String(lookup(['district'])), market:String(lookup(['market'])),
    commodity:String(lookup(['commodity'])), variety:String(lookup(['variety'])),
    date:String(lookup(['arrivaldate','date'])), minPrice:Number(String(lookup(['minprice'])).replace(/[^0-9.]/g, '')),
    maxPrice:Number(String(lookup(['maxprice'])).replace(/[^0-9.]/g, '')),
    modalPrice:Number(String(lookup(['modalprice','modal'])).replace(/[^0-9.]/g, ''))
  };
}

async function getMarketPrices(commodity) {
  const key = process.env.DATA_GOV_API_KEY;
  if (!key) throw Object.assign(new Error('Set DATA_GOV_API_KEY in .env, or import a market CSV.'), { status:503 });
  const cacheKey = commodity.toLowerCase();
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.time < DATA_CACHE_MS) return { ...cached.value, cached:true };
  const url = new URL(DATA_RESOURCE, DATA_API);
  url.searchParams.set('api-key', key);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '100');
  url.searchParams.set('filters[commodity]', commodity);
  const upstream = await fetch(url, { headers:{ accept:'application/json' }, signal:AbortSignal.timeout(12000) });
  if (!upstream.ok) throw Object.assign(new Error(`data.gov.in returned HTTP ${upstream.status}. Try the CSV import fallback.`), { status:502 });
  const payload = await upstream.json();
  const records = (payload.records || []).map(normalizedRecord).filter((row) => row.market && row.modalPrice > 0 && row.commodity.toLowerCase().includes(commodity.toLowerCase()));
  if (!records.length) throw Object.assign(new Error(`No current ${commodity} rows were returned. Try a CSV or manual prices.`), { status:404 });
  const value = { source:'data.gov.in · AGMARKNET', records, count:records.length, retrievedAt:new Date().toISOString() };
  priceCache.set(cacheKey, { time:Date.now(), value });
  return { ...value, cached:false };
}

function calculateOptions(input) {
  const quantity = Math.max(0, Number(input.quantity) || 0);
  const localPrice = Math.max(0, Number(input.localPrice) || 0);
  const otherPrice = Math.max(0, Number(input.otherPrice) || 0);
  const travelPerQ = Math.max(0, Number(input.travelCost) || 0);
  const commission = Math.min(25, Math.max(0, Number(input.commission) || 0)) / 100;
  const storagePerQWeek = Math.max(0, Number(input.storageCost) || 0);
  const priceLow = Math.min(Number(input.futureLow) || 0, Number(input.futureHigh) || 0);
  const priceHigh = Math.max(Number(input.futureLow) || 0, Number(input.futureHigh) || 0);
  const waitDays = Math.max(0, Number(input.waitDays) || 7);
  const spoilage = Math.min(100, Math.max(0, Number(input.spoilage) || 0)) / 100;
  const cashDeadline = input.cashNeed === 'today' ? 0 : Math.max(0, Number(input.cashNeed) || 0);
  const sellable = quantity * (1 - spoilage);
  const localGross = quantity * localPrice;
  const localFees = localGross * commission;
  const nearbyGross = quantity * otherPrice;
  const nearbyFees = nearbyGross * commission;
  const transport = quantity * travelPerQ;
  const storage = quantity * storagePerQWeek * waitDays / 7;
  const results = [
    { id:'local', net:Math.max(0, localGross - localFees), gross:localGross, fees:localFees, travel:0 },
    { id:'nearby', net:Math.max(0, nearbyGross - nearbyFees - transport), gross:nearbyGross, fees:nearbyFees, travel:transport },
    { id:'store', low:Math.max(0, sellable * priceLow * (1 - commission) - storage - transport), high:Math.max(0, sellable * priceHigh * (1 - commission) - storage - transport), storage, travel:transport, sellable, feasible:cashDeadline >= waitDays }
  ];
  results[2].mid = (results[2].low + results[2].high) / 2;
  const eligible = results.filter((item) => item.id !== 'store' || item.feasible);
  const best = eligible.reduce((winner, item) => !winner || (item.id === 'store' ? item.mid : item.net) > (winner.id === 'store' ? winner.mid : winner.net) ? item : winner, null);
  return { quantity, crop:String(input.crop || 'produce'), cashDeadline, waitDays, commissionPct:commission * 100, spoilagePct:spoilage * 100, results, bestId:best?.id || null, storeFeasible:cashDeadline >= waitDays };
}

function agentTool(name, input, calculation) {
  if (name === 'compare_selling_options') return { calculations:calculation, priceSource:String(input.priceSource || 'Manual/example inputs') };
  if (name === 'check_cash_deadline') return { cashDeadlineDays:calculation.cashDeadline, storageWaitDays:calculation.waitDays, storageFeasible:calculation.storeFeasible, reason:calculation.storeFeasible ? 'The stated cash deadline allows this storage duration.' : 'The farmer needs cash sooner than the storage duration.' };
  if (name === 'draft_buyer_questions') return { questions:[
    `Confirm today’s firm offer for ${calculation.quantity} quintals of ${calculation.crop}.`,
    'Ask about quality deductions, weighing, loading, queue time and payment date.',
    ...(calculation.storeFeasible ? ['Ask a storage provider for availability, full charges and withdrawal conditions.'] : [])
  ], externalAction:'none' };
  return { error:'Unknown or disallowed tool.' };
}

const toolDeclarations = [
  { name:'compare_selling_options', description:'Calculate take-home scenarios from the farmer-provided values. Never invent or change prices.', parameters:{ type:'OBJECT', properties:{} } },
  { name:'check_cash_deadline', description:'Check whether the user-entered cash deadline permits the user-entered storage period.', parameters:{ type:'OBJECT', properties:{} } },
  { name:'draft_buyer_questions', description:'Draft questions the farmer may ask. This tool does not contact anyone.', parameters:{ type:'OBJECT', properties:{} } }
];

async function runGeminiAgent(input, calculation) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const systemText = 'You are Harvest Saathi, a cautious harvest-selling assistant. Use the provided tools before making a recommendation. Prices, transport, fees, storage and future price ranges are user-provided or imported; never invent values. Explain uncertainty and trade-offs in simple language. The farmer makes the decision. Never claim to have contacted a buyer, booked transport, or sold produce. Do not request personal identifiers.';
  const userText = `Help compare this harvest case and explain the next safe step. Case: ${JSON.stringify(input)}. Use the tools to calculate and check the cash deadline. Do not make or claim external actions.`;
  const contents = [{ role:'user', parts:[{ text:userText }] }];
  const trace = [];
  for (let turn = 0; turn < 5; turn += 1) {
    const request = {
      systemInstruction:{ parts:[{ text:systemText }] }, contents,
      tools:[{ functionDeclarations:toolDeclarations }],
      toolConfig:{ functionCallingConfig:{ mode:turn === 0 ? 'ANY' : 'AUTO' } },
      generationConfig:{ temperature:0.2, maxOutputTokens:500 }
    };
    const response = await fetch(endpoint, {
      method:'POST', headers:{ 'content-type':'application/json', 'x-goog-api-key':apiKey },
      body:JSON.stringify(request), signal:AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Gemini returned HTTP ${response.status}`);
    const candidate = data.candidates?.[0]?.content;
    if (!candidate) throw new Error('Gemini returned no agent response.');
    contents.push(candidate);
    const calls = candidate.parts?.filter((part) => part.functionCall).map((part) => part.functionCall) || [];
    if (!calls.length) {
      const answer = candidate.parts?.map((part) => part.text || '').join('\n').trim();
      return { mode:'gemini', model, answer:answer || 'I compared the entered options. Verify the offer and deductions before deciding.', trace, calculation };
    }
    const responses = [];
    for (const call of calls) {
      const result = agentTool(call.name, input, calculation);
      trace.push({ tool:call.name, status:result.error ? 'blocked' : 'complete', summary:result.error || 'Completed using the current case values.' });
      responses.push({ functionResponse:{ name:call.name, response:{ result } } });
    }
    contents.push({ role:'user', parts:responses });
  }
  return { mode:'gemini', model, answer:'I completed the available checks. Review the numbers and confirm the real offer before deciding.', trace, calculation };
}

function rulesAgent(input, calculation, reason = '') {
  const best = calculation.results.find((item) => item.id === calculation.bestId);
  const label = best?.id === 'local' ? 'local mandi' : best?.id === 'nearby' ? 'other mandi' : 'storage scenario midpoint';
  const trace = [
    { tool:'compare_selling_options', status:'complete', summary:'Calculated net amounts from the values entered; no price prediction used.' },
    { tool:'check_cash_deadline', status:calculation.storeFeasible ? 'complete' : 'constraint', summary:calculation.storeFeasible ? 'Storage duration fits the stated cash deadline.' : 'Storage is excluded from the headline because cash is needed sooner.' },
    { tool:'draft_buyer_questions', status:'complete', summary:'Prepared verification questions; no messages were sent.' }
  ];
  const answer = `From the entered figures, the ${label} has the highest eligible estimate. Treat this as a scenario, not a guarantee. Confirm the grade, deductions, transport and payment timing. ${reason}`.trim();
  return { mode:'rules', model:null, answer, trace, calculation };
}

async function handleAgent(request, response) {
  try {
    const body = await readBody(request);
    const input = body.case || {};
    const calculation = calculateOptions(input);
    if (!calculation.quantity || !Number(input.localPrice) || !Number(input.otherPrice)) return json(response, 400, { error:'Enter a quantity and both market prices first.' });
    try {
      const modelResult = await runGeminiAgent(input, calculation);
      return json(response, 200, modelResult || rulesAgent(input, calculation, 'Gemini key is not configured, so the transparent rules agent ran.'));
    } catch (error) {
      return json(response, 200, rulesAgent(input, calculation, `The AI service was unavailable; safe local rules completed the plan. (${error.message})`));
    }
  } catch (error) {
    return json(response, error.message === 'Request body is too large.' ? 413 : 400, { error:error.message || 'Could not build the plan.' });
  }
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(response, 200, { ok:true, modelConfigured:Boolean(process.env.GEMINI_API_KEY), model:process.env.GEMINI_MODEL || 'gemini-3.8-flash', dataGovConfigured:Boolean(process.env.DATA_GOV_API_KEY) });
  }
  if (url.pathname === '/api/prices' && request.method === 'GET') {
    try { return json(response, 200, await getMarketPrices(url.searchParams.get('commodity') || 'Onion')); }
    catch (error) { return json(response, error.status || 502, { error:error.message || 'Price source unavailable.' }); }
  }
  if (url.pathname === '/api/agent/plan' && request.method === 'POST') return handleAgent(request, response);
  if (url.pathname.startsWith('/api/')) return json(response, 404, { error:'API route not found.' });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error:'Method not allowed.' });
  const rawPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(root, `.${rawPath}`);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) return json(response, 403, { error:'Forbidden.' });
  try {
    const file = await fs.promises.readFile(filePath);
    response.writeHead(200, { 'content-type':mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'x-content-type-options':'nosniff', 'cache-control':path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600' });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch {
    json(response, 404, { error:'File not found.' });
  }
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => json(response, 500, { error:error.message || 'Server error.' }));
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Harvest Saathi listening at http://127.0.0.1:${PORT}`);
  console.log(`Gemini: ${process.env.GEMINI_API_KEY ? 'configured' : 'not configured (rules agent active)'}`);
  console.log(`data.gov.in: ${process.env.DATA_GOV_API_KEY ? 'configured' : 'not configured (CSV/manual fallback active)'}`);
});
