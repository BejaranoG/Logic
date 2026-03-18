/**
 * Cartera Pro — Frontend Application
 * Toda la lógica de cálculo vive aquí, sin dependencias externas.
 */

'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  data:        [],        // array de disposiciones del API
  filtered:    [],        // después de filtros/búsqueda
  current:     null,      // disposición seleccionada
  filterMode:  'all',     // 'all' | 'prev' | 'impago' | 'vencido'
  lastSync:    null,
  loading:     false,
};

// ── FORMAT HELPERS ────────────────────────────────────────────────────────────
const fmt2   = n => new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtMXN = n => '$' + fmt2(n);
const fmtPct = n => typeof n === 'number' ? n.toFixed(4) + '%' : '—';

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${d} ${months[parseInt(m)-1]} ${y}`;
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function diffDays(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86_400_000);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// ── CALCULATION ENGINE ────────────────────────────────────────────────────────

/**
 * Dado una disposición y una fecha objetivo, calcula el interés.
 *
 * El período inicia en el aniversario anterior a la fecha objetivo
 * (o desde fecha_entrega si es el primer período).
 *
 * Fórmula: Capital × (Tasa/100) / 365 × Días
 */
function calcInterest(disp, fromISO, toISO) {
  if (!fromISO || !toISO) return null;

  const dias = diffDays(fromISO, toISO);
  if (dias <= 0) return null;

  const tasaDecimal = disp.tasa / 100;
  const interes = disp.capital_vigente * tasaDecimal / 365 * dias;
  const diario  = disp.capital_vigente * tasaDecimal / 365;

  return {
    fromISO,
    toISO,
    dias,
    tasaDecimal,
    diario: Math.round(diario * 100) / 100,
    interes: Math.round(interes * 100) / 100,
  };
}

/**
 * Encuentra el aniversario anterior más cercano a una fecha objetivo.
 * El día aniversario es el día del mes de fecha_entrega.
 */
function prevAnivDate(disp, targetISO) {
  if (!disp.fecha_entrega) return targetISO;

  const anivDay = disp.aniv_day; // 1–31
  const target  = new Date(targetISO + 'T00:00:00');
  const ty = target.getFullYear();
  const tm = target.getMonth(); // 0-based

  // Try same month
  function clampedDate(year, month0, day) {
    const lastDay = new Date(year, month0 + 1, 0).getDate();
    return new Date(year, month0, Math.min(day, lastDay));
  }

  let candidate = clampedDate(ty, tm, anivDay);
  if (candidate >= target) {
    // Go back one month
    let pm = tm - 1, py = ty;
    if (pm < 0) { pm = 11; py--; }
    candidate = clampedDate(py, pm, anivDay);
  }

  // Don't go before fecha_entrega
  const entrega = new Date(disp.fecha_entrega + 'T00:00:00');
  if (candidate < entrega) candidate = entrega;

  return candidate.toISOString().split('T')[0];
}

/**
 * Encuentra el próximo aniversario a partir de hoy (o de una fecha dada).
 */
function nextAnivDate(disp, fromISO) {
  if (!disp.fecha_vto) return null;
  // Fecha_vto ya es el próximo aniversario
  const vto = new Date(disp.fecha_vto + 'T00:00:00');
  const from = new Date(fromISO + 'T00:00:00');
  if (vto > from) return disp.fecha_vto;

  // If vto is in the past, project forward month by month
  const anivDay = disp.aniv_day;
  let candidate = vto;
  let safety = 0;
  while (candidate <= from && safety < 36) {
    const ny = candidate.getMonth() === 11 ? candidate.getFullYear() + 1 : candidate.getFullYear();
    const nm = candidate.getMonth() === 11 ? 0 : candidate.getMonth() + 1;
    const lastDay = new Date(ny, nm + 1, 0).getDate();
    candidate = new Date(ny, nm, Math.min(anivDay, lastDay));
    safety++;
  }
  return candidate.toISOString().split('T')[0];
}

// ── API ───────────────────────────────────────────────────────────────────────
async function loadCartera() {
  setSyncState('loading', 'Cargando…');
  state.loading = true;

  try {
    const res  = await fetch('/api/cartera');
    const json = await res.json();

    state.data     = json.data || [];
    state.lastSync = json.last_sync;
    state.loading  = false;

    const syncTime = json.last_sync
      ? new Date(json.last_sync).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      : 'N/D';

    setSyncState('ok', `Sync ${syncTime} · ${state.data.length} disp.`);
    applyFilters();
  } catch (err) {
    state.loading = false;
    setSyncState('error', 'Error al cargar');
    document.getElementById('sidebar-list').innerHTML =
      `<div class="loading-state" style="color:var(--red)">Error al conectar con el servidor.<br><small>${err.message}</small></div>`;
  }
}

async function triggerSync() {
  const btn = document.getElementById('sync-btn');
  btn.classList.add('spinning');
  setSyncState('loading', 'Sincronizando…');
  try {
    await fetch('/api/sync');
    // Wait 2s for background task then reload
    setTimeout(() => { loadCartera(); btn.classList.remove('spinning'); }, 2500);
  } catch {
    btn.classList.remove('spinning');
    setSyncState('error', 'Error de sync');
  }
}

function setSyncState(state_str, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  dot.className = 'sync-dot ' + state_str;
  lbl.textContent = label;
}

// ── FILTERS & LIST ────────────────────────────────────────────────────────────
function setFilter(el) {
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  state.filterMode = el.dataset.f;
  applyFilters();
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').style.display = 'none';
  applyFilters();
}

function applyFilters() {
  const q    = document.getElementById('search-input').value.trim().toLowerCase();
  const sort = document.getElementById('sort-select').value;

  document.getElementById('search-clear').style.display = q ? '' : 'none';

  let items = state.data.filter(d => {
    // Status filter
    if (state.filterMode === 'prev'    && !d.status_cobr.toLowerCase().includes('preventiv')) return false;
    if (state.filterMode === 'impago'  && d.dias_impago === 0) return false;
    if (state.filterMode === 'vencido' && d.capital_vencido_exigible === 0) return false;

    // Search
    if (q) {
      const hay = `${d.cliente} ${d.folio} ${d.contrato} ${d.ejecutivo}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Sort
  switch (sort) {
    case 'cliente':    items.sort((a,b) => a.cliente.localeCompare(b.cliente)); break;
    case 'capital_desc': items.sort((a,b) => b.capital_vigente - a.capital_vigente); break;
    case 'vto_asc':    items.sort((a,b) => (a.fecha_vto||'9999') < (b.fecha_vto||'9999') ? -1 : 1); break;
    case 'folio_asc':  items.sort((a,b) => a.folio - b.folio); break;
  }

  state.filtered = items;
  renderList();
  updateFooter();
}

function updateFooter() {
  const totalCap = state.filtered.reduce((s, d) => s + d.capital_vigente, 0);
  document.getElementById('footer-count').textContent   = `${state.filtered.length} disposiciones`;
  document.getElementById('footer-capital').textContent = fmtMXN(totalCap / 1e6) + 'M capital';
}

function renderList() {
  const container = document.getElementById('sidebar-list');

  if (state.loading) {
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Cargando…</span></div>';
    return;
  }
  if (state.filtered.length === 0) {
    container.innerHTML = '<div class="loading-state" style="color:var(--text3)">Sin resultados</div>';
    return;
  }

  // Group by client
  const groups = {};
  state.filtered.forEach(d => {
    if (!groups[d.cliente]) groups[d.cliente] = [];
    groups[d.cliente].push(d);
  });

  let html = '';
  Object.keys(groups).sort().forEach(client => {
    const items = groups[client];
    html += `<div class="list-group">
      <div class="list-group-label">${client}</div>`;
    items.forEach(d => {
      const dotClass = d.capital_vencido_exigible > 0 ? 'danger'
                     : d.dias_impago > 0 ? 'warn' : 'ok';
      const active   = state.current && state.current.folio === d.folio ? ' active' : '';
      const capShort = d.capital_vigente >= 1e6
        ? fmtMXN(d.capital_vigente / 1e6) + 'M'
        : fmtMXN(d.capital_vigente / 1e3) + 'K';
      const vtoShort = d.fecha_vto ? fmtDateShort(d.fecha_vto) : '—';

      html += `<div class="list-item${active}" onclick="selectDisp(${d.folio})" data-folio="${d.folio}">
        <div class="li-status ${dotClass}"></div>
        <div class="li-content">
          <div class="li-folio">#${d.folio}</div>
          <div class="li-sub">${fmtPct(d.tasa)} · Vto: ${vtoShort}</div>
        </div>
        <div class="li-right">
          <div class="li-cap">${capShort}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  });

  container.innerHTML = html;

  // Scroll active into view
  if (state.current) {
    const el = container.querySelector(`[data-folio="${state.current.folio}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
}

// ── DETAIL VIEW ───────────────────────────────────────────────────────────────
function selectDisp(folio) {
  const disp = state.data.find(d => d.folio === folio);
  if (!disp) return;

  state.current = disp;

  // Update list active state
  document.querySelectorAll('.list-item').forEach(li => {
    li.classList.toggle('active', parseInt(li.dataset.folio) === folio);
  });

  document.getElementById('empty-state').style.display = 'none';
  const detail = document.getElementById('detail');
  detail.style.display = 'block';
  detail.classList.remove('fade-in');
  void detail.offsetWidth; // reflow
  detail.classList.add('fade-in');

  populateHero(disp);
  populateSaldos(disp);
  populateInfo(disp);
  setupProjection(disp);

  // Breadcrumb
  document.getElementById('breadcrumb').innerHTML = `
    <span class="bc-root" style="cursor:pointer;color:var(--text3)" onclick="goHome()">Disposiciones</span>
    <span class="bc-sep"> / </span>
    <span class="bc-current">#${disp.folio} · ${disp.cliente}</span>`;

  // Topbar tag
  const tags = document.getElementById('topbar-tags');
  if (disp.capital_vencido_exigible > 0) {
    tags.innerHTML = `<span class="tag-pill tag-vencido">Vencida</span>`;
  } else if (disp.dias_impago > 0) {
    tags.innerHTML = `<span class="tag-pill tag-preventivo">Impago · ${disp.dias_impago}d</span>`;
  } else {
    tags.innerHTML = `<span class="tag-pill tag-vigente">${disp.status_cobr || 'Vigente'}</span>`;
  }
}

function goHome() {
  state.current = null;
  document.getElementById('empty-state').style.display = '';
  document.getElementById('detail').style.display = 'none';
  document.getElementById('breadcrumb').innerHTML = `<span class="bc-root">Disposiciones</span>`;
  document.getElementById('topbar-tags').innerHTML = '';
  document.querySelectorAll('.list-item').forEach(li => li.classList.remove('active'));
}

function populateHero(d) {
  set('h-folio',    `Disposición #${d.folio}`);
  set('h-cliente',  d.cliente);
  set('h-contrato', d.contrato || '—');
  set('h-ejecutivo',d.ejecutivo || '—');
  set('h-sucursal', d.sucursal || '—');
  set('h-producto', d.producto || '—');
  set('hk-capital', fmtMXN(d.capital_vigente));
  set('hk-tasa',    fmtPct(d.tasa));
  set('hk-diario',  fmtMXN(d.capital_vigente * (d.tasa / 100) / 365));
  set('hk-vto',     fmtDate(d.fecha_vto));

  const today = todayISO();
  if (d.fecha_vto) {
    const diff = diffDays(today, d.fecha_vto);
    const sub  = diff >= 0 ? `en ${diff} días` : `hace ${-diff} días`;
    set('hk-vto-sub', sub);
  }
}

function populateSaldos(d) {
  set('is-dispuesto', fmtMXN(d.capital_dispuesto));
  set('is-vigente',   fmtMXN(d.capital_vigente));
  setValClass('is-impago',   d.capital_impago,           fmtMXN(d.capital_impago));
  setValClass('is-venc-ex',  d.capital_vencido_exigible, fmtMXN(d.capital_vencido_exigible), 'danger');
  set('is-int-vig',   fmtMXN(d.interes_ordinario_vigente));
  setValClass('is-int-imp',  d.interes_ordinario_impago, fmtMXN(d.interes_ordinario_impago));
  setValClass('is-moratorio',d.interes_moratorio,        fmtMXN(d.interes_moratorio));
  const diEl = document.getElementById('is-dias-imp');
  diEl.textContent = d.dias_impago + ' días';
  diEl.className   = 'is-val mono' + (d.dias_impago > 0 ? ' warn' : ' zero');
}

function populateInfo(d) {
  set('ig-entrega',   fmtDate(d.fecha_entrega));
  set('ig-prox-vto',  fmtDate(d.fecha_vto));
  set('ig-vto-cont',  fmtDate(d.fecha_contrato_fin));
  set('ig-tasa-mor',  d.tasa_moratoria !== '--' ? d.tasa_moratoria + '%' : '—');
  set('ig-aniv',      `Día ${d.aniv_day} de cada mes`);
  set('ig-tipo',      d.tipo_credito || '—');
  set('ig-status',    d.status_cobr || '—');
  set('ig-linea',     d.folio_linea ? `#${d.folio_linea}` : '—');
}

// ── PROJECTION ────────────────────────────────────────────────────────────────
function setupProjection(d) {
  const today = todayISO();

  // Default: from = prev aniversario before today, to = today
  const defFrom = prevAnivDate(d, today);
  const defTo   = today;

  document.getElementById('proj-from').value = defFrom;
  document.getElementById('proj-to').value   = defTo;

  // Set hint text
  set('hint-from', `Aniversario: día ${d.aniv_day}`);
  set('hint-to',   'Fecha a proyectar');

  // Set aniversario quick button label
  const nextAniv = nextAnivDate(d, today);
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

  const result = calcInterest(d, fromISO, toISO);

  if (!result || result.dias <= 0) {
    set('rs-interes',    '—');
    set('rs-capital-pago','—');
    set('rs-total',      '—');
    set('pb-dias',       '0 días');
    set('pb-period',     '—');
    return;
  }

  const { dias, diario, interes } = result;
  const capitalPago = 0; // No tenemos capital programado en tiempo real
  const total       = interes + capitalPago;

  // Period bar
  set('pb-period',  `${fmtDate(fromISO)} → ${fmtDate(toISO)}`);
  set('pb-dias',    `${dias} días`);
  set('pb-diario',  fmtMXN(diario) + ' / día');
  set('pb-formula', `${fmtMXN(d.capital_vigente)} × ${fmtPct(d.tasa)} ÷ 365 × ${dias}`);

  // Result strip
  set('rs-interes',     fmtMXN(interes));
  set('rs-capital-pago',capitalPago > 0 ? fmtMXN(capitalPago) : '$0.00');
  set('rs-cap-sub',     capitalPago > 0 ? 'capital programado' : 'sin capital programado');
  set('rs-total',       fmtMXN(total));

  // Calc steps
  set('cs-capital', fmtMXN(d.capital_vigente));
  set('cs-tasa',    fmtPct(d.tasa) + ' anual');
  set('cs-dias',    `${dias} días`);
  set('cs-result',  fmtMXN(interes));
}

// Quick buttons
function setQuick(days) {
  const today = todayISO();
  const target = addDays(today, days);
  document.getElementById('proj-to').value = target;

  // Adjust from to prev aniversario before target
  if (state.current) {
    const from = prevAnivDate(state.current, target);
    document.getElementById('proj-from').value = from;
  }
  calcProj();
}

function setAniv() {
  const btn = document.getElementById('qbtn-aniv');
  const anivDate = btn.dataset.aniv;
  if (!anivDate || !state.current) return;

  document.getElementById('proj-to').value   = anivDate;
  const from = prevAnivDate(state.current, anivDate);
  document.getElementById('proj-from').value = from;
  calcProj();
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setValClass(id, numVal, fmtVal, dangerClass = 'warn') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = fmtVal;
  el.className   = 'is-val mono' + (numVal > 0 ? ` ${dangerClass}` : ' zero');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
function init() {
  // Today label in topbar
  const today = new Date();
  document.getElementById('today-label').textContent =
    today.toLocaleDateString('es-MX', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });

  loadCartera();
}

document.addEventListener('DOMContentLoaded', init);
