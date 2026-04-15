#!/bin/bash
set -euo pipefail

# ============================================================
# FINKARGO QA AUDIT PIPELINE v2.0
# Mejoras: manejo de errores robusto, validaciones, reporte
# Confluence enriquecido con métricas, badges y RCA detallado.
# ============================================================

# ----------------------------------------------------------
# UTILIDADES: Logging con timestamp y colores
# ----------------------------------------------------------
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()     { echo -e "${CYAN}[$(date +'%H:%M:%S')]${RESET} $*"; }
log_ok()  { echo -e "${GREEN}[$(date +'%H:%M:%S')] ✅ $*${RESET}"; }
log_warn(){ echo -e "${YELLOW}[$(date +'%H:%M:%S')] ⚠️  $*${RESET}"; }
log_err() { echo -e "${RED}[$(date +'%H:%M:%S')] ❌ $*${RESET}"; }

# ----------------------------------------------------------
# 1. PARÁMETROS Y VALIDACIONES INICIALES
# ----------------------------------------------------------
PROYECTO="${1:-}"
FOLDER_INPUT="${2:-}"
PAIS_INPUT="${3:-}"
AMBIENTE="${4:-}"

# Validar parámetros obligatorios
ERRORS=0
[[ -z "$PROYECTO"     ]] && { log_err "Parámetro 1 (PROYECTO) es obligatorio.";    ERRORS=1; }
[[ -z "$FOLDER_INPUT" ]] && { log_err "Parámetro 2 (FOLDER) es obligatorio.";      ERRORS=1; }
[[ -z "$PAIS_INPUT"   ]] && { log_err "Parámetro 3 (PAIS: CO|MX|ALL) obligatorio.";ERRORS=1; }
[[ -z "$AMBIENTE"     ]] && { log_err "Parámetro 4 (AMBIENTE: Testing|Staging) obligatorio."; ERRORS=1; }
[[ $ERRORS -eq 1 ]] && { log_err "Uso: $0 <PROYECTO> <FOLDER> <CO|MX|ALL> <Testing|Staging>"; exit 1; }

# Validar valores permitidos
if [[ "$PAIS_INPUT" != "CO" && "$PAIS_INPUT" != "MX" && "$PAIS_INPUT" != "ALL" ]]; then
    log_err "PAIS_INPUT inválido: '$PAIS_INPUT'. Usar CO, MX o ALL."; exit 1
fi
if [[ "$AMBIENTE" != "Testing" && "$AMBIENTE" != "Staging" ]]; then
    log_err "AMBIENTE inválido: '$AMBIENTE'. Usar Testing o Staging."; exit 1
fi

# Validar credenciales requeridas
[[ -z "${POSTMAN_API_KEY:-}" ]]   && { log_err "POSTMAN_API_KEY no está definida.";   exit 1; }
[[ -z "${CONF_TOKEN:-}"      ]]   && { log_err "CONF_TOKEN no está definida.";        exit 1; }
[[ -z "${ANTHROPIC_API_KEY:-}" ]] && { log_warn "ANTHROPIC_API_KEY no definida. El análisis de IA será omitido."; }

# ----------------------------------------------------------
# 2. RUTAS Y CONFIGURACIÓN
# ----------------------------------------------------------
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"
DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/scenarios.json"

[[ ! -f "$CONFIG_PATH" ]] && { log_err "No se encontró: $CONFIG_PATH"; exit 1; }

EXEC_NUM="${GITHUB_RUN_NUMBER:-local-$(date +'%Y%m%d%H%M%S')}"
NOW=$(date +'%Y-%m-%d %H:%M:%S')
NOW_ISO=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
FOLDER_NAME="$FOLDER_INPUT"

JSON_REPORT="$SCRIPTS_DIR/results_final.json"
HTML_NEWMAN="$SCRIPTS_DIR/reporte_visual_newman.html"
LOG_FILE="$SCRIPTS_DIR/log_${PROYECTO}.txt"
ENV_EXPORT="$SCRIPTS_DIR/environment_export.json"

# Limpieza de archivos previos
rm -f "$JSON_REPORT" "$HTML_NEWMAN" "$LOG_FILE" "claude_report.html" "$ENV_EXPORT"

log "${BOLD}════════════════════════════════════════════${RESET}"
log "${BOLD} FINKARGO QA AUDIT v2.0${RESET}"
log " Proyecto : $PROYECTO"
log " Folder   : $FOLDER_NAME"
log " País     : $PAIS_INPUT"
log " Ambiente : $AMBIENTE"
log " Run #    : $EXEC_NUM"
log "${BOLD}════════════════════════════════════════════${RESET}"

# ----------------------------------------------------------
# 3. HELPERS PYTHON (config + métricas)
# ----------------------------------------------------------
get_config() {
    python3 - "$CONFIG_PATH" "$1" "$2" "$3" <<'PYEOF'
import json, sys

config_path, proyecto, pais, mode = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    with open(config_path, encoding='utf-8') as f:
        data = json.load(f)
    proj = data.get(proyecto)
    if not proj:
        print(f"ERROR: proyecto '{proyecto}' no encontrado en config.", file=sys.stderr)
        sys.exit(1)
    if mode == 'id':
        print(proj['collection_id'])
    elif mode == 'all_folders':
        print('\n'.join(proj['folders'].values()))
    else:
        folder_id = proj['folders'].get(pais, '')
        if not folder_id:
            print(f"ERROR: folder '{pais}' no encontrado para '{proyecto}'.", file=sys.stderr)
            sys.exit(1)
        print(folder_id)
except Exception as e:
    print(f"ERROR get_config: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

COLLECTION_UID=$(get_config "$PROYECTO" "$PAIS_INPUT" "id") || { log_err "Proyecto '$PROYECTO' no encontrado en collections.json"; exit 1; }
log_ok "Collection UID obtenido: ${COLLECTION_UID:0:20}..."

# ----------------------------------------------------------
# 4. MAPPING DE ENVIRONMENTS (CO / MX × Testing / Staging)
# ----------------------------------------------------------
case "${PAIS_INPUT}:${AMBIENTE}" in
    CO:Staging|*:Staging)   ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf" ;;
    CO:Testing)             ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933" ;;
    MX:Staging)             ENV_UID="19103266-8187ac0e-07bd-497d-a228-fefdeec90492" ;;
    MX:Testing)             ENV_UID="19456853-52efb174-794f-4837-a1bf-fc913c9b0f10" ;;
    ALL:*)                  ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933" ;;  # CO Testing como base para ALL
    *)                      log_err "Combinación PAIS/AMBIENTE no reconocida: $PAIS_INPUT/$AMBIENTE"; exit 1 ;;
esac
log "Environment UID : $ENV_UID"

# ----------------------------------------------------------
# 5. EJECUCIÓN NEWMAN
# ----------------------------------------------------------
DATA_PARAM=""
if [[ "$PROYECTO" == "ms-communicator" && -f "$DATA_FILE" ]]; then
    DATA_PARAM="-d $DATA_FILE"
    log "Data-driven: usando $DATA_FILE"
fi

NEWMAN_BASE_ARGS=(
    "https://api.getpostman.com/collections/${COLLECTION_UID}?apikey=${POSTMAN_API_KEY}"
    --environment "https://api.getpostman.com/environments/${ENV_UID}?apikey=${POSTMAN_API_KEY}"
    --insecure
    -r cli,json,htmlextra
    --reporter-json-export    "$JSON_REPORT"
    --reporter-htmlextra-export "$HTML_NEWMAN"
    --suppress-exit-code
    --timeout-request 30000
    --timeout-script  10000
)

[[ -n "$DATA_PARAM" ]] && NEWMAN_BASE_ARGS+=($DATA_PARAM)

NEWMAN_EXIT=0
if [[ "$PAIS_INPUT" == "ALL" ]]; then
    FOLDER_CO=$(get_config "$PROYECTO" "CO" "")
    FOLDER_MX=$(get_config "$PROYECTO" "MX" "")
    echo "🚀 Iniciando Newman (ALL): $FOLDER_CO + $FOLDER_MX"
    
    newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
      --environment "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
      --folder "$FOLDER_CO" \
      --folder "$FOLDER_MX" \
      $DATA_PARAM --insecure -r cli,json,htmlextra \
      --reporter-json-export "$JSON_REPORT" \
      --reporter-htmlextra-export "$HTML_NEWMAN" \
      --reporter-htmlextra-title "Audit Report - ALL - $NOW" \
      --export-environment "$ENV_EXPORT" \
      --suppress-exit-code | tee "$LOG_FILE"
else
    echo "🚀 Iniciando Newman para Folder: $FOLDER_NAME con Env UID: $ENV_UID"

    newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
      --environment "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
      --folder "$FOLDER_NAME" \
      $DATA_PARAM --insecure -r cli,json,htmlextra \
      --reporter-json-export "$JSON_REPORT" \
      --reporter-htmlextra-export "$HTML_NEWMAN" \
      --reporter-htmlextra-title "Audit Report - $FOLDER_NAME - $NOW" \
      --export-environment "$ENV_EXPORT" \
      --suppress-exit-code | tee "$LOG_FILE"
fi

# ==========================================
# 3.5 EJECUCIÓN PLAYWRIGHT (si hay payment_link)
# ==========================================
PAYMENT_LINK=$(python3 -c "
import json, sys
try:
    with open('$ENV_EXPORT') as f:
        env = json.load(f)
    values = env.get('values', [])
    match = next((v['value'] for v in values if v['key'] == 'payment_link' and v['value']), None)
    print(match or '')
except:
    print('')
" 2>/dev/null)

if [ -n "$PAYMENT_LINK" ]; then
    echo "🎭 payment_link detectado. Iniciando Playwright..."
    export PAYMENT_LINK="$PAYMENT_LINK"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    node "$SCRIPTS_DIR/playwright/payment_flow.js" "$PAYMENT_LINK" || echo "⚠️ Playwright terminó con errores (no bloquea el pipeline)"
else
    echo "ℹ️ No se encontró payment_link en el entorno exportado. Saltando Playwright."
fi

# ==========================================
# 4. ANÁLISIS AGÉNTICO CON CLAUDE
# ==========================================
echo "🤖 Analizando resultados con Claude 3.5 Sonnet..."
FAILED_DATA_FILE="$SCRIPTS_DIR/failed_data_debug.json"
METRICS_FILE="$FAILED_DATA_FILE"
CLAUDE_REPORT_FILE="claude_report.html"

python3 - "$JSON_REPORT" "$METRICS_FILE" << 'PYEOF'
import sys, json

report_path  = sys.argv[1]
metrics_path = sys.argv[2]
try:
    with open(report_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    run     = data.get('run', {})
    stats   = run.get('stats', {})
    timings = run.get('timings', {})
    failures = run.get('failures', [])

    total_requests  = stats.get('requests',   {}).get('total', 0)
    failed_requests = stats.get('requests',   {}).get('failed', 0)
    total_tests     = stats.get('assertions', {}).get('total', 0)
    failed_tests    = stats.get('assertions', {}).get('failed', 0)
    passed_tests    = total_tests - failed_tests
    duration_ms     = timings.get('completed', 0) - timings.get('started', 0)
    pass_rate       = round((passed_tests / total_tests * 100), 1) if total_tests > 0 else 0

    clean_failures = []
    for fail in failures:
        source   = fail.get('source', {})
        error    = fail.get('error', {})
        req      = source.get('request', {})
        url_obj  = req.get('url', {})
        url      = url_obj.get('raw', '') if isinstance(url_obj, dict) else str(url_obj)
        method   = req.get('method', 'N/A')
        clean_failures.append({
            "escenario": source.get('name', 'N/A'),
            "error":     error.get('message', 'N/A'),
            "test":      error.get('test', 'N/A'),
            "url":       url,
            "method":    method,
            "type":      "assertion" if error.get('name') == 'AssertionError' else "request"
        })

    metrics = {
        "total_requests":  total_requests,
        "failed_requests": failed_requests,
        "total_tests":     total_tests,
        "passed_tests":    passed_tests,
        "failed_tests":    failed_tests,
        "pass_rate":       pass_rate,
        "duration_ms":     duration_ms,
        "duration_s":      round(duration_ms / 1000, 2),
        "status":          "PASS" if failed_tests == 0 else "FAIL",
        "failures":        clean_failures
    }

    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    print(f"  Requests : {total_requests} total / {failed_requests} fallidos")
    print(f"  Tests    : {total_tests} total / {passed_tests} pasaron / {failed_tests} fallaron")
    print(f"  Pass Rate: {pass_rate}%")
    print(f"  Duración : {round(duration_ms/1000,2)}s")
    print(f"  Estado   : {'PASS ✅' if failed_tests == 0 else 'FAIL ❌'}")

except Exception as e:
    print(f"ERROR extrayendo métricas: {e}", file=sys.stderr)
    # Crear métricas vacías para no bloquear el pipeline
    with open(metrics_path, 'w') as f:
        json.dump({"status": "ERROR", "error": str(e), "failures": [], "pass_rate": 0,
                   "total_tests": 0, "passed_tests": 0, "failed_tests": 0,
                   "total_requests": 0, "failed_requests": 0, "duration_s": 0}, f)
PYEOF

log_ok "Métricas extraídas."

# ----------------------------------------------------------
# 7. ANÁLISIS DE CAUSA RAÍZ CON CLAUDE AI
# ----------------------------------------------------------
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    log_warn "Saltando análisis de IA (ANTHROPIC_API_KEY no definida)."
    echo "<p>⚠️ Análisis de IA omitido: ANTHROPIC_API_KEY no configurada.</p>" > "$CLAUDE_REPORT_FILE"
else
    log "🤖 Invocando Claude AI para análisis de causa raíz..."

    python3 - "$METRICS_FILE" "$CLAUDE_REPORT_FILE" "$PROYECTO" "$FOLDER_NAME" "$PAIS_INPUT" "$AMBIENTE" "$NOW" <<'PYEOF'
import json, subprocess, os, re, sys

metrics_path   = sys.argv[1]
output_path    = sys.argv[2]
proyecto       = sys.argv[3]
folder_name    = sys.argv[4]
pais           = sys.argv[5]
ambiente       = sys.argv[6]
timestamp      = sys.argv[7]
api_key        = os.environ.get("ANTHROPIC_API_KEY", "")

def call_claude(prompt: str, max_tokens: int = 4000) -> str:
    payload = {
        "model": "claude-3-5-sonnet-20241022",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }
    result = subprocess.run(
        ["curl", "-s", "--max-time", "60",
         "https://api.anthropic.com/v1/messages",
         "-H", f"x-api-key: {api_key}",
         "-H", "anthropic-version: 2023-06-01",
         "-H", "content-type: application/json",
         "-d", json.dumps(payload)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"curl error: {result.stderr}")
    resp = json.loads(result.stdout)
    if "error" in resp:
        raise RuntimeError(f"API error: {resp['error']['message']}")
    return resp["content"][0]["text"]

def clean_html(raw: str) -> str:
    return re.sub(r'```html\s*|```\s*', '', raw).strip()

try:
    with open(metrics_path, 'r') as f:
        metrics = json.load(f)

    failures  = metrics.get("failures", [])
    pass_rate = metrics.get("pass_rate", 0)
    status    = metrics.get("status", "UNKNOWN")

    # --- BLOQUE: Sin fallos ---
    if not failures:
        html = f"""
<div style="font-family: 'Segoe UI', sans-serif; padding: 20px;">
  <div style="background: linear-gradient(135deg,#e8f5e9,#c8e6c9); border-left: 5px solid #2e7d32;
              padding: 16px 20px; border-radius: 6px; margin-bottom: 16px;">
    <h2 style="margin:0 0 8px; color:#1b5e20; font-size:18px;">
      ✅ Auditoría Exitosa — Sin Fallos Detectados
    </h2>
    <p style="margin:0; color:#2e7d32; font-size:14px;">
      Todos los escenarios pasaron las validaciones de contrato y seguridad.<br/>
      <strong>Pass Rate:</strong> {pass_rate}% &nbsp;|&nbsp;
      <strong>Tests ejecutados:</strong> {metrics.get('total_tests', 0)} &nbsp;|&nbsp;
      <strong>Duración:</strong> {metrics.get('duration_s', 0)}s
    </p>
  </div>
</div>"""
    else:
        # --- BLOQUE: Con fallos — invocar Claude para RCA ---
        context = {
            "proyecto": proyecto,
            "folder": folder_name,
            "pais": pais,
            "ambiente": ambiente,
            "timestamp": timestamp,
            "pass_rate": pass_rate,
            "total_tests": metrics.get("total_tests"),
            "failed_tests": metrics.get("failed_tests"),
            "failures": failures
        }

        prompt = f"""Eres un Auditor Senior de QA especializado en APIs REST y microservicios financieros (Finkargo).

Contexto de ejecución:
- Proyecto: {proyecto}
- Folder/Módulo: {folder_name}
- País: {pais}
- Ambiente: {ambiente}
- Fecha: {timestamp}
- Pass Rate: {pass_rate}%
- Tests fallados: {metrics.get('failed_tests')} de {metrics.get('total_tests')}

Fallos detectados (JSON):
{json.dumps(failures, ensure_ascii=False, indent=2)}

Genera un reporte técnico de análisis de causa raíz en HTML.
REGLAS ESTRICTAS:
- Devuelve SOLO el contenido del div principal, sin DOCTYPE, sin <html>, sin <body>.
- Usa estilos CSS inline únicamente.
- Estructura requerida:
  1. Encabezado resumen con badge de severidad (CRÍTICO/ALTO/MEDIO) basado en el pass rate.
  2. Tabla de fallos con columnas: Escenario | Endpoint | Tipo de fallo | Causa Raíz | Impacto | Acción Recomendada.
  3. Sección "Patrones detectados" con insights grupales si hay fallos similares.
  4. Sección "Próximos pasos" con acciones priorizadas por impacto.
- Usa colores: rojo #c62828 para CRÍTICO, naranja #e65100 para ALTO, amarillo #f9a825 para MEDIO.
- Tablas con headers oscuros #1a237e (azul marino Finkargo).
- Fuente: 'Segoe UI', sans-serif.
- Sé técnico, específico y accionable. No uses frases genéricas.
"""
        raw_html = call_claude(prompt)
        html = clean_html(raw_html)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print("✅ Reporte Claude generado correctamente.")

except Exception as e:
    error_html = f"""<div style="background:#ffebee; border-left:4px solid #c62828;
                     padding:16px; border-radius:4px; font-family:sans-serif;">
  <strong style="color:#c62828;">⚠️ Error en análisis de IA:</strong>
  <pre style="margin:8px 0 0; font-size:12px; color:#555;">{str(e)}</pre>
</div>"""
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(error_html)
    print(f"ERROR en análisis Claude: {e}", file=sys.stderr)
PYEOF

    log_ok "Análisis Claude completado."
fi

# ----------------------------------------------------------
# 8. PUBLICACIÓN EN CONFLUENCE (REPORTE ENRIQUECIDO)
# ----------------------------------------------------------
if [[ -z "${CONF_BASE_URL:-}" || -z "${CONF_USER:-}" || -z "${CONF_TOKEN:-}" ]]; then
    log_warn "Saltando publicación en Confluence (CONF_BASE_URL, CONF_USER o CONF_TOKEN no definidos)."
else
log "📤 Publicando en Confluence..."

# Parent ID según ambiente
if [[ "$AMBIENTE" == "Staging" ]]; then
    AMBIENTE_PARENT_ID="2217115649"
else
    AMBIENTE_PARENT_ID="2216984577"
fi

FOLDER_TITLE="Auditorías $AMBIENTE - $PROYECTO"
TITLE="[$PROYECTO] [$PAIS_INPUT] $FOLDER_NAME — Run #$EXEC_NUM"

# Buscar o crear carpeta padre del proyecto en Confluence
SEARCH_URL="${CONF_BASE_URL}/rest/api/content?title=${FOLDER_TITLE// /%20}&spaceKey=${SPACE_KEY}&expand=version"
SEARCH_RES=$(curl -sf -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL") || {
    log_err "Fallo al conectar con Confluence API. Verifica CONF_USER y CONF_TOKEN."
    exit 1
}

PROJECT_FOLDER_ID=$(echo "$SEARCH_RES" | python3 -c \
    "import sys, json; d=json.load(sys.stdin); print(d['results'][0]['id'] if d.get('results') else '')" 2>/dev/null || echo "")

if [[ -z "$PROJECT_FOLDER_ID" ]]; then
    log "Creando carpeta padre en Confluence: '$FOLDER_TITLE'..."
    CREATE_FOLDER_PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
    'type': 'page',
    'title': sys.argv[1],
    'space': {'key': sys.argv[2]},
    'ancestors': [{'id': sys.argv[3]}],
    'body': {'storage': {
        'value': '<ac:structured-macro ac:name=\"children\"><ac:parameter ac:name=\"sort\">creation</ac:parameter></ac:structured-macro>',
        'representation': 'storage'
    }}
}))" "$FOLDER_TITLE" "$SPACE_KEY" "$AMBIENTE_PARENT_ID")

    PROJECT_FOLDER_ID=$(curl -sf -u "$CONF_USER:$CONF_TOKEN" \
        -X POST -H 'Content-Type: application/json' \
        -d "$CREATE_FOLDER_PAYLOAD" \
        "$CONF_BASE_URL/rest/api/content" | python3 -c \
        "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

    [[ -z "$PROJECT_FOLDER_ID" ]] && { log_err "No se pudo crear la carpeta padre en Confluence."; exit 1; }
    log_ok "Carpeta creada con ID: $PROJECT_FOLDER_ID"
else
    log "Carpeta padre encontrada: ID $PROJECT_FOLDER_ID"
fi

# ----------------------------------------------------------
# Construir el cuerpo HTML enriquecido para Confluence
# ----------------------------------------------------------
python3 - \
    "$METRICS_FILE" \
    "$CLAUDE_REPORT_FILE" \
    "$LOG_FILE" \
    "$PROYECTO" "$FOLDER_NAME" "$PAIS_INPUT" "$AMBIENTE" "$NOW" "$EXEC_NUM" \
    > "$SCRIPTS_DIR/confluence_body.html" <<'PYEOF'

import json, sys, html as htmllib

metrics_path  = sys.argv[1]
claude_path   = sys.argv[2]
log_path      = sys.argv[3]
proyecto      = sys.argv[4]
folder_name   = sys.argv[5]
pais          = sys.argv[6]
ambiente      = sys.argv[7]
timestamp     = sys.argv[8]
exec_num      = sys.argv[9]

# Cargar datos
try:
    with open(metrics_path, 'r') as f:
        m = json.load(f)
except:
    m = {"status":"ERROR","pass_rate":0,"total_requests":0,"failed_requests":0,
         "total_tests":0,"passed_tests":0,"failed_tests":0,"duration_s":0,"failures":[]}

try:
    with open(claude_path, 'r') as f:
        rca_html = f.read()
except:
    rca_html = "<p>Análisis de IA no disponible.</p>"

try:
    with open(log_path, 'r') as f:
        log_raw = f.read()
    log_clean = htmllib.escape(log_raw[:8000])  # Limitar a 8k chars para Confluence
    if len(log_raw) > 8000:
        log_clean += "\n... [log truncado — ver artefacto completo en GitHub Actions]"
except:
    log_clean = "Log no disponible."

# Badge de estado
status      = m.get("status", "UNKNOWN")
pass_rate   = m.get("pass_rate", 0)
if status == "PASS":
    badge_color, badge_text, badge_icon = "#2e7d32", "PASS", "✅"
elif pass_rate >= 80:
    badge_color, badge_text, badge_icon = "#e65100", "DEGRADADO", "⚠️"
else:
    badge_color, badge_text, badge_icon = "#c62828", "FAIL", "❌"

# Determinar ambiente badge
env_color = "#1565c0" if ambiente == "Testing" else "#6a1b9a"

body = f"""
<div style="font-family:'Segoe UI',Arial,sans-serif; max-width:900px; color:#212121;">

  <!-- ===== ENCABEZADO GENERAL ===== -->
  <table style="width:100%; border-collapse:collapse; margin-bottom:24px;
                background:linear-gradient(135deg,#0d47a1,#1565c0);
                border-radius:8px; overflow:hidden;">
    <tr>
      <td style="padding:20px 24px; color:#fff;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px;
                    opacity:0.75; margin-bottom:6px;">Finkargo · QA Audit Pipeline</div>
        <div style="font-size:22px; font-weight:700; margin-bottom:4px;">
          {proyecto} &rsaquo; {folder_name}
        </div>
        <div style="font-size:13px; opacity:0.85;">
          🕐 {timestamp} &nbsp;|&nbsp; Run #{exec_num} &nbsp;|&nbsp;
          <span style="background:rgba(255,255,255,0.2); padding:2px 10px;
                       border-radius:12px; font-size:12px;">{pais}</span>
          &nbsp;
          <span style="background:{env_color}; padding:2px 10px;
                       border-radius:12px; font-size:12px;">{ambiente}</span>
        </div>
      </td>
      <td style="padding:20px 24px; text-align:right; vertical-align:middle;">
        <div style="display:inline-block; background:{badge_color}; color:#fff;
                    padding:10px 22px; border-radius:6px; font-size:20px; font-weight:700;">
          {badge_icon} {badge_text}
        </div>
        <div style="color:rgba(255,255,255,0.85); font-size:28px; font-weight:800; margin-top:6px;">
          {pass_rate}%
        </div>
        <div style="color:rgba(255,255,255,0.6); font-size:11px;">Pass Rate</div>
      </td>
    </tr>
  </table>

  <!-- ===== TARJETAS DE MÉTRICAS ===== -->
  <table style="width:100%; border-collapse:separate; border-spacing:8px; margin-bottom:24px;">
    <tr>
      <td style="background:#e3f2fd; border-radius:8px; padding:16px 20px; text-align:center;
                 border-top:3px solid #1565c0; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#0d47a1;">{m.get('total_requests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Requests</div>
      </td>
      <td style="background:#e8f5e9; border-radius:8px; padding:16px 20px; text-align:center;
                 border-top:3px solid #2e7d32; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#1b5e20;">{m.get('passed_tests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Tests OK</div>
      </td>
      <td style="background:#{'#ffebee' if m.get('failed_tests',0)>0 else '#e8f5e9'};
                 border-radius:8px; padding:16px 20px; text-align:center;
                 border-top:3px solid {'#c62828' if m.get('failed_tests',0)>0 else '#2e7d32'}; width:20%;">
        <div style="font-size:28px; font-weight:800;
                    color:{'#c62828' if m.get('failed_tests',0)>0 else '#1b5e20'};">{m.get('failed_tests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Tests Fallados</div>
      </td>
      <td style="background:#fff3e0; border-radius:8px; padding:16px 20px; text-align:center;
                 border-top:3px solid #e65100; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#bf360c;">{m.get('total_tests',0)}</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Total Tests</div>
      </td>
      <td style="background:#f3e5f5; border-radius:8px; padding:16px 20px; text-align:center;
                 border-top:3px solid #6a1b9a; width:20%;">
        <div style="font-size:28px; font-weight:800; color:#4a148c;">{m.get('duration_s',0)}s</div>
        <div style="font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px;">Duración</div>
      </td>
    </tr>
  </table>

  <!-- ===== ANÁLISIS DE CAUSA RAÍZ (CLAUDE AI) ===== -->
  <div style="margin-bottom:24px;">
    <h2 style="font-size:16px; color:#0d47a1; border-bottom:2px solid #0d47a1;
               padding-bottom:8px; margin-bottom:16px;">
      🤖 Análisis de Causa Raíz — Claude AI
    </h2>
    {rca_html}
  </div>

  <!-- ===== LOG DE CONSOLA ===== -->
  <div style="margin-bottom:16px;">
    <h2 style="font-size:16px; color:#37474f; border-bottom:2px solid #b0bec5;
               padding-bottom:8px; margin-bottom:12px;">
      💻 Output de Consola (Newman)
    </h2>
    <ac:structured-macro ac:name="code">
      <ac:parameter ac:name="language">text</ac:parameter>
      <ac:parameter ac:name="collapse">true</ac:parameter>
      <ac:plain-text-body><![CDATA[{log_clean}]]></ac:plain-text-body>
    </ac:structured-macro>
  </div>

  <!-- ===== FOOTER ===== -->
  <div style="background:#eceff1; border-radius:6px; padding:12px 16px;
              font-size:11px; color:#90a4ae; text-align:center;">
    Generado automáticamente por Finkargo QA Audit Pipeline v2.0 · {timestamp}
  </div>

</div>
"""
print(body)
PYEOF

log_ok "HTML de Confluence construido."

# Publicar página en Confluence
CONFLUENCE_BODY=$(cat "$SCRIPTS_DIR/confluence_body.html")

FINAL_PAYLOAD=$(python3 -c "
import json, sys
body = open(sys.argv[4]).read()
print(json.dumps({
    'type': 'page',
    'title': sys.argv[1],
    'space': {'key': sys.argv[2]},
    'ancestors': [{'id': sys.argv[3]}],
    'body': {'storage': {'value': body, 'representation': 'storage'}}
}))" "$TITLE" "$SPACE_KEY" "$PROJECT_FOLDER_ID" "$SCRIPTS_DIR/confluence_body.html")

RESPONSE_PUB=$(curl -sf -u "$CONF_USER:$CONF_TOKEN" \
    -X POST -H 'Content-Type: application/json' \
    -d "$FINAL_PAYLOAD" \
    "$CONF_BASE_URL/rest/api/content" 2>&1) || {
    log_err "Error al publicar en Confluence: $RESPONSE_PUB"
    exit 1
}

NEW_PAGE_ID=$(echo "$RESPONSE_PUB" | python3 -c \
    "import sys, json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

if [[ -z "$NEW_PAGE_ID" ]]; then
    log_err "Confluence no devolvió un ID de página. Respuesta: $(echo $RESPONSE_PUB | head -c 300)"
    exit 1
fi
log_ok "Página publicada en Confluence. ID: $NEW_PAGE_ID"

# ----------------------------------------------------------
# 9. ADJUNTAR REPORTE HTMLEXTRA
# ----------------------------------------------------------
if [[ -f "$HTML_NEWMAN" ]]; then
    log "📎 Adjuntando reporte Newman htmlextra..."
    ATTACH_RES=$(curl -sf -u "$CONF_USER:$CONF_TOKEN" \
        -X POST -H "X-Atlassian-Token: nocheck" \
        -F "file=@${HTML_NEWMAN};type=text/html" \
        "$CONF_BASE_URL/rest/api/content/$NEW_PAGE_ID/attachments" 2>&1) || {
        log_warn "No se pudo adjuntar el reporte htmlextra: $ATTACH_RES"
    }
    log_ok "Reporte htmlextra adjuntado."
else
    log_warn "Reporte htmlextra no encontrado. No se adjuntó nada."
fi

# Adjuntar JSON de métricas para trazabilidad
if [[ -f "$METRICS_FILE" ]]; then
    curl -sf -u "$CONF_USER:$CONF_TOKEN" \
        -X POST -H "X-Atlassian-Token: nocheck" \
        -F "file=@${METRICS_FILE};type=application/json" \
        "$CONF_BASE_URL/rest/api/content/$NEW_PAGE_ID/attachments" > /dev/null 2>&1 \
        && log_ok "JSON de métricas adjuntado." \
        || log_warn "No se pudo adjuntar metrics_summary.json."
fi

fi # fin bloque Confluence

# ----------------------------------------------------------
# 10. RESUMEN FINAL
# ----------------------------------------------------------
FINAL_STATUS=$(python3 -c \
    "import json; m=json.load(open('$METRICS_FILE')); print(m.get('status','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")

echo ""
log "${BOLD}════════════════════════════════════════════${RESET}"
log_ok "PIPELINE COMPLETADO"
log "  Estado final   : $FINAL_STATUS"
if [[ -n "${CONF_BASE_URL:-}" && -n "${NEW_PAGE_ID:-}" ]]; then
    log "  Confluence     : ${CONF_BASE_URL}/spaces/${SPACE_KEY}/pages/${NEW_PAGE_ID}"
fi
log "  Reporte HTML   : $HTML_NEWMAN"
log "  Log completo   : $LOG_FILE"
log "${BOLD}════════════════════════════════════════════${RESET}"

# Exit code según resultado de Newman (para que GitHub Actions lo marque correctamente)
FINAL_FAILURES=$(python3 -c \
    "import json; m=json.load(open('$METRICS_FILE')); print(m.get('failed_tests',0))" 2>/dev/null || echo "0")

if [[ "$FINAL_FAILURES" -gt 0 ]]; then
    log_warn "Pipeline terminado con $FINAL_FAILURES test(s) fallados. Revisa el análisis en Confluence."
    exit 2   # Exit 2 = fallos de tests (distingue de errores de infraestructura)
fi

log_ok "Todos los tests pasaron. ¡Excelente ejecución!"
exit 0