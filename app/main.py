"""
Cartera Pro — Backend
FastAPI app que lee Google Sheets y expone la cartera procesada.
"""

import os
import json
import logging
from datetime import datetime, date
from typing import Optional
import calendar

import pandas as pd
import gspread
from google.oauth2.service_account import Credentials
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Cartera Pro", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Cache ─────────────────────────────────────────────────────────────────────
_cache: dict = {
    "data": [],
    "last_sync": None,
    "error": None,
    "row_count": 0,
}

# ── Config ────────────────────────────────────────────────────────────────────
SHEET_ID        = os.environ.get("GOOGLE_SHEET_ID", "")
WORKSHEET_NAME  = os.environ.get("WORKSHEET_NAME", "Cartera Total")
CREDENTIALS_JSON = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")  # JSON string
CREDENTIALS_FILE = os.environ.get("GOOGLE_CREDENTIALS_FILE", "credentials.json")

# Column mapping — ajusta si el nombre exacto en tu sheet cambia
COL_MAP = {
    "folio":                   "FOLIO DE DISPOSICIÓN",
    "cliente":                 "CLIENTE",
    "ejecutivo":               "EJECUTIVO DISPOSICIÓN",
    "sucursal":                "SUCURSAL",
    "contrato":                "NÚMERO DEL CONTRATO",
    "producto":                "PRODUCTO FINANCIERO DISPOSICIÓN",
    "status":                  "STATUS",
    "status_cobr":             "STATUS DE COBRANZA",
    "capital_vigente":         "SALDO CAPITAL VIGENTE",
    "capital_impago":          "SALDO CAPITAL IMPAGO",
    "capital_vencido_exigible":"SALDO CAPITAL VENCIDO EXIGIBLE",
    "capital_dispuesto":       "CAPITAL DISPUESTO",
    "tasa_base":               "TASA BASE ORDINARIO",
    "tasa_moratoria":          "TASA BASE MORATORIO",
    "fecha_entrega":           "FECHA DE ENTREGA",
    "fecha_vto":               "FECHA SIGUIENTE VENCIMIENTO",
    "fecha_contrato_inicio":   "FECHA INICIAL DEL CONTRATO",
    "fecha_contrato_fin":      "FECHA FINAL DEL CONTRATO",
    "interes_ordinario_vigente":"SALDO INTERES ORDINARIO VIGENTE",
    "interes_ordinario_impago": "SALDO INTERES ORDINARIO IMPAGO",
    "interes_moratorio":        "SALDO INTERES MORATORIO CALCULADO",
    "dias_impago":              "DÍAS DE IMPAGO",
    "tratamiento_interes":      "TRATAMIENTO INTERES",
    "corte_mensual":            "CORTE MENSUAL DE INTERES",
    "folio_linea":              "FOLIO LINEA DE CRÉDITO",
    "tipo_credito":             "TIPO DE CRÉDITO",
}

# ── Google Sheets ─────────────────────────────────────────────────────────────
def get_gc():
    scopes = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    if CREDENTIALS_JSON:
        cred_dict = json.loads(CREDENTIALS_JSON)
        creds = Credentials.from_service_account_info(cred_dict, scopes=scopes)
    elif os.path.exists(CREDENTIALS_FILE):
        creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=scopes)
    else:
        raise RuntimeError("No Google credentials found. Set GOOGLE_CREDENTIALS_JSON or place credentials.json")
    return gspread.authorize(creds)


def safe_float(val, default=0.0) -> float:
    if val is None or val == "" or val == "--":
        return default
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return default


def safe_date(val) -> Optional[str]:
    """Return ISO date string or None."""
    if val is None or val == "" or val == "--":
        return None
    if isinstance(val, (date, datetime)):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:10], fmt[:len(s[:10])]).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def process_df(df: pd.DataFrame) -> list[dict]:
    """Transform raw dataframe into clean disposicion records."""
    records = []

    # Filter: only VIGENTE, real clients
    if "STATUS" in df.columns:
        df = df[df["STATUS"].astype(str).str.upper() == "VIGENTE"]
    df = df[df["CLIENTE"].notna() & (df["CLIENTE"].astype(str).str.strip() != "") & (df["CLIENTE"].astype(str) != "--")]

    for _, row in df.iterrows():
        def g(col_key):
            col_name = COL_MAP.get(col_key, col_key)
            return row.get(col_name, None)

        fecha_entrega_str = safe_date(g("fecha_entrega"))
        fecha_vto_str = safe_date(g("fecha_vto"))
        tasa_raw = safe_float(g("tasa_base"))

        # Aniversary day from entrega date
        aniv_day = 1
        if fecha_entrega_str:
            try:
                aniv_day = datetime.strptime(fecha_entrega_str, "%Y-%m-%d").day
            except Exception:
                pass

        capital_vigente = safe_float(g("capital_vigente"))
        if capital_vigente <= 0 or tasa_raw <= 0:
            continue

        folio_raw = g("folio")
        try:
            folio = int(float(str(folio_raw))) if folio_raw else 0
        except Exception:
            folio = 0

        records.append({
            "folio":                    folio,
            "cliente":                  str(g("cliente") or "").strip(),
            "ejecutivo":                str(g("ejecutivo") or "").strip(),
            "sucursal":                 str(g("sucursal") or "").strip(),
            "contrato":                 str(g("contrato") or "").strip(),
            "producto":                 str(g("producto") or "").strip(),
            "status_cobr":              str(g("status_cobr") or "").strip(),
            "tipo_credito":             str(g("tipo_credito") or "").strip(),
            "capital_vigente":          round(capital_vigente, 2),
            "capital_impago":           round(safe_float(g("capital_impago")), 2),
            "capital_vencido_exigible": round(safe_float(g("capital_vencido_exigible")), 2),
            "capital_dispuesto":        round(safe_float(g("capital_dispuesto")), 2),
            "tasa":                     round(tasa_raw, 4),           # already in % (e.g. 23.7288)
            "tasa_moratoria":           str(g("tasa_moratoria") or "--").strip(),
            "fecha_entrega":            fecha_entrega_str,
            "fecha_vto":                fecha_vto_str,
            "fecha_contrato_inicio":    safe_date(g("fecha_contrato_inicio")),
            "fecha_contrato_fin":       safe_date(g("fecha_contrato_fin")),
            "interes_ordinario_vigente":round(safe_float(g("interes_ordinario_vigente")), 2),
            "interes_ordinario_impago": round(safe_float(g("interes_ordinario_impago")), 2),
            "interes_moratorio":        round(safe_float(g("interes_moratorio")), 2),
            "dias_impago":              int(safe_float(g("dias_impago"))),
            "aniv_day":                 aniv_day,
            "corte_mensual":            str(g("corte_mensual") or "ANIVERSARIO").strip(),
        })

    return records


def sync_from_sheets():
    """Pull data from Google Sheets and update cache."""
    global _cache
    try:
        log.info("Syncing from Google Sheets…")
        gc = get_gc()
        sh = gc.open_by_key(SHEET_ID)
        ws = sh.worksheet(WORKSHEET_NAME)
        raw = ws.get_all_records(numericise_ignore=["all"])
        df = pd.DataFrame(raw)
        records = process_df(df)
        _cache["data"] = records
        _cache["last_sync"] = datetime.utcnow().isoformat() + "Z"
        _cache["error"] = None
        _cache["row_count"] = len(records)
        log.info(f"Sync OK — {len(records)} disposiciones vigentes")
    except Exception as exc:
        log.error(f"Sync error: {exc}")
        _cache["error"] = str(exc)
        raise


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    if SHEET_ID:
        try:
            sync_from_sheets()
        except Exception as exc:
            log.warning(f"Initial sync failed (will retry on demand): {exc}")
    else:
        log.warning("GOOGLE_SHEET_ID not set — using empty cache. Set env var and call /api/sync")


# ── API Routes ────────────────────────────────────────────────────────────────
@app.get("/api/cartera")
def get_cartera():
    return JSONResponse({
        "data": _cache["data"],
        "last_sync": _cache["last_sync"],
        "count": _cache["row_count"],
    })


@app.get("/api/sync")
def trigger_sync(background_tasks: BackgroundTasks):
    if not SHEET_ID:
        raise HTTPException(400, "GOOGLE_SHEET_ID not configured")
    background_tasks.add_task(sync_from_sheets)
    return {"message": "Sync iniciado en background", "previous_sync": _cache["last_sync"]}


@app.get("/api/status")
def status():
    return {
        "last_sync": _cache["last_sync"],
        "count": _cache["row_count"],
        "error": _cache["error"],
        "sheet_id": SHEET_ID[:8] + "…" if SHEET_ID else "NOT SET",
        "worksheet": WORKSHEET_NAME,
    }


# ── Static files + SPA ────────────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def root():
    return FileResponse("static/index.html")


@app.get("/{path:path}")
def spa_fallback(path: str):
    return FileResponse("static/index.html")
