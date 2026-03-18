/**
 * LOGIC · Asistente IA
 * Chatbot potenciado por Claude con contexto de la disposición activa.
 * Llama al backend /api/chat que hace proxy a la API de Anthropic.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const chatState = {
  open: false,
  messages: [],      // { role: 'user'|'assistant', content: string }
  streaming: false,
};

// ── Toggle ────────────────────────────────────────────────────────────────────
function toggleChat() {
  chatState.open = !chatState.open;
  const panel = document.getElementById('chat-panel');
  const fab   = document.getElementById('chat-fab');
  const openIcon  = fab.querySelector('.chat-fab-icon');
  const closeIcon = fab.querySelector('.chat-close-icon');

  if (chatState.open) {
    panel.classList.add('open');
    openIcon.style.display  = 'none';
    closeIcon.style.display = '';
    document.getElementById('chat-input').focus();
    updateContextBar();
  } else {
    panel.classList.remove('open');
    openIcon.style.display  = '';
    closeIcon.style.display = 'none';
  }
}

function clearChat() {
  chatState.messages = [];
  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-logo">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
        </svg>
      </div>
      <p class="chat-welcome-title">Nueva conversación</p>
      <p class="chat-welcome-sub">¿En qué puedo ayudarte?</p>
      <div class="chat-suggestions">
        <button class="chat-suggestion" onclick="sendSuggestion(this)">¿Cómo se calcula el interés ordinario?</button>
        <button class="chat-suggestion" onclick="sendSuggestion(this)">¿Qué significa capital vencido exigible?</button>
        <button class="chat-suggestion" onclick="sendSuggestion(this)">Explícame el saldo de esta disposición</button>
      </div>
    </div>`;
}

function updateContextBar() {
  const bar   = document.getElementById('chat-context-bar');
  const label = document.getElementById('chat-context-label');
  const sub   = document.getElementById('chat-subtitle');

  if (state.current) {
    bar.style.display = '';
    label.textContent = `#${state.current.folio} · ${state.current.cliente}`;
    sub.textContent   = `Contexto cargado · Disposición #${state.current.folio}`;
  } else {
    bar.style.display = 'none';
    sub.textContent   = 'Potenciado por Claude · IA';
  }
}

// ── Build system prompt ───────────────────────────────────────────────────────
function buildSystemPrompt() {
  const today = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  let ctx = `Eres el asistente financiero de LOGIC, una plataforma de proyección de saldos para una financiera que otorga créditos PYME-AGRO en México.

Fecha actual: ${today}

FÓRMULA DE INTERÉS ORDINARIO (base 360 días):
  Interés = Capital Vigente × (Tasa Base Ordinaria / 100) / 360 × Días del Período

REGLAS DEL SISTEMA:
- La tasa base ordinaria es anual, expresada en porcentaje (ej: 23.7288 = 23.7288%)
- Los días del período se calculan entre el aniversario anterior y la fecha objetivo
- El día aniversario es el día del mes de la fecha de entrega del crédito
- Base de cálculo: 360 días (año comercial)
- Corte de interés: ANIVERSARIO (mismo día de cada mes)

GLOSARIO:
- Capital Vigente: saldo insoluto activo sobre el que se calcula el interés
- Capital Impago: capital que no fue pagado en la fecha de vencimiento pero aún no es exigible
- Capital Vencido Exigible: capital ya exigible y no pagado (cartera vencida)
- Interés Ordinario Vigente: interés devengado del período actual
- Interés Ordinario Impago: interés de períodos anteriores no pagado
- Interés Moratorio: penalización por impago, calculada sobre la tasa moratoria
- Días de Impago: días transcurridos desde el último pago
- Status Cobranza: etapa de gestión (Preventivo = al día pero próximo a vencer, Impago = ya venció)

COMPORTAMIENTO:
- Responde en español, de forma concisa y profesional
- Si el usuario pregunta por números de una disposición específica, usa los datos del contexto
- Cuando hagas cálculos, muestra la fórmula y el resultado
- Si el usuario pregunta algo que no es de tu dominio financiero, redirige amablemente
- No inventes datos que no estén en el contexto`;

  // Inject active disposition context
  if (state.current) {
    const d = state.current;
    const projFrom = document.getElementById('proj-from')?.value;
    const projTo   = document.getElementById('proj-to')?.value;

    let projInfo = '';
    if (projFrom && projTo) {
      const dias     = Math.round((new Date(projTo) - new Date(projFrom)) / 86400000);
      const interes  = d.capital_vigente * (d.tasa / 100) / 360 * dias;
      projInfo = `
PROYECCIÓN ACTIVA EN PANTALLA:
  - Fecha inicio período: ${projFrom}
  - Fecha proyección: ${projTo}
  - Días calculados: ${dias}
  - Interés proyectado: $${interes.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN`;
    }

    ctx += `

═══════════════════════════════
DISPOSICIÓN ACTIVA EN PANTALLA
═══════════════════════════════
Folio: #${d.folio}
Cliente: ${d.cliente}
Contrato: ${d.contrato || '—'}
Ejecutivo: ${d.ejecutivo || '—'}
Sucursal: ${d.sucursal || '—'}
Producto: ${d.producto || '—'}
Tipo de Crédito: ${d.tipo_credito || '—'}

TASAS:
  - Tasa Base Ordinaria: ${d.tasa}% anual
  - Tasa Moratoria: ${d.tasa_moratoria !== '--' ? d.tasa_moratoria + '%' : 'N/A'}
  - Interés diario (base 360): $${(d.capital_vigente * (d.tasa/100) / 360).toLocaleString('es-MX', {minimumFractionDigits:2})} MXN

SALDOS DE CAPITAL:
  - Capital dispuesto original: $${d.capital_dispuesto.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
  - Capital vigente (activo): $${d.capital_vigente.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
  - Capital impago: $${d.capital_impago.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
  - Capital vencido exigible: $${d.capital_vencido_exigible.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN

SALDOS DE INTERÉS:
  - Interés ordinario vigente: $${d.interes_ordinario_vigente.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
  - Interés ordinario impago: $${d.interes_ordinario_impago.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
  - Interés moratorio: $${d.interes_moratorio.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN

FECHAS:
  - Fecha de entrega: ${d.fecha_entrega || '—'}
  - Día aniversario: día ${d.aniv_day} de cada mes
  - Próximo vencimiento: ${d.fecha_vto || '—'}
  - Vencimiento del contrato: ${d.fecha_contrato_fin || '—'}

COBRANZA:
  - Status: ${d.status_cobr || '—'}
  - Días de impago: ${d.dias_impago}
${projInfo}`;
  } else {
    ctx += `

NOTA: El usuario no tiene ninguna disposición seleccionada actualmente. Puedes responder preguntas generales sobre cálculos financieros y cartera.`;
  }

  return ctx;
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || chatState.streaming) return;

  // Clear welcome screen on first message
  const welcome = document.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // Add user message to UI
  appendMessage('user', text);
  chatState.messages.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = '';

  // Disable send
  chatState.streaming = true;
  document.getElementById('chat-send').disabled = true;

  // Show typing indicator
  const typingId = showTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatState.messages,
        system: buildSystemPrompt(),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Stream the response
    removeTyping(typingId);
    const msgEl = appendMessage('assistant', '');
    const bubbleEl = msgEl.querySelector('.chat-bubble');

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const delta  = parsed.delta?.text || '';
            if (delta) {
              fullText += delta;
              bubbleEl.innerHTML = renderMarkdown(fullText);
              scrollChatToBottom();
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    }

    chatState.messages.push({ role: 'assistant', content: fullText });

  } catch (err) {
    removeTyping(typingId);
    appendMessage('assistant', `Lo siento, ocurrió un error al conectar con el asistente. Por favor intenta de nuevo.\n\n_Error: ${err.message}_`);
  } finally {
    chatState.streaming = false;
    document.getElementById('chat-send').disabled = false;
    document.getElementById('chat-input').focus();
  }
}

function sendSuggestion(el) {
  const input = document.getElementById('chat-input');
  input.value = el.textContent;
  sendMessage();
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = '';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function appendMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `
    <div class="chat-bubble">${role === 'assistant' ? renderMarkdown(content) : escapeHtml(content)}</div>
    <div class="chat-msg-time">${now}</div>`;

  container.appendChild(div);
  scrollChatToBottom();
  return div;
}

function showTyping() {
  const id = 'typing-' + Date.now();
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.id = id;
  div.className = 'chat-msg assistant chat-typing';
  div.innerHTML = `<div class="chat-bubble">
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  </div>`;
  container.appendChild(div);
  scrollChatToBottom();
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function scrollChatToBottom() {
  const msgs = document.getElementById('chat-messages');
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Minimal markdown renderer ─────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;margin:4px 0"><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Headers
    .replace(/^### (.+)$/gm, '<strong style="font-size:13px">$1</strong>')
    .replace(/^## (.+)$/gm,  '<strong style="font-size:13.5px">$1</strong>')
    .replace(/^# (.+)$/gm,   '<strong style="font-size:14px">$1</strong>')
    // Lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul style="padding-left:16px;margin:4px 0">$1</ul>')
    // Line breaks → paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)$/, '<p>$1</p>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// ── Re-update context when disposition changes ────────────────────────────────
// Hook into selectDisp from app.js
const _origSelectDisp = window.selectDisp;
// We patch this after app.js loads — see bottom of file
document.addEventListener('DOMContentLoaded', () => {
  // Patch selectDisp to also update chat context
  const originalSelect = window.selectDisp;
  if (originalSelect) {
    window.selectDisp = function(folio) {
      originalSelect(folio);
      if (chatState.open) updateContextBar();
    };
  }
});
