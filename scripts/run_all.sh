#!/bin/bash
set -euo pipefail

# ============================================================
# FINKARGO QA AUDIT PIPELINE v2.1
# Sin heredocs Python — toda la lógica en scripts/helpers/*.py
# ============================================================

# ----------------------------------------------------------
# UTILIDADES: Logging con timestamp
# ----------------------------------------------------------
log()     { echo "[$(date +'%H:%M:%S')] $*"; }
log_ok()  { echo "[$(date +'%H:%M:%S')] OK  $*"; }
log_warn(){ echo "[$(date +'%H:%M:%S')] WARN $*"; }
log_err() { echo "[$(date +'%H:%M:%S')] ERR  $*"; }

# ----------------------------------------------------------
# 1. PARÁMETROS Y VALIDACIONES
# ----------------------------------------------------------
PROYECTO="${1:-}"
FOLDER_INPUT="${2:-}"
PAIS_INPUT="${3:-}"
AMBIENTE="${4:-}"

ERRORS=0
[[ -z "$PROYECTO"     ]] && { log_err "Param 1 (PROYECTO) obligatorio.";           ERRORS=1; }
[[ -z "$FOLDER_INPUT" ]] && { log_err "Param 2 (FOLDER) obligatorio.";             ERRORS=1; }
[[ -z "$PAIS_INPUT"   ]] && { log_err "Param 3 (PAIS: CO|MX|ALL) obligatorio.";    ERRORS=1; }
[[ -z "$AMBIENTE"     ]] && { log_err "Param 4 (Testing|Staging) obligatorio.";    ERRORS=1; }
[[ $ERRORS -eq 1 ]] && { log_err "Uso: $0 <PROYECTO> <FOLDER> <CO|MX|ALL> <Testing|Staging>"; exit 1; }

if [[ "$PAIS_INPUT" != "CO" && "$PAIS_INPUT" != "MX" && "$PAIS_INPUT" != "ALL" ]]; then
    log_err "PAIS_INPUT invalido: '$PAIS_INPUT'. Usar CO, MX o ALL."; exit 1
fi
if [[ "$AMBIENTE" != "Testing" && "$AMBIENTE" != "Staging" ]]; then
    log_err "AMBIENTE invalido: '$AMBIENTE'. Usar Testing o Staging."; exit 1
fi

# Validar credenciales
[[ -z "${POSTMAN_API_KEY:-}" ]] && { log_err "POSTMAN_API_KEY no definida en Secrets."; exit 1; }
[[ -z "${CONF_TOKEN:-}"      ]] && { log_err "CONF_TOKEN no definida en Secrets.";      exit 1; }
[[ -z "${ANTHROPIC_API_KEY:-}" ]] && log_warn "ANTHROPIC_API_KEY no definida. Analisis IA omitido."

# Debug de credenciales (primeros 8 chars enmascarado)
log "POSTMAN_API_KEY : ${POSTMAN_API_KEY:0:8}... (${#POSTMAN_API_KEY} chars)"
log "CONF_TOKEN      : ${CONF_TOKEN:0:8}... (${#CONF_TOKEN} chars)"

# ----------------------------------------------------------
# 2. RUTAS Y CONFIGURACION
# ----------------------------------------------------------
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPERS_DIR="$SCRIPTS_DIR/helpers"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"
DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/scenarios.json"
FIXTURES_DIR="$(dirname "$SCRIPTS_DIR")/test/fixtures"

[[ ! -f "$CONFIG_PATH"             ]] && { log_err "No se encontro: $CONFIG_PATH";              exit 1; }
[[ ! -f "$HELPERS_DIR/get_config.py"      ]] && { log_err "No se encontro: $HELPERS_DIR/get_config.py";      exit 1; }
[[ ! -f "$HELPERS_DIR/extract_metrics.py" ]] && { log_err "No se encontro: $HELPERS_DIR/extract_metrics.py"; exit 1; }
[[ ! -f "$HELPERS_DIR/claude_analysis.py" ]] && { log_err "No se encontro: $HELPERS_DIR/claude_analysis.py"; exit 1; }
[[ ! -f "$HELPERS_DIR/build_confluence.py" ]] && { log_err "No se encontro: $HELPERS_DIR/build_confluence.py"; exit 1; }

EXEC_NUM="${GITHUB_RUN_NUMBER:-local-$(date +'%Y%m%d%H%M%S')}"
NOW="$(date +'%Y-%m-%d %H:%M:%S')"

# Soporte para opciones con formato "PROVEEDOR / SUBCARPETA"
# FOLDER_NAME se usa para display/Confluence; NEWMAN_FOLDER es el nombre real del folder en Postman
FOLDER_INPUT_CLEAN=$(echo "$FOLDER_INPUT" | sed 's/^[- ]*//')
if [[ "$FOLDER_INPUT_CLEAN" == *" / "* ]]; then
    PROVIDER_PREFIX=$(echo "$FOLDER_INPUT_CLEAN" | sed 's/ \/ .*//')
    NEWMAN_FOLDER=$(echo "$FOLDER_INPUT_CLEAN" | sed 's/.* \/ //')
    FOLDER_NAME="$FOLDER_INPUT_CLEAN"
else
    PROVIDER_PREFIX=""
    NEWMAN_FOLDER="$FOLDER_INPUT_CLEAN"
    FOLDER_NAME="$FOLDER_INPUT_CLEAN"
fi

# Detectar escenario según sub-carpeta (NEWMAN_FOLDER es el nombre hoja)
SCENARIO="happy_path"
if [[ "$NEWMAN_FOLDER" == "Rejected flow" ]]; then
    SCENARIO="rejected"
    log "Escenario: REJECTED — se abrirá el link sin completar el formulario"
elif [[ "$NEWMAN_FOLDER" == "Expired flow" ]]; then
    SCENARIO="expired"
    log "Escenario: EXPIRED — se actualizará updated_at a created_at + 34 minutos en BD"
elif [[ "$NEWMAN_FOLDER" == "Happy path epayments" ]]; then
    SCENARIO="epayments_happy"
    log "Escenario: EPAYMENTS HAPPY PATH — validará epayment.transaction status SUCCESSFUL"
elif [[ "$NEWMAN_FOLDER" == "Happy path wallet epayments" ]]; then
    SCENARIO="wallet_epayments_happy"
    log "Escenario: WALLET EPAYMENTS HAPPY PATH — validará epayment.transaction status SUCCESSFUL"
elif [[ "$NEWMAN_FOLDER" == "Happy path integration wallet" || "$NEWMAN_FOLDER" == "Happy path integration wallet varios documentos" ]]; then
    SCENARIO="wallet_happy"
    log "Escenario: WALLET INTEGRATIONS HAPPY PATH"
elif [[ "$NEWMAN_FOLDER" == "Happy path cobre" ]]; then
    SCENARIO="cobre_happy"
    log "Escenario: COBRE HAPPY PATH"
fi
[[ -n "$PROVIDER_PREFIX" ]] && log "Proveedor : $PROVIDER_PREFIX"

JSON_REPORT="$SCRIPTS_DIR/results_final.json"
HTML_NEWMAN="$SCRIPTS_DIR/reporte_visual_newman.html"
LOG_FILE="$SCRIPTS_DIR/log_${PROYECTO}.txt"
CLAUDE_REPORT="$SCRIPTS_DIR/claude_report.html"
METRICS_FILE="$SCRIPTS_DIR/metrics_summary.json"
CONFLUENCE_BODY="$SCRIPTS_DIR/confluence_body.html"
DB_VALIDATION_FILE="$SCRIPTS_DIR/db_validation.json"

rm -f "$JSON_REPORT" "$HTML_NEWMAN" "$LOG_FILE" "$CLAUDE_REPORT" "$METRICS_FILE" "$CONFLUENCE_BODY" "$DB_VALIDATION_FILE"

CONF_USER="${CONF_USER:-}"
CONF_USER=$(echo "$CONF_USER" | tr -d '\n\r')
[[ -z "$CONF_USER" ]] && { log_err "CONF_USER no definida en Secrets."; exit 1; }
CONF_BASE_URL="https://finkargo.atlassian.net/wiki"
SPACE_KEY="QA"

log "============================================"
log " FINKARGO QA AUDIT v2.1"
log " Proyecto : $PROYECTO"
log " Folder   : $FOLDER_NAME"
log " Pais     : $PAIS_INPUT"
log " Ambiente : $AMBIENTE"
log " Run #    : $EXEC_NUM"
log "============================================"

# ----------------------------------------------------------
# 3. OBTENER COLLECTION UID
# ----------------------------------------------------------
COLLECTION_UID=$(python3 "$HELPERS_DIR/get_config.py" "$CONFIG_PATH" "$PROYECTO" "" "id") || {
    log_err "Proyecto '$PROYECTO' no encontrado en collections.json."
    log_err "Proyectos disponibles: $(python3 -c "import json; d=json.load(open('$CONFIG_PATH')); print(list(d.keys()))" 2>/dev/null || echo 'N/A')"
    exit 1
}
log_ok "Collection UID: ${COLLECTION_UID:0:20}..."

# ----------------------------------------------------------
# 4. MAPPING DE ENVIRONMENTS
# ----------------------------------------------------------
case "${PAIS_INPUT}:${AMBIENTE}" in
    CO:Testing)  ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933" ;;
    CO:Staging)  ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf" ;;
    MX:Testing)  ENV_UID="19456853-52efb174-794f-4837-a1bf-fc913c9b0f10" ;;
    MX:Staging)  ENV_UID="19103266-8187ac0e-07bd-497d-a228-fefdeec90492" ;;
    ALL:Testing) ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933" ;;
    ALL:Staging) ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf" ;;
    *)           log_err "Combinacion PAIS/AMBIENTE no valida: $PAIS_INPUT/$AMBIENTE"; exit 1 ;;
esac
log "Environment UID : $ENV_UID"

# ----------------------------------------------------------
# 5. DIAGNOSTICO POSTMAN API (antes de Newman)
# ----------------------------------------------------------
# ----------------------------------------------------------
# 5. CONSTRUCCION DE ARGUMENTOS NEWMAN
# ----------------------------------------------------------
# Usamos eval para que la POSTMAN_API_KEY se expanda correctamente
# en el contexto de GitHub Actions (igual que el script original)
COLLECTION_URL="https://api.getpostman.com/collections/${COLLECTION_UID}?apikey=${POSTMAN_API_KEY}"
ENV_URL="https://api.getpostman.com/environments/${ENV_UID}?apikey=${POSTMAN_API_KEY}"

ENV_EXPORT="$SCRIPTS_DIR/environment_export.json"

NEWMAN_BASE_ARGS=(
    "$COLLECTION_URL"
    --environment "$ENV_URL"
    --insecure
    -r cli,json,htmlextra
    --reporter-json-export      "$JSON_REPORT"
    --reporter-htmlextra-export "$HTML_NEWMAN"
    --export-environment        "$ENV_EXPORT"
    --suppress-exit-code
    --timeout-request 30000
    --timeout-script  10000
)

if [[ "$PROYECTO" == "ms-communicator" && -f "$DATA_FILE" ]]; then
    NEWMAN_BASE_ARGS+=("-d" "$DATA_FILE")
    log "Data-driven: $DATA_FILE"
fi

# ----------------------------------------------------------
# 7. EJECUCION NEWMAN
# ----------------------------------------------------------
NEWMAN_EXIT=0
set +e  # Desactivar pipefail para capturar exit de newman correctamente

# Resolver el folder a ejecutar según país e input
# CO → carpeta padre "🇨🇴 Colombia" (ejecuta todo el subárbol Colombia)
# MX → carpeta padre "🇲🇽 Mexico"
# Folder específico → se usa directamente (viene del workflow dispatch)
if [[ "$PAIS_INPUT" == "CO" && "$FOLDER_NAME" == "$PAIS_INPUT" ]]; then
    FOLDER_NAME="🇨🇴 Colombia"
elif [[ "$PAIS_INPUT" == "MX" && "$FOLDER_NAME" == "$PAIS_INPUT" ]]; then
    FOLDER_NAME="🇲🇽 Mexico"
fi

if [[ "$PAIS_INPUT" == "ALL" ]]; then
    FOLDER_CO="🇨🇴 Colombia"
    FOLDER_MX="🇲🇽 Mexico"
    log "Iniciando Newman (ALL): Colombia + Mexico"

    newman run "${NEWMAN_BASE_ARGS[@]}" \
        --folder "$FOLDER_CO" \
        --folder "$FOLDER_MX" \
        --reporter-htmlextra-title "QA Audit | ALL | $AMBIENTE | $NOW" \
        2>&1 | tee "$LOG_FILE"
    NEWMAN_EXIT=${PIPESTATUS[0]}
else
    log "Iniciando Newman | Folder: '$NEWMAN_FOLDER' | Pais: $PAIS_INPUT"

    newman run "${NEWMAN_BASE_ARGS[@]}" \
        --folder "$NEWMAN_FOLDER" \
        --reporter-htmlextra-title "QA Audit | $FOLDER_NAME | $PAIS_INPUT | $AMBIENTE | $NOW" \
        2>&1 | tee "$LOG_FILE"
    NEWMAN_EXIT=${PIPESTATUS[0]}
fi

set -e  # Reactivar pipefail
log "Newman exit code: $NEWMAN_EXIT"

# Si Newman fallo por infra (no hay reporte JSON), abortar
if [[ ! -f "$JSON_REPORT" ]]; then
    log_err "Newman no genero reporte JSON."
    log_err "Posibles causas:"
    log_err "  1. POSTMAN_API_KEY invalida o expirada — verifica en web.postman.co/settings/me/api-keys"
    log_err "  2. Collection UID incorrecto en collections.json"
    log_err "  3. El folder '$FOLDER_NAME' no existe en la coleccion de Postman"
    log_err "  4. Sin acceso a internet / VPN no activa"
    exit 1
fi
log_ok "Newman finalizado. Reporte JSON generado."

# ----------------------------------------------------------
# 7.5 EJECUCIÓN PLAYWRIGHT
# ----------------------------------------------------------
if [[ "$SCENARIO" == "expired" ]]; then
    log "Escenario EXPIRED — saltando Playwright."
elif [[ "$SCENARIO" == "rejected" ]]; then
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "rejected" || true
else
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" || true
fi

# ----------------------------------------------------------
# 7.6 NEWMAN FASE 2 — Post payment (solo si hubo payment_link)
# ----------------------------------------------------------
PAYMENT_LINK_FOUND=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        env = json.load(f)
    values = env.get('values', [])
    match = next((v['value'] for v in values if v['key'] == 'payment_link' and v['value']), None)
    print('yes' if match else 'no')
except:
    print('no')
" "$ENV_EXPORT" 2>/dev/null)

# Escenario EXPIRED: actualizar updated_at a created_at + 34 minutos para forzar expiración
if [[ "$SCENARIO" == "expired" ]]; then
    log "Simulando expiración: actualizando updated_at a created_at + 34 minutos en transaction..."
    PAYIN_ID=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        env = json.load(f)
    values = env.get('values', [])
    match = next((v['value'] for v in values if v['key'] == 'payin_id' and v['value']), None)
    print(match or '')
except:
    print('')
" "$ENV_EXPORT" 2>/dev/null)

    if [[ -n "$PAYIN_ID" ]]; then
        DB_SUFFIX="${AMBIENTE^^}_${PAIS_INPUT^^}"
        python3 -c "
import psycopg2, os, sys
conn = psycopg2.connect(
    host=os.environ['DB_HOST_${DB_SUFFIX}'],
    dbname=os.environ['DB_NAME_${DB_SUFFIX}'],
    user=os.environ['DB_USER_${DB_SUFFIX}'],
    password=os.environ['DB_PASSWORD_${DB_SUFFIX}'],
    port=int(os.environ.get('DB_PORT_${DB_SUFFIX}', '5432') or '5432')
)
cur = conn.cursor()
cur.execute(\"UPDATE supra.\\\"transaction\\\" SET updated_at = created_at + interval '34 minutes' WHERE external_id = %s\", (sys.argv[1],))
conn.commit()
print(f'OK updated_at = created_at + 34min para external_id: {sys.argv[1][:12]}...')
cur.close(); conn.close()
" "$PAYIN_ID" || log_warn "No se pudo actualizar updated_at en BD."
    else
        log_warn "No se encontró payin_id en el environment export para simular expiración."
    fi
fi

if [[ "$PAYMENT_LINK_FOUND" == "yes" && "$SCENARIO" != "rejected" ]]; then
    log "Iniciando Newman Fase 2 | Folder: 'Post payment'"
    # Resolver UID de la carpeta "Post payment" desde collections.json
    POST_PAYMENT_FOLDER_ID=$(python3 "$HELPERS_DIR/get_config.py" "$CONFIG_PATH" "$PROYECTO" "Post payment" "folder_id" 2>/dev/null || echo "")
    if [[ -z "$POST_PAYMENT_FOLDER_ID" ]]; then
        log_warn "No se encontró UID para 'Post payment' en collections.json. Usando nombre como fallback."
        POST_PAYMENT_FOLDER_ID="Post payment"
    else
        # Quitar prefijo de workspace (formato: {workspace_id}-{uuid}) → dejar solo el UUID
        POST_PAYMENT_FOLDER_ID=$(echo "$POST_PAYMENT_FOLDER_ID" | sed 's/^[0-9]*-//')
        log "Post payment folder ID: $POST_PAYMENT_FOLDER_ID"
    fi
    ENV_EXPORT_P2="$SCRIPTS_DIR/environment_export_phase2.json"
    JSON_REPORT_P2="$SCRIPTS_DIR/results_phase2.json"
    HTML_NEWMAN_P2="$SCRIPTS_DIR/reporte_visual_phase2.html"
    set +e
    newman run "$COLLECTION_URL" \
        --environment "$ENV_EXPORT" \
        --insecure \
        -r cli,json,htmlextra \
        --reporter-json-export      "$JSON_REPORT_P2" \
        --reporter-htmlextra-export "$HTML_NEWMAN_P2" \
        --export-environment        "$ENV_EXPORT_P2" \
        --suppress-exit-code \
        --timeout-request 30000 \
        --timeout-script  10000 \
        --folder "$POST_PAYMENT_FOLDER_ID" \
        --reporter-htmlextra-title "QA Audit | Post payment | $PAIS_INPUT | $AMBIENTE | $NOW" \
        2>&1 | tee -a "$LOG_FILE"
    NEWMAN_POST_EXIT=${PIPESTATUS[0]}
    set -e
    log "Newman Fase 2 exit code: $NEWMAN_POST_EXIT"
else
    log "Sin payment_link — saltando Newman Fase 2."
fi

# ----------------------------------------------------------
# 7.8 VALIDACION DE ESTADOS EN BD
# ----------------------------------------------------------
log "Validando estados en base de datos..."
python3 "$HELPERS_DIR/validate_db_states.py" "$ENV_EXPORT" "$PAIS_INPUT" "$AMBIENTE" "$DB_VALIDATION_FILE" "$SCENARIO" || true

# ----------------------------------------------------------
# 8. EXTRACCION DE METRICAS
# ----------------------------------------------------------
log "Extrayendo metricas del reporte..."
python3 "$HELPERS_DIR/extract_metrics.py" "$JSON_REPORT" "$METRICS_FILE"
log_ok "Metricas extraidas -> $METRICS_FILE"

# ----------------------------------------------------------
# 9. ANALISIS CON CLAUDE AI
# ----------------------------------------------------------
log "Analizando con Claude AI..."
python3 "$HELPERS_DIR/claude_analysis.py" \
    "$METRICS_FILE" "$CLAUDE_REPORT" \
    "$PROYECTO" "$FOLDER_NAME" "$PAIS_INPUT" "$AMBIENTE" "$NOW"
log_ok "Reporte Claude -> $CLAUDE_REPORT"

# ----------------------------------------------------------
# 10. PUBLICACION EN CONFLUENCE
# ----------------------------------------------------------
log "Publicando en Confluence..."

if [[ "$AMBIENTE" == "Staging" ]]; then
    AMBIENTE_PARENT_ID="2217115649"
else
    AMBIENTE_PARENT_ID="2216984577"
fi

FOLDER_TITLE="Auditorias $AMBIENTE - $PROYECTO"
PAGE_TITLE="[$PROYECTO] [$PAIS_INPUT] $FOLDER_NAME - Run #$EXEC_NUM"

# Buscar carpeta padre del proyecto
SEARCH_URL="${CONF_BASE_URL}/rest/api/content?title=${FOLDER_TITLE// /%20}&spaceKey=${SPACE_KEY}"
SEARCH_RES=$(curl -sf --insecure -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL") || {
    CURL_CODE=$?
    log_err "Error conectando a Confluence (curl exit: $CURL_CODE)."
    log_err "URL intentada: $SEARCH_URL"
    log_err "Verifica CONF_USER ('${CONF_USER}') y CONF_TOKEN (${#CONF_TOKEN} chars)."
    exit 1
}

PROJECT_FOLDER_ID=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(d['results'][0]['id'] if d.get('results') else '')
except:
    print('')
" "$SEARCH_RES")

if [[ -z "$PROJECT_FOLDER_ID" ]]; then
    log "Creando carpeta padre en Confluence: '$FOLDER_TITLE'..."
    CREATE_PAYLOAD=$(python3 -c "
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

    PROJECT_FOLDER_ID=$(curl -sf --insecure -u "$CONF_USER:$CONF_TOKEN" \
        -X POST -H 'Content-Type: application/json' \
        -d "$CREATE_PAYLOAD" \
        "$CONF_BASE_URL/rest/api/content" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")

    [[ -z "$PROJECT_FOLDER_ID" ]] && { log_err "No se pudo crear carpeta padre en Confluence."; exit 1; }
    log_ok "Carpeta creada: ID $PROJECT_FOLDER_ID"
else
    log "Carpeta padre encontrada: ID $PROJECT_FOLDER_ID"
fi

# Construir body HTML enriquecido
python3 "$HELPERS_DIR/build_confluence.py" \
    "$METRICS_FILE" "$CLAUDE_REPORT" "$LOG_FILE" \
    "$PROYECTO" "$FOLDER_NAME" "$PAIS_INPUT" "$AMBIENTE" "$NOW" "$EXEC_NUM" \
    "$DB_VALIDATION_FILE" \
    > "$CONFLUENCE_BODY"

log_ok "HTML de Confluence construido."

# Publicar pagina
FINAL_PAYLOAD=$(python3 -c "
import json, sys
body = open(sys.argv[4], encoding='utf-8').read()
print(json.dumps({
    'type': 'page',
    'title': sys.argv[1],
    'space': {'key': sys.argv[2]},
    'ancestors': [{'id': sys.argv[3]}],
    'body': {'storage': {'value': body, 'representation': 'storage'}}
}))" "$PAGE_TITLE" "$SPACE_KEY" "$PROJECT_FOLDER_ID" "$CONFLUENCE_BODY")

RESPONSE_PUB=$(curl -sf --insecure -u "$CONF_USER:$CONF_TOKEN" \
    -X POST -H 'Content-Type: application/json' \
    -d "$FINAL_PAYLOAD" \
    "$CONF_BASE_URL/rest/api/content") || {
    log_err "Error publicando en Confluence."
    exit 1
}

NEW_PAGE_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('id',''))" "$RESPONSE_PUB")
[[ -z "$NEW_PAGE_ID" ]] && { log_err "Confluence no devolvio ID de pagina."; exit 1; }
log_ok "Pagina publicada. ID: $NEW_PAGE_ID"

# ----------------------------------------------------------
# 11. ADJUNTAR ARCHIVOS
# ----------------------------------------------------------
if [[ -f "$HTML_NEWMAN" ]]; then
    curl -sf -u "$CONF_USER:$CONF_TOKEN" \
        -X POST -H "X-Atlassian-Token: nocheck" \
        --insecure -F "file=@${HTML_NEWMAN};type=text/html" \
        "$CONF_BASE_URL/rest/api/content/$NEW_PAGE_ID/attachments" > /dev/null \
        && log_ok "Reporte htmlextra adjuntado." \
        || log_warn "No se pudo adjuntar reporte htmlextra."
fi

if [[ -f "$METRICS_FILE" ]]; then
    curl -sf -u "$CONF_USER:$CONF_TOKEN" \
        -X POST -H "X-Atlassian-Token: nocheck" \
        --insecure -F "file=@${METRICS_FILE};type=application/json" \
        "$CONF_BASE_URL/rest/api/content/$NEW_PAGE_ID/attachments" > /dev/null \
        && log_ok "JSON de metricas adjuntado." \
        || log_warn "No se pudo adjuntar metrics_summary.json."
fi

# ----------------------------------------------------------
# 12. RESUMEN FINAL
# ----------------------------------------------------------
FINAL_FAILURES=$(python3 -c "
import json
try:
    m = json.load(open('$METRICS_FILE'))
    print(m.get('failed_tests', 0))
except:
    print(0)
")

echo ""
log "============================================"
log_ok "PIPELINE COMPLETADO"
log " Confluence : $CONF_BASE_URL/spaces/$SPACE_KEY/pages/$NEW_PAGE_ID"
log " HTML       : $HTML_NEWMAN"
log " Log        : $LOG_FILE"
log "============================================"

if [[ "$FINAL_FAILURES" -gt 0 ]]; then
    log_warn "$FINAL_FAILURES test(s) fallaron. Revisa el analisis en Confluence."
    exit 2  # 2 = tests fallaron (distingue de errores de infraestructura)
fi

log_ok "Todos los tests pasaron."
exit 0