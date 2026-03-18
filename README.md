# Cartera Pro — Proyección de Saldos

Sistema de proyección de intereses para cartera PYME-AGRO. Se alimenta de Google Sheets y calcula el interés ordinario a cualquier fecha seleccionada.

## Arquitectura

```
Google Sheets (CARTERA_TOTAL)
        ↓  (gspread, Service Account)
  FastAPI Backend  (/api/cartera, /api/sync)
        ↓
  Frontend HTML/CSS/JS  (cálculo client-side, instantáneo)
```

**Fórmula:** `Interés = Capital Vigente × (Tasa Base Ordinaria / 100) / 365 × Días del Período`

---

## Setup Local

### 1. Clonar e instalar

```bash
git clone <tu-repo>
cd cartera-pro
pip install -r requirements.txt
```

### 2. Publicar el Google Sheet

**No necesitas API keys ni credenciales.** Solo publicar el sheet:

1. Abre tu Google Sheet con la **CARTERA_TOTAL**
2. Ve a **Archivo → Compartir → Publicar en la web**
3. En el primer dropdown selecciona la hoja: **"Cartera Total"**
4. En el segundo dropdown selecciona: **"Valores separados por comas (.csv)"**
5. Haz clic en **"Publicar"** y confirma
6. Copia el **ID del sheet** desde la URL del navegador:
   `https://docs.google.com/spreadsheets/d/`**`ESTE_ES_EL_ID`**`/edit`

> **¿Es seguro?** El sheet queda de solo lectura para quien tenga el link. Nadie puede editarlo. Si en algún momento quieres bloquearlo, en la misma pantalla hay un botón "Dejar de publicar".

### 3. Variables de entorno

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

Edita `.env`:

```env
GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
WORKSHEET_NAME=Cartera Total
```

### 4. Correr localmente

```bash
uvicorn app.main:app --reload --port 8000
```

Abre `http://localhost:8000`

---

## Deploy en Railway

### 1. Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/tu-usuario/cartera-pro.git
git push -u origin main
```

### 2. Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app) y crea una cuenta
2. **New Project** → **Deploy from GitHub Repo**
3. Selecciona tu repositorio
4. Railway detectará automáticamente el `Dockerfile`

### 3. Configurar Variables de Entorno en Railway

En el panel de Railway → tu servicio → **Variables**:

| Variable | Valor |
|----------|-------|
| `GOOGLE_SHEET_ID` | ID de tu sheet (de la URL) |
| `WORKSHEET_NAME` | `Cartera Total` |

Solo esas dos. Sin credenciales, sin JSON, sin nada más.

### 4. Deploy

Railway hace el deploy automáticamente cuando haces push a `main`. En ~2 minutos tu app está en vivo.

---

## Estructura del Proyecto

```
cartera-pro/
├── app/
│   └── main.py          ← FastAPI: rutas, lectura Sheets, procesamiento
├── static/
│   ├── index.html       ← SPA completa
│   ├── css/
│   │   └── app.css      ← Estilos
│   └── js/
│       └── app.js       ← Lógica frontend + motor de cálculo
├── requirements.txt
├── Dockerfile
├── railway.toml
├── .env.example
└── .gitignore
```

---

## Columnas requeridas en Google Sheets

El sistema mapea automáticamente estas columnas de tu CARTERA_TOTAL. Los nombres deben coincidir exactamente:

| Columna en Sheet | Descripción |
|-----------------|-------------|
| `FOLIO DE DISPOSICIÓN` | ID único de la disposición |
| `CLIENTE` | Nombre del acreditado |
| `STATUS` | Solo procesa filas con valor `VIGENTE` |
| `SALDO CAPITAL VIGENTE` | Capital activo para el cálculo |
| `TASA BASE ORDINARIO` | Tasa anual en porcentaje (ej: 23.7288) |
| `FECHA DE ENTREGA` | Determina el día aniversario |
| `FECHA SIGUIENTE VENCIMIENTO` | Próximo corte de interés |
| `EJECUTIVO DISPOSICIÓN` | Nombre del ejecutivo |
| `SUCURSAL` | Sucursal asignada |
| `NÚMERO DEL CONTRATO` | Número de contrato |
| `PRODUCTO FINANCIERO DISPOSICIÓN` | Tipo de producto |
| `SALDO CAPITAL IMPAGO` | Capital en impago |
| `SALDO CAPITAL VENCIDO EXIGIBLE` | Capital vencido exigible |
| `CAPITAL DISPUESTO` | Capital original dispuesto |
| `TASA BASE MORATORIO` | Tasa moratoria |
| `FECHA INICIAL DEL CONTRATO` | Inicio del contrato |
| `FECHA FINAL DEL CONTRATO` | Fin del contrato |
| `SALDO INTERES ORDINARIO VIGENTE` | Interés vigente al corte |
| `SALDO INTERES ORDINARIO IMPAGO` | Interés impago |
| `SALDO INTERES MORATORIO CALCULADO` | Moratorio calculado |
| `DÍAS DE IMPAGO` | Días sin pago |
| `STATUS DE COBRANZA` | Etapa de cobranza |
| `TIPO DE CRÉDITO` | Tipo de crédito |

> Si algún nombre de columna difiere, edita el diccionario `COL_MAP` en `app/main.py`.

---

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/` | Sirve la aplicación web |
| `GET` | `/api/cartera` | Retorna todas las disposiciones vigentes procesadas |
| `GET` | `/api/sync` | Fuerza re-lectura del Google Sheet (background) |
| `GET` | `/api/status` | Estado del sistema (última sync, conteo, errores) |

---

## Actualización diaria de la cartera

El flujo recomendado:
1. Cada día exportas/actualizas tu Google Sheet con la cartera del día
2. Llamas a `GET /api/sync` (o presionas el botón en la app)
3. El sistema lee el sheet actualizado y recalcula

También puedes automatizar el sync con un cron job o un webhook desde tu proceso de actualización del sheet.

---

## Cálculo de Interés: Lógica de Períodos

El sistema usa el **método de aniversario**:

- El día del mes de la **Fecha de Entrega** es el "día aniversario"
- Al seleccionar una fecha objetivo, el sistema automáticamente detecta el aniversario anterior más cercano como fecha de inicio del período
- Los días del período = fecha objetivo − fecha inicio período
- La fórmula se aplica: `Capital × Tasa/100 / 365 × Días`

**Ejemplo:**
- Entrega: 25 de junio → día aniversario = 25
- Fecha proyección: 17 de marzo → período inicia el 25 de febrero
- Días: 17 mar − 25 feb = 20 días
- Interés: $214,160 × 21.0288% / 365 × 20 = $2,462.77

---

## Soporte y Configuración Avanzada

Para ajustar el comportamiento del sistema, los principales puntos de configuración son:

- `COL_MAP` en `app/main.py` — mapeo de columnas del Sheet
- `process_df()` en `app/main.py` — lógica de limpieza y transformación de datos
- `calcInterest()` en `static/js/app.js` — motor de cálculo
- `prevAnivDate()` en `static/js/app.js` — lógica de período aniversario
