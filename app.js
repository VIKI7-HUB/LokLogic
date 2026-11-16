const $ = (id) => document.getElementById(id);
const fields = ['crop','quantity','cashNeed','area','localPrice','otherPrice','travelCost','commission','storageCost','futureLow','futureHigh','waitDays','spoilage'];
const defaults = Object.fromEntries(fields.map((id) => [id, $(id).value]));
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const caseKey = 'harvest-saathi.case.v1';
const number = (id, fallback = 0) => {
  const parsed = Number($(id).value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};
const roundRupees = (value) => Math.round(value / 10) * 10;
const safe = (value) => Math.max(0, value);
const cropName = () => $('crop').selectedOptions[0]?.textContent || 'produce';
const fmt = (value) => currency.format(Math.max(0, value));
let toastTimer;
let importedPrices = null;

function calculate() {
  const quantity = number('quantity', 1);
  const localPrice = number('localPrice');
  const otherPrice = number('otherPrice');
  const travelPerQ = number('travelCost');
  const commission = Math.min(25, number('commission')) / 100;
  const storagePerQWeek = number('storageCost');
  const lowPrice = Math.min(number('futureLow'), number('futureHigh'));
  const highPrice = Math.max(number('futureLow'), number('futureHigh'));
  const waitDays = number('waitDays', 7);
  const spoilagePct = Math.min(100, number('spoilage')) / 100;
  const cashDeadline = $('cashNeed').value === 'today' ? 0 : Number($('cashNeed').value);
  const sellableQuantity = quantity * (1 - spoilagePct);
  const area = $('area').value.trim() || 'nearby area';
  const crop = cropName();

  const localGross = quantity * localPrice;
  const localFees = localGross * commission;
  const localNet = safe(localGross - localFees);
  const otherGross = quantity * otherPrice;
  const otherTransport = quantity * travelPerQ;
  const otherFees = otherGross * commission;
  const otherNet = safe(otherGross - otherFees - otherTransport);
  const storageCost = quantity * storagePerQWeek * (waitDays / 7);
  const storedTransport = otherTransport;
  const storedLow = safe(sellableQuantity * lowPrice * (1 - commission) - storageCost - storedTransport);
  const storedHigh = safe(sellableQuantity * highPrice * (1 - commission) - storageCost - storedTransport);
  const storedMid = (storedLow + storedHigh) / 2;
  const storeFeasible = cashDeadline >= waitDays;
  const options = [
    { id:'local', name:'Sell at local mandi', subtitle:`${area} · today`, icon:'⌖', gross:localGross, net:localNet, detail:`Price ${fmt(localPrice)}/q · fees ${fmt(localFees)}`, score:localNet, accessible:true },
    { id:'nearby', name:'Take it to another mandi', subtitle:'Higher listed price · travel applies', icon:'⇢', gross:otherGross, net:otherNet, detail:`Travel ${fmt(otherTransport)} · fees ${fmt(otherFees)}`, score:otherNet, accessible:true },
    { id:'store', name:`Store for ${waitDays} days`, subtitle:'Scenario using your possible price range', icon:'◷', net:null, low:storedLow, high:storedHigh, mid:storedMid, detail:`Storage ${fmt(storageCost)} · later travel ${fmt(storedTransport)}`, score:storedMid, accessible:storeFeasible }
  ];
  const eligible = options.filter((option) => option.accessible);
  const best = eligible.reduce((winner, option) => !winner || option.score > winner.score ? option : winner, null);
  return { quantity, crop, area, waitDays, cashDeadline, spoilagePct, sellableQuantity, options, best, storeFeasible };
}

function optionMarkup(option, best, maxNet, model) {
  const isBest = option.id === best?.id;
  const classes = ['option-card', isBest ? 'is-best' : '', !option.accessible ? 'is-unavailable' : ''].filter(Boolean).join(' ');
  const width = option.id === 'store' ? (maxNet > 0 ? Math.min(100, option.mid / maxNet * 100) : 0) : (maxNet > 0 ? Math.min(100, option.net / maxNet * 100) : 0);
  const value = option.id === 'store' ? `${fmt(option.low)}–${fmt(option.high)}` : fmt(option.net);
  const metric = option.id === 'store' ? `estimated net range · ${model.waitDays} days` : 'estimated net · today';
  let caveat = '';
  if (!option.accessible) caveat = '<div class="option-caveat">Cash needed before this option pays. Kept visible, excluded from the comparison headline.</div>';
  if (option.id === 'store' && option.accessible) caveat = '<div class="option-caveat">Price range and spoilage are your assumptions, not a forecast. Net range shown after storage and travel.</div>';
  return `<article class="${classes}" aria-label="${option.name}, ${value}">
    <div class="option-top"><div class="option-name-row"><span class="option-icon" aria-hidden="true">${option.icon}</span><div><div class="option-name">${option.name}</div><div class="option-subtitle">${option.subtitle}</div></div></div><div class="option-value"><strong>${value}</strong><span>${metric}</span></div></div>
    <div class="option-bar" aria-hidden="true"><span style="width:${width}%"></span></div>
    <div class="option-details"><span>${option.detail}</span><strong>${option.id === 'store' ? `Sellable ~${model.sellableQuantity.toFixed(1)} q` : `Gross ${fmt(option.gross)}`}</strong></div>${caveat}</article>`;
}

function render() {
  const model = calculate();
  const best = model.best;
  const maxNet = Math.max(...model.options.filter((option) => option.accessible).map((option) => option.id === 'store' ? option.mid : option.net), 1);
  $('optionList').innerHTML = model.options.map((option) => optionMarkup(option, best, maxNet, model)).join('');
  if (!best) {
    $('bestTitle').textContent = 'Add your prices to compare';
    $('bestAmount').textContent = '₹—';
    $('bestExplain').textContent = 'Enter market prices and your costs to see estimated net proceeds.';
  } else {
    $('bestTitle').textContent = best.id === 'local' ? 'Local mandi looks strongest' : best.id === 'nearby' ? 'Other mandi looks strongest' : 'Storage scenario is higher at the midpoint';
    $('bestAmount').textContent = best.id === 'store' ? `${fmt(best.low)}–${fmt(best.high)}` : fmt(best.net);
    const label = best.id === 'store' ? 'the midpoint of your entered future-price range' : 'your entered market price and costs';
    $('bestExplain').textContent = `Highest estimate from ${label}. Confirm the actual offer, deductions and payment timing before acting.`;
  }
  $('bestTitle').classList.toggle('summary-range-title', best?.id === 'store');
  const priceBasis = importedPrices ? `CSV · ${importedPrices.latestDate}` : 'Example assumptions · not live';
  $('freshness').textContent = priceBasis;
  updateNextStep(model);
  $('agentGoal').textContent = `Goal: compare ${model.crop.toLowerCase()} take-home proceeds for ${model.quantity} q while meeting your cash deadline.`;
  renderDataBanner();
  return model;
}

function updateNextStep(model) {
  const { best, crop, quantity, area, options, waitDays, storeFeasible } = model;
  const nearby = options.find((option) => option.id === 'nearby');
  const local = options.find((option) => option.id === 'local');
  let heading = 'Check before you travel';
  let copy = 'A higher mandi price can be offset by transport, fees or quality deductions. Confirm the final net offer first.';
  if (best?.id === 'nearby') {
    const gap = roundRupees(nearby.net - local.net);
    heading = gap > 0 ? `Check if the ${area} trip is worthwhile` : 'Confirm the local take-home amount';
    copy = gap > 0
      ? `This example leaves about ${fmt(gap)} more at the other mandi after the entered costs. Ask about grade deductions, unloading, queue time and payment before arranging transport.`
      : 'After the entered travel cost, the other mandi does not improve the estimate. Verify both offers and deductions before deciding.';
  } else if (best?.id === 'store') {
    heading = storeFeasible ? 'Verify storage and cash timing' : 'Storage conflicts with your cash deadline';
    copy = storeFeasible
      ? 'Your entered storage scenario has a wide range. Confirm storage availability, charges, quality loss and when you can withdraw the produce.'
      : `You said you need money sooner than the ${waitDays}-day storage period. The storage scenario is shown for context but not treated as a practical option.`;
  } else if (best?.id === 'local') {
    heading = 'Confirm the final local offer';
    copy = 'Ask whether the quoted price is for your crop grade and whether weighing, loading, commission or payment delays will change the amount you receive.';
  }
  $('nextStepHeading').textContent = heading;
  $('nextStepCopy').textContent = copy;
  $('scriptText').textContent = `“I have ${quantity} quintals of ${crop.toLowerCase()}. What is your price for this grade today? Are there any deductions, loading charges or payment delays?”`;
}

function renderDataBanner() {
  const banner = $('dataBanner');
  const title = banner.querySelector('strong');
  const description = banner.querySelector('.data-copy');
  if (importedPrices) {
    title.textContent = importedPrices.kind === 'api' ? 'AGMARKNET daily price rows loaded' : 'CSV price rows imported';
    description.textContent = `${importedPrices.markets.join(' · ')} · latest row ${importedPrices.latestDate}. Verify market, variety and date; these are wholesale references, not firm offers.`;
    banner.classList.add('has-import');
    $('prototypePill').innerHTML = `<span class="pulse-dot"></span> Prototype · ${importedPrices.kind === 'api' ? 'Official rows' : 'CSV imported'}`;
  } else {
    title.textContent = 'Illustrative demo figures';
    description.textContent = 'Not live mandi rates. Replace with verified local prices and costs.';
    banner.classList.remove('has-import');
    $('prototypePill').innerHTML = '<span class="pulse-dot"></span> Prototype · Sample data';
  }
}

function markAgentSteps(mode = 'ready') {
  const steps = [...$('agentSteps').querySelectorAll('li')];
  for (const step of steps) step.classList.remove('is-complete','is-blocked');
  if (mode === 'ready') {
    steps.forEach((step, index) => { step.querySelector('b').textContent = index === 3 ? 'Approval' : 'Ready'; });
    return;
  }
  steps.forEach((step, index) => {
    const status = step.querySelector('b');
    if (index < 3) { step.classList.add('is-complete'); status.textContent = 'Done'; }
    else { status.textContent = 'Needs approval'; }
  });
  const model = calculate();
  if (!importedPrices) {
    steps[1].classList.add('is-blocked');
    steps[1].querySelector('b').textContent = 'Sample data';
  }
  if (model.cashDeadline < model.waitDays) {
    steps[2].classList.add('is-blocked');
    steps[2].querySelector('b').textContent = 'Wait excluded';
  }
}

function runAgentPlan() {
  const model = render();
  const button = $('compareButton');
  button.disabled = true;
  button.innerHTML = '<span>✦</span> Planning…';
  $('agentResponse').textContent = 'Checking the case, comparing costs and applying your cash deadline…';
  const caseData = {
    crop:$('crop').value, quantity:model.quantity, cashNeed:$('cashNeed').value, area:model.area,
    localPrice:number('localPrice'), otherPrice:number('otherPrice'), travelCost:number('travelCost'),
    commission:number('commission'), storageCost:number('storageCost'), futureLow:number('futureLow'),
    futureHigh:number('futureHigh'), waitDays:model.waitDays, spoilage:number('spoilage'),
    priceSource:importedPrices ? `${importedPrices.source} (${importedPrices.latestDate})` : 'Illustrative example or manually entered values'
  };
  const localFallback = () => {
    markAgentSteps('complete');
    $('agentResponse').textContent = 'Local scenario tools compared your entered values. For the model-backed agent and official price API, start the local server and configure keys. No external action was taken.';
  };
  fetch('/api/agent/plan', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ case:caseData }) })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Agent API unavailable');
      markAgentSteps('complete');
      $('agentResponse').textContent = `${payload.answer} (${payload.mode === 'gemini' ? `Model: ${payload.model}` : 'Transparent rules fallback'})`;
      if (Array.isArray(payload.trace)) {
        const steps = [...$('agentSteps').querySelectorAll('li')];
        payload.trace.slice(0,3).forEach((item, index) => {
          if (steps[index]) { steps[index].querySelector('b').textContent = item.status === 'complete' ? 'Done' : 'Review'; steps[index].title = `${item.tool}: ${item.summary}`; }
        });
      }
      $('decisionSummary').scrollIntoView({ behavior:'smooth', block:'center' });
      showToast(payload.mode === 'gemini' ? 'Model-backed decision plan is ready' : 'Rules decision plan is ready');
    })
    .catch(() => {
      localFallback();
      $('decisionSummary').scrollIntoView({ behavior:'smooth', block:'center' });
      showToast('Backend unavailable; the local comparison remains available');
    })
    .finally(() => { button.disabled = false; button.innerHTML = '<span>✦</span> Run Saathi'; });
  return model;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function resetExample() {
  for (const id of fields) $(id).value = defaults[id];
  importedPrices = null;
  $('importStatus').hidden = true;
  $('marketCsv').value = '';
  markAgentSteps('ready');
  render();
  showToast('Example values restored');
}

function saveCase() {
  const saved = Object.fromEntries(fields.map((id) => [id, $(id).value]));
  saved.savedAt = new Date().toISOString();
  saved.importedPrices = importedPrices ? { kind: importedPrices.kind, latestDate: importedPrices.latestDate, markets: importedPrices.markets, source: importedPrices.source } : null;
  try {
    localStorage.setItem(caseKey, JSON.stringify(saved));
    $('resumeCaseButton').hidden = false;
    showToast('Harvest case saved on this device');
  } catch {
    showToast('Could not save here; browser storage may be disabled');
  }
}

function resumeCase() {
  try {
    const saved = JSON.parse(localStorage.getItem(caseKey) || 'null');
    if (!saved) return showToast('No saved harvest case on this device');
    for (const id of fields) if (saved[id] !== undefined) $(id).value = saved[id];
    importedPrices = saved.importedPrices ? { ...saved.importedPrices, rows: [] } : null;
    if (importedPrices) {
      $('importStatus').hidden = false;
    $('importStatus').textContent = `Restored values from ${importedPrices.source || 'an imported file'} (${importedPrices.latestDate}). The source file is not stored; import it again to refresh.`;
    } else {
      $('importStatus').hidden = true;
    }
    render();
    showToast('Saved harvest case restored');
  } catch {
    showToast('Saved case could not be read');
  }
}

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
      else value += character;
    }
    values.push(value.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return lines.slice(1).map(parseLine).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function csvField(row, names) {
  const key = Object.keys(row).find((candidate) => names.some((name) => candidate === name || candidate.includes(name)));
  return key ? row[key] : '';
}

function parseDate(value) {
  const raw = String(value || '').trim();
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

async function importMarketCsv(file) {
  const records = csvRows(await file.text()).map((row) => {
    const modal = Number(String(csvField(row, ['modalprice','modal'])).replace(/[^0-9.]/g, ''));
    const commodity = csvField(row, ['commodity']).trim();
    const market = csvField(row, ['market']).trim();
    const dateText = csvField(row, ['arrivaldate','date']).trim();
    const date = parseDate(dateText);
    return { modal, commodity, market, dateText, date, district:csvField(row, ['district']).trim(), state:csvField(row, ['state']).trim(), variety:csvField(row, ['variety']).trim() };
  }).filter((record) => record.modal > 0 && record.market && record.commodity && record.date.getTime() > 0);
  if (!records.length) throw new Error('No rows with commodity, market, modal price and date were found.');
  const chosenCrop = $('crop').value.toLowerCase();
  const matches = records.filter((record) => record.commodity.toLowerCase().includes(chosenCrop));
  if (!matches.length) throw new Error(`No rows for ${cropName()} were found in this file.`);
  matches.sort((left, right) => right.date - left.date);
  const unique = [];
  const seen = new Set();
  for (const record of matches) {
    const marketKey = record.market.toLowerCase();
    if (!seen.has(marketKey)) { unique.push(record); seen.add(marketKey); }
    if (unique.length === 2) break;
  }
  $('localPrice').value = Math.round(unique[0].modal);
  if (unique[1]) $('otherPrice').value = Math.round(unique[1].modal);
  $('area').value = unique[0].district || unique[0].state || unique[0].market;
  importedPrices = {
    kind:'csv',
    latestDate: new Intl.DateTimeFormat('en-IN', { day:'2-digit', month:'short', year:'numeric' }).format(unique[0].date),
    markets:unique.map((record) => record.market),
    source:file.name,
    rows:unique
  };
  $('importStatus').hidden = false;
  $('importStatus').textContent = `${matches.length} matching ${cropName()} row(s) · selected the latest available row for ${unique.map((record) => record.market).join(' and ')}. Check variety and date before relying on it.`;
  render();
  markAgentSteps('ready');
  showToast('CSV prices loaded into this device');
}

async function fetchOfficialPrices() {
  const button = $('fetchLivePrices');
  button.disabled = true;
  button.textContent = 'Fetching…';
  try {
    const response = await fetch(`/api/prices?commodity=${encodeURIComponent($('crop').value)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Official price service unavailable.');
    const rows = (payload.records || []).filter((row) => row.modalPrice > 0 && row.market && row.date).sort((a,b) => parseDate(b.date) - parseDate(a.date));
    const selected = [];
    const seen = new Set();
    for (const row of rows) {
      const marketKey = row.market.toLowerCase();
      if (!seen.has(marketKey)) { selected.push(row); seen.add(marketKey); }
      if (selected.length === 2) break;
    }
    if (!selected.length) throw new Error('No matching market rows were returned. Import a CSV or enter prices manually.');
    $('localPrice').value = Math.round(selected[0].modalPrice);
    if (selected[1]) $('otherPrice').value = Math.round(selected[1].modalPrice);
    $('area').value = selected[0].district || selected[0].state || selected[0].market;
    const freshest = selected.reduce((latest,row) => parseDate(row.date) > parseDate(latest.date) ? row : latest, selected[0]);
    importedPrices = { kind:'api', latestDate:new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(parseDate(freshest.date)), markets:selected.map((row) => row.market), source:'data.gov.in · AGMARKNET', rows:selected };
    $('importStatus').hidden = false;
    $('importStatus').textContent = `${payload.count} official daily row(s) returned${payload.cached ? ' from the 15-minute cache' : ''}. The selected modal prices are wholesale references; verify variety and date.`;
    render();
    markAgentSteps('ready');
    showToast('Official daily price rows loaded');
  } catch (error) {
    $('importStatus').hidden = false;
    $('importStatus').textContent = `${error.message} Configure DATA_GOV_API_KEY in .env or use CSV/manual entry.`;
    showToast('Could not fetch official rows');
  } finally {
    button.disabled = false;
    button.textContent = 'Fetch official rows';
  }
}

function applyVoiceText() {
  const text = $('voiceText').value.trim();
  if (!text) return showToast('Speak or type a harvest detail first');
  const lower = text.toLowerCase();
  const cropTerms = [
    { value:'onion', terms:['onion','pyaaz','pyaz','eerulli','ಈರುಳ್ಳಿ','प्याज','प्याज़'] },
    { value:'tomato', terms:['tomato','tamatar','ಟೊಮೇಟೊ','टमाटर'] },
    { value:'maize', terms:['maize','corn','makkai','ಮೆಕ್ಕೆಜೋಳ','मक्का'] }
  ];
  const foundCrop = cropTerms.find((item) => item.terms.some((term) => lower.includes(term)));
  if (foundCrop) $('crop').value = foundCrop.value;
  const quantityMatch = lower.match(/(\d+(?:\.\d+)?)\s*(quintals?|qtl|q|kgs?|kilograms?)?/i);
  if (quantityMatch) {
    const value = Number(quantityMatch[1]);
    const unit = (quantityMatch[2] || '').toLowerCase();
    $('quantity').value = String(unit.startsWith('kg') || unit.startsWith('kilo') ? value / 100 : value);
  }
  render();
  markAgentSteps('ready');
  showToast(foundCrop || quantityMatch ? 'Harvest details filled; please review them' : 'I could not find crop or quantity; enter them above');
}

for (const id of fields) {
  $(id).addEventListener('input', () => { render(); markAgentSteps('ready'); });
  $(id).addEventListener('change', () => { render(); markAgentSteps('ready'); });
}
$('compareButton').addEventListener('click', runAgentPlan);
$('resetButton').addEventListener('click', resetExample);
$('saveCaseButton').addEventListener('click', saveCase);
$('resumeCaseButton').addEventListener('click', resumeCase);
$('useVoiceText').addEventListener('click', applyVoiceText);
$('marketCsv').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { await importMarketCsv(file); }
  catch (error) { $('importStatus').hidden = false; $('importStatus').textContent = error.message; showToast('Could not import those rows'); }
});
$('fetchLivePrices').addEventListener('click', fetchOfficialPrices);

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
$('listenButton').addEventListener('click', () => {
  if (!SpeechRecognition) {
    $('voiceStatus').textContent = 'Voice capture is not supported by this browser. Type your details instead.';
    return showToast('Voice capture is unavailable here; text input still works');
  }
  const recognition = new SpeechRecognition();
  recognition.lang = $('speechLanguage').value;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => { $('listenButton').classList.add('is-listening'); $('voiceStatus').textContent = 'Listening… browser speech support and connectivity may vary.'; };
  recognition.onresult = (event) => { $('voiceText').value = event.results[0][0].transcript; $('voiceStatus').textContent = 'Speech captured. Review it, then choose “Use details”.'; };
  recognition.onerror = () => { $('voiceStatus').textContent = 'Could not capture speech. Type your details instead.'; };
  recognition.onend = () => $('listenButton').classList.remove('is-listening');
  try { recognition.start(); }
  catch { $('voiceStatus').textContent = 'Microphone could not start. Check browser permission or type instead.'; }
});

$('copyScript').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('scriptText').textContent); showToast('Buyer question copied'); }
  catch { showToast('Select and copy the buyer question'); }
});

const aboutDialog = $('aboutDialog');
const approvalDialog = $('approvalDialog');
const openAbout = () => typeof aboutDialog.showModal === 'function' ? aboutDialog.showModal() : alert('All prefilled prices and costs are illustrative. This prototype does not fetch live prices or predict the future.');
$('helpButton').addEventListener('click', openAbout);
$('dataInfo').addEventListener('click', openAbout);
$('footerAbout').addEventListener('click', openAbout);
$('closeDialog').addEventListener('click', () => aboutDialog.close());
$('dialogDone').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => { if (event.target === aboutDialog) aboutDialog.close(); });
$('prepareRequests').addEventListener('click', () => {
  const model = calculate();
  $('approveDraft').checked = false;
  $('confirmDraft').disabled = true;
  $('requestPreview').textContent = `Draft: “I have ${model.quantity} quintals of ${model.crop.toLowerCase()}. What is your price for this grade today? Please confirm deductions, loading charges, availability and payment timing.”`;
  if (typeof approvalDialog.showModal === 'function') approvalDialog.showModal();
  else showToast('Review the displayed draft; this demo does not send it');
});
$('closeApproval').addEventListener('click', () => approvalDialog.close());
$('approveDraft').addEventListener('change', () => { $('confirmDraft').disabled = !$('approveDraft').checked; });
$('confirmDraft').addEventListener('click', () => {
  if (!$('approveDraft').checked) return;
  approvalDialog.close();
  const lastStep = $('agentSteps').querySelectorAll('li')[3];
  lastStep.classList.add('is-complete');
  lastStep.querySelector('b').textContent = 'Draft ready · not sent';
  showToast('Approved draft prepared on this device; nothing was sent');
});
approvalDialog.addEventListener('click', (event) => { if (event.target === approvalDialog) approvalDialog.close(); });

try { $('resumeCaseButton').hidden = !localStorage.getItem(caseKey); } catch { $('resumeCaseButton').hidden = true; }
render();
markAgentSteps('ready');
