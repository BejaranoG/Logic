'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  data:    [],
  current: null,
  lastSync: null,
};

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtMXN = n => '$' + new Intl.NumberFormat('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const fmtMXNK = n => n >= 1e6 ? '$' + (n/1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n/1e3).toFixed(0) + 'K' : fmtMXN(n);
const fmtPct  = n => typeof n === 'number' ? n.toFixed(4) + '%' : '—';
const fmtDate = iso => {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  const mo = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${d} ${mo[+m-1]} ${y}`;
};
const fmtDateShort = iso => {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const todayISO = () => new Date().toISOString().split('T')[0];
const diffDays = (a,b) => Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);
const addDays  = (iso,n) => { const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; };

// ── Holiday / Día Hábil logic ─────────────────────────────────────────────────
// Basic Mexican holidays (fixed dates — extend as needed)
const MX_HOLIDAYS = new Set([
  '01-01','02-05','03-21','05-01','09-16','11-02','11-20','12-25'
]);

function isMxHoliday(iso) {
  const d = new Date(iso + 'T00:00:00');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return MX_HOLIDAYS.has(`${mm}-${dd}`);
}

function isWeekend(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.getDay() === 0 || d.getDay() === 6; // Sun=0, Sat=6
}

function isNonBusinessDay(iso) {
  return isWeekend(iso) || isMxHoliday(iso);
}

/**
 * Adjust a date to a business day based on DIA_HABIL setting.
 * 'CON DIA HABIL POSTERIOR' → move FORWARD to next business day
 * 'SIN DIA HABIL POSTERIOR' → keep the date as-is (no adjustment)
 */
function adjustToBusinessDay(iso, diaHabil) {
  if (!iso) return iso;
  if (!diaHabil || diaHabil === 'SIN DIA HABIL POSTERIOR') return iso;

  // CON DIA HABIL POSTERIOR: advance to next business day
  let d = iso;
  let safety = 0;
  while (isNonBusinessDay(d) && safety < 10) {
    d = addDays(d, 1);
    safety++;
  }
  return d;
}

// ── Period Calculation ────────────────────────────────────────────────────────
/**
 * Get the start of the current period (last amortization date).
 * If next vencimiento is the 15th of February → start = 15th of January.
 */
/**
 * Período inicio = FECHA SIGUIENTE VENCIMIENTO retrocedida 1 mes.
 * Ej: próxima amortización 15-Feb → período inicia 15-Ene.
 * Usa siempre fecha_vto (FECHA SIGUIENTE VENCIMIENTO) como base.
 */
function getPeriodStart(disp) {
  const vtoISO = disp.fecha_vto;
  if (!vtoISO) return disp.fecha_entrega || todayISO();

  const vto = new Date(vtoISO + 'T00:00:00');

  // Retroceder exactamente 1 mes, mismo día
  let pm = vto.getMonth() - 1;
  let py = vto.getFullYear();
  if (pm < 0) { pm = 11; py--; }
  const lastDayOfPrevMonth = new Date(py, pm + 1, 0).getDate();
  const day = Math.min(vto.getDate(), lastDayOfPrevMonth);
  const prev = `${py}-${String(pm+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  // No retroceder antes de fecha_entrega
  if (disp.fecha_entrega && prev < disp.fecha_entrega) return disp.fecha_entrega;
  return prev;
}

/**
 * Get next aniversario from today (or from a given date).
 */
function getNextAniv(disp, fromISO) {
  if (!disp.fecha_vto) return null;
  const from = fromISO || todayISO();
  if (disp.fecha_vto > from) return disp.fecha_vto;

  // Project forward
  let d = new Date(disp.fecha_vto + 'T00:00:00');
  for (let i = 0; i < 36; i++) {
    const nm = d.getMonth() === 11 ? 0 : d.getMonth() + 1;
    const ny = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
    const lastDay = new Date(ny, nm + 1, 0).getDate();
    d = new Date(ny, nm, Math.min(disp.aniv_day, lastDay));
    const iso = d.toISOString().split('T')[0];
    if (iso > from) return iso;
  }
  return null;
}

// ── Interest calculation ──────────────────────────────────────────────────────
function calcInterest(disp, fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const dias = diffDays(fromISO, toISO);
  if (dias <= 0) return null;
  const capitalBase = disp.capital_vigente;
  const diario  = capitalBase * (disp.tasa / 100) / 360;
  const interes = diario * dias;
  return { dias, diario: Math.round(diario*100)/100, interes: Math.round(interes*100)/100 };
}

/**
 * Calcula interés moratorio.
 * Fórmula: 2 × tasa_ordinaria × capital_vencido_impago / 360 × días
 * El capital sujeto a moratorio = capital_impago + capital_vencido + capital_vencido_no_exig
 */
function calcMoratorio(disp, dias) {
  const capitalMora = (disp.capital_impago || 0) + (disp.capital_vencido || 0) + (disp.capital_vencido_no_exig || 0);
  if (capitalMora <= 0 || dias <= 0) return null;
  // tasa_moratoria ya viene como número (2x la ordinaria por default)
  const tasaMora = disp.tasa_moratoria || (disp.tasa * 2);
  const diario = capitalMora * (tasaMora / 100) / 360;
  const interes = diario * dias;
  return {
    capitalMora: Math.round(capitalMora * 100) / 100,
    tasaMora: Math.round(tasaMora * 10000) / 10000,
    diario: Math.round(diario * 100) / 100,
    interes: Math.round(interes * 100) / 100,
    dias
  };
}

// ── API ───────────────────────────────────────────────────────────────────────
async function loadCartera() {
  setSyncState('loading', 'Sincronizando…');
  try {
    const res  = await fetch('/api/cartera');
    const json = await res.json();
    state.data     = json.data || [];
    state.lastSync = json.last_sync;
    const t = json.last_sync
      ? new Date(json.last_sync).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})
      : '—';
    setSyncState('ok', `Sync ${t}`);
    renderDashboard();
  } catch (e) {
    setSyncState('error', 'Error de conexión');
    console.error(e);
  }
}

async function triggerSync() {
  const btn = document.getElementById('sync-btn');
  btn.classList.add('spinning');
  setSyncState('loading', 'Sincronizando…');
  try {
    await fetch('/api/sync');
    setTimeout(() => { loadCartera(); btn.classList.remove('spinning'); }, 2500);
  } catch { btn.classList.remove('spinning'); setSyncState('error', 'Error'); }
}

function setSyncState(s, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  dot.className = 'sync-dot ' + s;
  lbl.textContent = label;
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('logic-theme', isDark ? 'light' : 'dark');
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const d = state.data;

  // Totals
  const capVig = d.reduce((s,r) => s + r.capital_vigente, 0);
  const capImp = d.reduce((s,r) => s + r.capital_impago, 0);
  const capVec = d.reduce((s,r) => s + r.capital_vencido, 0);
  const capVecNoExig = d.reduce((s,r) => s + (r.capital_vencido_no_exig || 0), 0);
  const intOrd = d.reduce((s,r) => s + r.interes_ordinario_vigente, 0);
  const intImp = d.reduce((s,r) => s + r.interes_ordinario_impago, 0);
  const intVec = d.reduce((s,r) => s + r.interes_vencidos, 0);
  const morat  = d.reduce((s,r) => s + r.interes_moratorio, 0);
  const neto   = capVig + capImp + capVec + capVecNoExig + intOrd + intImp + intVec + morat;

  set('kpi-neto',    fmtMXN(neto));
  set('kpi-neto-sub', `${d.length} disposiciones activas`);
  set('kpi-cap-vig', fmtMXN(capVig));
  set('kpi-cap-vig-sub', `${d.filter(r=>r.status==='VIGENTE').length} disposiciones vigentes`);
  set('kpi-cap-imp', fmtMXN(capImp));
  set('kpi-cap-imp-sub', `${d.filter(r=>r.capital_impago>0).length} disposiciones`);
  set('kpi-cap-vec', fmtMXN(capVec + capVecNoExig));
  set('kpi-cap-vec-sub', `${d.filter(r=>r.capital_vencido>0 || (r.capital_vencido_no_exig||0)>0).length} disposiciones`);
  set('kpi-int-ord', fmtMXN(intOrd));
  set('kpi-int-imp', fmtMXN(intImp));
  set('kpi-int-vec', fmtMXN(intVec));
  set('kpi-moratorio', fmtMXN(morat));

  // Stats
  set('stat-total',     d.length);
  set('stat-vigente',   d.filter(r=>r.status==='VIGENTE').length);
  set('stat-vencido',   d.filter(r=>r.status==='VENCIDO').length);
  set('stat-impago',    d.filter(r=>r.dias_impago>0).length);
  set('stat-clientes',  new Set(d.map(r=>r.cliente)).size);
  set('stat-ejecutivos',new Set(d.map(r=>r.ejecutivo).filter(Boolean)).size);

  // Date
  const today = new Date();
  set('dash-date', today.toLocaleDateString('es-MX',{weekday:'long',year:'numeric',month:'long',day:'numeric'}));
  set('dash-sub', `${state.lastSync ? 'Última sync: ' + new Date(state.lastSync).toLocaleString('es-MX') : 'Cargando…'}`);

  // Table — ALL dispositions sorted: VENCIDO first, then by capital desc
  const sorted = [...d].sort((a,b) => {
    // VENCIDO first
    if (a.status === 'VENCIDO' && b.status !== 'VENCIDO') return -1;
    if (a.status !== 'VENCIDO' && b.status === 'VENCIDO') return 1;
    // Then by total capital desc
    const aCap = a.capital_vigente + a.capital_impago + a.capital_vencido;
    const bCap = b.capital_vigente + b.capital_impago + b.capital_vencido;
    return bCap - aCap;
  });
  const tbody = document.getElementById('dash-table-body');
  tbody.innerHTML = sorted.map(r => {
    const dotClass = r.capital_vencido > 0 ? 'danger' : r.dias_impago > 0 ? 'warn' : 'ok';
    const capitalShow = r.capital_vigente > 0 ? r.capital_vigente : (r.capital_impago + r.capital_vencido);
    const statusLabel = r.status === 'VENCIDO' ? `<span style="color:var(--red);font-weight:600">VENCIDO</span>` : (r.status_cobr||r.status);
    return `<tr onclick="selectDisp(${r.folio})">
      <td class="mono">#${r.folio}</td>
      <td>${r.cliente}</td>
      <td style="color:var(--text3);font-size:11.5px">${r.ejecutivo||'—'}</td>
      <td class="num">${fmtMXN(capitalShow)}</td>
      <td class="num">${fmtPct(r.tasa)}</td>
      <td class="num">${fmtDateShort(r.fecha_vto)}</td>
      <td><span class="tbl-dot ${dotClass}"></span>${statusLabel}</td>
    </tr>`;
  }).join('');
}

function showDashboard() {
  state.current = null;
  document.getElementById('view-dashboard').style.display = '';
  document.getElementById('view-detail').style.display = 'none';
  updateChatContext();
}

// ── Search ────────────────────────────────────────────────────────────────────
function onSearch() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const dd = document.getElementById('search-dropdown');
  const cl = document.getElementById('search-clear');
  cl.style.display = q ? '' : 'none';

  if (!q || q.length < 1) { dd.classList.remove('open'); return; }

  const results = state.data.filter(r =>
    String(r.folio).includes(q) ||
    r.cliente.toLowerCase().includes(q) ||
    r.contrato.toLowerCase().includes(q)
  ).slice(0, 30);

  if (!results.length) {
    dd.innerHTML = `<div class="sd-empty">Sin resultados para "${q}"</div>`;
    dd.classList.add('open');
    return;
  }

  // Group by client
  const groups = {};
  results.forEach(r => {
    if (!groups[r.cliente]) groups[r.cliente] = [];
    groups[r.cliente].push(r);
  });

  let html = '';
  Object.entries(groups).forEach(([client, items]) => {
    if (Object.keys(groups).length > 1) html += `<div class="sd-group-label">${client}</div>`;
    items.forEach(r => {
      const dot = r.capital_vencido > 0 ? 'danger' : r.dias_impago > 0 ? 'warn' : 'ok';
      html += `<div class="sd-item" onclick="selectDisp(${r.folio}); closeSearch()">
        <div class="sd-dot ${dot}"></div>
        <div class="sd-main">
          <div class="sd-folio">#${r.folio}</div>
          <div class="sd-name">${r.cliente}</div>
        </div>
        <div class="sd-right">
          <div class="sd-cap">${fmtMXNK(r.capital_vigente)}</div>
          <div class="sd-tasa">${fmtPct(r.tasa)}</div>
        </div>
      </div>`;
    });
  });

  dd.innerHTML = html;
  dd.classList.add('open');
}

function onSearchKey(e) {
  if (e.key === 'Escape') closeSearch();
  if (e.key === 'Enter') {
    const first = document.querySelector('.sd-item');
    if (first) first.click();
  }
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  closeSearch();
}

function closeSearch() {
  document.getElementById('search-dropdown').classList.remove('open');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.topbar-search-wrap')) closeSearch();
});

// ── Detail view ───────────────────────────────────────────────────────────────
function selectDisp(folio) {
  const d = state.data.find(r => r.folio === folio);
  if (!d) return;
  state.current = d;
  closeSearch();

  document.getElementById('view-dashboard').style.display = 'none';
  const detail = document.getElementById('view-detail');
  detail.style.display = '';
  detail.classList.remove('fade-in');
  void detail.offsetWidth;
  detail.classList.add('fade-in');

  // Nav
  set('detail-nav-folio', `#${d.folio} · ${d.cliente}`);

  // Hero
  set('h-folio',    `Disposición #${d.folio}`);
  set('h-cliente',  d.cliente);
  set('h-contrato', d.contrato || '—');
  set('h-ejecutivo',d.ejecutivo || '—');
  set('h-sucursal', d.sucursal || '—');
  set('h-producto', d.producto || '—');

  const tagEl = document.getElementById('h-status-tag');
  if (d.capital_vencido > 0) {
    tagEl.innerHTML = `<span class="tag tag-vencido">Cartera Vencida</span>`;
  } else if (d.dias_impago > 0) {
    tagEl.innerHTML = `<span class="tag tag-preventivo">Impago · ${d.dias_impago}d</span>`;
  } else {
    tagEl.innerHTML = `<span class="tag tag-vigente">${d.status_cobr || 'Vigente'}</span>`;
  }

  // Hero KPIs — for VENCIDO, show the relevant capital
  const capitalPrincipal = d.capital_vigente > 0 ? d.capital_vigente : (d.capital_impago + d.capital_vencido + (d.capital_vencido_no_exig || 0));
  set('hk-capital', fmtMXN(capitalPrincipal));
  set('hk-tasa',    fmtPct(d.tasa));
  set('hk-diario',  fmtMXN(capitalPrincipal * (d.tasa/100) / 360));

  const today = todayISO();
  set('hk-vto', fmtDate(d.fecha_vto));
  if (d.fecha_vto) {
    const diff = diffDays(today, d.fecha_vto);
    set('hk-vto-sub', diff >= 0 ? `en ${diff} días` : `hace ${-diff} días`);
  }

  // Saldos
  set('s-dispuesto', fmtMXN(d.capital_dispuesto));
  set('s-vigente',   fmtMXN(d.capital_vigente));
  setValCls('s-impago',   d.capital_impago,  fmtMXN(d.capital_impago));
  setValCls('s-vencido',  d.capital_vencido, fmtMXN(d.capital_vencido), 'danger');
  setValCls('s-vencido-no-exig', (d.capital_vencido_no_exig||0), fmtMXN(d.capital_vencido_no_exig||0), 'danger');
  set('s-int-ord', fmtMXN(d.interes_ordinario_vigente));
  setValCls('s-int-imp', d.interes_ordinario_impago, fmtMXN(d.interes_ordinario_impago));
  setValCls('s-int-vec',  d.interes_vencidos,         fmtMXN(d.interes_vencidos), 'danger');
  setValCls('s-moratorio',d.interes_moratorio,         fmtMXN(d.interes_moratorio), 'danger');

  // Info
  set('ig-entrega',   fmtDate(d.fecha_entrega));
  set('ig-prox-vto',  fmtDate(d.fecha_vto));
  set('ig-vto-cont',  fmtDate(d.fecha_contrato_fin));
  set('ig-tasa-mor',  typeof d.tasa_moratoria === 'number' ? fmtPct(d.tasa_moratoria) : '—');
  set('ig-aniv',      `Día ${d.aniv_day} de cada mes`);
  set('ig-habil',     d.dia_habil || '—');
  set('ig-tipo',      d.tipo_credito || '—');
  set('ig-status',    d.status_cobr || '—');

  // Setup projection
  setupProj(d);
  updateChatContext();
  window.scrollTo({top: 0, behavior: 'smooth'});
}

// ── Projection ────────────────────────────────────────────────────────────────
function setupProj(d) {
  const today = todayISO();

  // ① Start: last amortization = one month before next vencimiento
  const periodStart = getPeriodStart(d);

  // ② End: today by default
  document.getElementById('proj-from').value = periodStart;
  document.getElementById('proj-to').value   = today;

  set('hint-from', `Última amortización: ${fmtDateShort(periodStart)}`);
  set('hint-to',   'Fecha a proyectar');

  // Aniversario button
  const nextAniv = getNextAniv(d, today);
  const anivBtn  = document.getElementById('qbtn-aniv');
  if (nextAniv) {
    anivBtn.textContent = `Aniv. ${fmtDateShort(nextAniv)}`;
    anivBtn.dataset.aniv = nextAniv;
  }

  calcProj();
}

function calcProj() {
  const d = state.current;
  if (!d) return;

  const fromISO = document.getElementById('proj-from').value;
  const toISO   = document.getElementById('proj-to').value;
  if (!fromISO || !toISO) return;

  // Apply día hábil adjustment to the target date
  const adjustedTo = adjustToBusinessDay(toISO, d.dia_habil);
  const wasAdjusted = adjustedTo !== toISO;

  const result = calcInterest(d, fromISO, adjustedTo);
  if (!result || result.dias <= 0) return;

  const { dias, diario, interes } = result;

  // ── Moratorio projection ──
  const mora = calcMoratorio(d, dias);
  const moraInteres = mora ? mora.interes : 0;
  const hasMora = mora && mora.capitalMora > 0;

  // ── HERO — projected interest (most visible) ──
  set('proj-hero-value', fmtMXN(interes));
  set('proj-hero-date',  fmtDate(adjustedTo));
  set('proj-hero-sub',   `${dias} días · ${fmtMXN(diario)}/día`);

  // Period bar
  set('pb-period',  `${fmtDate(fromISO)} → ${fmtDate(adjustedTo)}`);
  set('pb-dias',    `${dias} días`);
  set('pb-habil',   wasAdjusted
    ? `Ajustado al ${fmtDateShort(adjustedTo)} (día hábil)`
    : d.dia_habil === 'CON DIA HABIL POSTERIOR' ? 'Día hábil ✓' : 'Sin ajuste');
  set('pb-diario',  fmtMXN(diario) + '/día');
  set('pb-formula', `${fmtMXNK(d.capital_vigente)} × ${fmtPct(d.tasa)} ÷ 360 × ${dias}`);

  // Secondary results — include moratorio
  set('res-capital',  fmtMXN(d.capital_vigente));
  set('res-int-vec',  fmtMXN(d.interes_vencidos));
  set('res-cap-vec',  fmtMXN(d.capital_vencido));
  set('res-moratorio-proj', fmtMXN(moraInteres));
  set('res-int-imp-proj', fmtMXN(d.interes_ordinario_impago));
  const total = interes + moraInteres + d.interes_vencidos + d.interes_ordinario_impago + d.capital_vencido + d.capital_impago;
  set('res-total',    fmtMXN(total));

  // Show/hide moratorio section
  const moraSection = document.getElementById('mora-section');
  if (moraSection) moraSection.style.display = hasMora ? '' : 'none';
  if (hasMora && mora) {
    set('mora-capital', fmtMXN(mora.capitalMora));
    set('mora-tasa',    fmtPct(mora.tasaMora) + ' anual');
    set('mora-dias',    `${mora.dias} días`);
    set('mora-result',  fmtMXN(mora.interes));
    set('mora-formula', `${fmtMXNK(mora.capitalMora)} × ${fmtPct(mora.tasaMora)} ÷ 360 × ${mora.dias}`);
  }

  // Desglose ordinario
  set('cs-capital', fmtMXN(d.capital_vigente));
  set('cs-tasa',    fmtPct(d.tasa) + ' anual');
  set('cs-dias',    `${dias} días`);
  set('cs-result',  fmtMXN(interes));
}

function setQuick(days) {
  const target = addDays(todayISO(), days);
  document.getElementById('proj-to').value = target;
  if (state.current) {
    // Keep period start fixed to last amortization; only target date changes
    document.getElementById('proj-from').value = getPeriodStart(state.current);
  }
  calcProj();
}

function setAniv() {
  const anivDate = document.getElementById('qbtn-aniv').dataset.aniv;
  if (!anivDate || !state.current) return;
  document.getElementById('proj-to').value   = anivDate;
  document.getElementById('proj-from').value = getPeriodStart(state.current);
  calcProj();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setValCls(id, num, fmt, dangerClass = 'warn') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = fmt;
  el.className = 'sv mono' + (num > 0 ? ` ${dangerClass}` : ' zero');
}

function updateChatContext() {
  const ctx   = document.getElementById('chat-ctx');
  const label = document.getElementById('chat-ctx-label');
  const sub   = document.getElementById('chat-subtitle');
  if (state.current) {
    if (ctx) ctx.style.display = '';
    if (label) label.textContent = `#${state.current.folio} · ${state.current.cliente}`;
    if (sub)   sub.textContent   = `Contexto · #${state.current.folio}`;
  } else {
    if (ctx) ctx.style.display = 'none';
    if (sub) sub.textContent   = 'Potenciado por Claude';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  // Restore theme
  const saved = localStorage.getItem('logic-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  loadCartera();
}

document.addEventListener('DOMContentLoaded', init);
