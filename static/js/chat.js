'use strict';

const chatState = { open: false, messages: [], streaming: false };

function toggleChat() {
  chatState.open = !chatState.open;
  const panel = document.getElementById('chat-panel');
  const iconChat  = document.querySelector('.icon-chat');
  const iconClose = document.querySelector('.icon-close');
  panel.classList.toggle('open', chatState.open);
  if (iconChat)  iconChat.style.display  = chatState.open ? 'none' : '';
  if (iconClose) iconClose.style.display = chatState.open ? '' : 'none';
  if (chatState.open) {
    document.getElementById('chat-input').focus();
    updateChatCtx();
  }
}

function clearChat() {
  chatState.messages = [];
  const msgs = document.getElementById('chat-msgs');
  msgs.innerHTML = `
    <div class="chat-welcome" id="chat-welcome">
      <div class="cw-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg></div>
      <p class="cw-title">Nueva conversación</p>
      <p class="cw-sub">¿En qué puedo ayudarte?</p>
      <div class="chat-suggs">
        <button class="chat-sugg" onclick="sendSugg(this)">¿Cómo se calcula el interés ordinario?</button>
        <button class="chat-sugg" onclick="sendSugg(this)">¿Qué significa capital vencido exigible?</button>
        <button class="chat-sugg" onclick="sendSugg(this)">Explícame el saldo de esta disposición</button>
      </div>
    </div>`;
}

function updateChatCtx() {
  // delegates to app.js updateChatContext if available
  if (typeof updateChatContext === 'function') updateChatContext();
}

function buildSystem() {
  const today = new Date().toLocaleDateString('es-MX',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  let sys = `Eres el asistente financiero de LOGIC, plataforma de proyección de saldos para créditos PYME-AGRO en México.

Fecha actual: ${today}

FÓRMULA DE INTERÉS ORDINARIO (base 360 días):
  Interés = Capital Vigente × (Tasa Base Ordinaria / 100) / 360 × Días del Período

FÓRMULA DE INTERÉS MORATORIO:
  Interés Moratorio = (2 × Tasa Ordinaria) × (Capital Impago + Capital Vencido) / 360 × Días de Impago
  La tasa moratoria es 2 veces la tasa ordinaria por default (puede variar por contrato)

REGLAS:
- Tasa es anual en porcentaje (ej: 23.7288 = 23.7288%)
- Base de cálculo: 360 días (año comercial)
- La base de datos tiene una FECHA DE CORTE — los saldos e intereses son a esa fecha
- La proyección PARTE del corte: Int. Total = Int. al corte (de la base) + Int. nuevo (días adicionales × tasa diaria)
- Día hábil posterior: si la fecha cae en inhábil/fin de semana, se mueve al siguiente día hábil
- "Con impago" se determina por SALDO en impago (capital_impago > 0 o interes_ordinario_impago > 0), NO por días

GLOSARIO:
- Capital Vigente: saldo activo sobre el que se calcula el interés ordinario
- Capital Impago: capital que venció pero aún no es exigible
- Capital Vencido Exigible: ya exigible y no pagado (cartera vencida)
- Capital Vencido No Exigible: vencido pero aún no exigible por plazos legales
- Intereses Vencidos: ordinario + refinanciado vencido (exigible y no exigible)
- Interés Moratorio: penalización calculada como 2×tasa_ordinaria sobre capital impago/vencido
- Días de Impago: días desde el último pago

Responde en español, de forma concisa y profesional. Muestra fórmulas cuando hagas cálculos.`;

  if (typeof state !== 'undefined' && state.current) {
    const d = state.current;
    const corte = state.fechaCorte || new Date().toISOString().split('T')[0];
    const to   = document.getElementById('proj-to')?.value;
    let proj = '';
    if (to) {
      const dias    = Math.round((new Date(to) - new Date(corte)) / 86400000);
      const intCorte = d.interes_ordinario_vigente || 0;
      const intNuevo = d.capital_vigente * (d.tasa/100) / 360 * Math.max(0, dias);
      const totalInt = intCorte + intNuevo;
      proj = `\nPROYECCIÓN EN PANTALLA:
  Fecha corte base: ${corte}
  Int. ordinario al corte: $${intCorte.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Proyección al: ${to} = ${dias} días adicionales
  Int. nuevo proyectado: $${intNuevo.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Total ordinario: $${totalInt.toLocaleString('es-MX',{minimumFractionDigits:2})}`;
    }
    sys += `

═══════════════ DISPOSICIÓN ACTIVA ═══════════════
Folio: #${d.folio} | Cliente: ${d.cliente}
Contrato: ${d.contrato} | Ejecutivo: ${d.ejecutivo}
Status: ${d.status}
Tasa ordinaria: ${d.tasa}% | Tasa moratoria: ${d.tasa_moratoria}%
Día aniversario: ${d.aniv_day} | Día hábil: ${d.dia_habil}

CAPITAL:
  Vigente:  $${d.capital_vigente.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Impago:   $${d.capital_impago.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Vencido Exigible:  $${d.capital_vencido.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Vencido No Exigible:  $${(d.capital_vencido_no_exig||0).toLocaleString('es-MX',{minimumFractionDigits:2})}

INTERÉS:
  Ordinario vigente: $${d.interes_ordinario_vigente.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Ordinario impago:  $${d.interes_ordinario_impago.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Vencidos totales:  $${d.interes_vencidos.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Moratorio (al corte):  $${d.interes_moratorio.toLocaleString('es-MX',{minimumFractionDigits:2})}
  Días de impago: ${d.dias_impago}

FECHAS:
  Entrega: ${d.fecha_entrega} | Próx. vencimiento: ${d.fecha_vto}
  Interés diario ordinario: $${(d.capital_vigente * (d.tasa/100) / 360).toLocaleString('es-MX',{minimumFractionDigits:2})}${proj}`;
  }
  return sys;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || chatState.streaming) return;

  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.remove();

  appendMsg('user', text);
  chatState.messages.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = '';

  chatState.streaming = true;
  document.getElementById('chat-send').disabled = true;

  const typingId = showTyping();
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatState.messages, system: buildSystem() }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    removeTyping(typingId);
    const msgEl   = appendMsg('assistant', '');
    const bubble  = msgEl.querySelector('.chat-bubble');
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const delta = JSON.parse(data)?.delta?.text || '';
          if (delta) { full += delta; bubble.innerHTML = mdToHtml(full); scrollChat(); }
        } catch {}
      }
    }
    chatState.messages.push({ role: 'assistant', content: full });
  } catch(e) {
    removeTyping(typingId);
    appendMsg('assistant', `Error al conectar con el asistente: ${e.message}`);
  } finally {
    chatState.streaming = false;
    document.getElementById('chat-send').disabled = false;
    document.getElementById('chat-input').focus();
  }
}

function sendSugg(el) {
  document.getElementById('chat-input').value = el.textContent;
  sendMessage();
}

function chatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function chatResize(el) {
  el.style.height = '';
  el.style.height = Math.min(el.scrollHeight, 90) + 'px';
}

function appendMsg(role, content) {
  const c   = document.getElementById('chat-msgs');
  const now = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="chat-bubble">${role==='assistant' ? mdToHtml(content) : esc(content)}</div><div class="chat-msg-time">${now}</div>`;
  c.appendChild(div);
  scrollChat();
  return div;
}

function showTyping() {
  const id  = 'typing-' + Date.now();
  const c   = document.getElementById('chat-msgs');
  const div = document.createElement('div');
  div.id = id;
  div.className = 'chat-msg assistant chat-typing';
  div.innerHTML = `<div class="chat-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  c.appendChild(div); scrollChat();
  return id;
}

function removeTyping(id) { const el = document.getElementById(id); if (el) el.remove(); }
function scrollChat() { const m = document.getElementById('chat-msgs'); m.scrollTop = m.scrollHeight; }

function mdToHtml(t) {
  if (!t) return '';
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```[\w]*\n?([\s\S]*?)```/g,'<pre style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;margin:4px 0"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm,'<strong>$1</strong>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm,'<li>$2</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g,'<ul style="padding-left:14px;margin:3px 0">$1</ul>')
    .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')
    .replace(/^([^<].+)$/,'<p>$1</p>');
}

function esc(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }
