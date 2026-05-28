#!/bin/bash
set -euo pipefail

# ============================================================
# FINKARGO QA AUDIT PIPELINE v2.2
# Arquitectura escalable: tipo de colección definido en JSON
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
[[ -z "$PROYECTO"   ]] && { log_err "Param 1 (PROYECTO) obligatorio.";        ERRORS=1; }
[[ -z "$PAIS_INPUT" ]] && { log_err "Param 3 (PAIS: CO|MX|ALL) obligatorio."; ERRORS=1; }
[[ -z "$AMBIENTE"   ]] && { log_err "Param 4 (Testing|Staging) obligatorio."; ERRORS=1; }
[[ $ERRORS -eq 1 ]] && { log_err "Uso: $0 <PROYECTO> [FOLDER] <CO|MX|ALL> <Testing|Staging>"; exit 1; }

# Si no se especifica folder, ejecutar a nivel país
[[ -z "$FOLDER_INPUT" ]] && FOLDER_INPUT="$PAIS_INPUT"

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

# ----------------------------------------------------------
# MAPEO PROYECTO → ARCHIVO DE CONFIGURACION
# Para agregar un proyecto nuevo: solo añade una línea al case.
# ----------------------------------------------------------
case "$PROYECTO" in
    "Flows APP")         CONFIG_FILE="qa-flujos-criticos.json" ;;
    "QA Operations")     CONFIG_FILE="qa-operations.json" ;;
    "ms-communicator")   CONFIG_FILE="ms-communicator.json" ;;
    *)                   CONFIG_FILE="${PROYECTO}.json" ;;
esac

CONFIG_PATH="$SCRIPTS_DIR/config/$CONFIG_FILE"
DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/scenarios.json"
FIXTURES_DIR="$(dirname "$SCRIPTS_DIR")/test/fixtures"

[[ ! -f "$CONFIG_PATH" ]] && {
    log_err "No se encontro config para '$PROYECTO': $CONFIG_PATH"
    log_err "Archivos disponibles en config/:"
    ls "$SCRIPTS_DIR/config/" 2>/dev/null || echo "  (directorio vacio)"
    exit 1
}
[[ ! -f "$HELPERS_DIR/get_config.py"      ]] && { log_err "No se encontro: $HELPERS_DIR/get_config.py";      exit 1; }
[[ ! -f "$HELPERS_DIR/extract_metrics.py" ]] && { log_err "No se encontro: $HELPERS_DIR/extract_metrics.py"; exit 1; }
[[ ! -f "$HELPERS_DIR/claude_analysis.py" ]] && { log_err "No se encontro: $HELPERS_DIR/claude_analysis.py"; exit 1; }
[[ ! -f "$HELPERS_DIR/build_confluence.py" ]] && { log_err "No se encontro: $HELPERS_DIR/build_confluence.py"; exit 1; }

EXEC_NUM="${GITHUB_RUN_NUMBER:-local-$(date +'%Y%m%d%H%M%S')}"
NOW="$(date +'%Y-%m-%d %H:%M:%S')"

# ----------------------------------------------------------
# PROCESAMIENTO DEL FOLDER INPUT
# Soporta dos formatos:
#   "Onboarding Colombia MD"           → ejecuta carpeta completa en Postman
#   "Onboarding Colombia MD / 1. Create User" → ejecuta solo ese subfolder
# ----------------------------------------------------------
FOLDER_INPUT_CLEAN=$(echo "$FOLDER_INPUT" | sed 's/^[- ]*//')
PROVIDER_PREFIX=""
FOLDER_NAME="$FOLDER_INPUT_CLEAN"

if [[ "$FOLDER_INPUT_CLEAN" == *" / "* ]]; then
    # Hay al menos un separador: tomar la última parte como NEWMAN_FOLDER
    # y el resto como display name (FOLDER_NAME ya está completo)
    NEWMAN_FOLDER=$(echo "$FOLDER_INPUT_CLEAN" | awk -F' / ' '{print $NF}' | xargs)
    PROVIDER_PREFIX=$(echo "$FOLDER_INPUT_CLEAN" | sed 's/ \/ [^/]*$//' | xargs)
else
    # Sin separador: ejecutar la carpeta tal cual
    NEWMAN_FOLDER="$FOLDER_INPUT_CLEAN"
fi

# Detectar escenario según subfolder
SCENARIO="happy_path"
if [[ "$NEWMAN_FOLDER" == "Rejected flow" ]]; then
    SCENARIO="rejected"
    log "Escenario: REJECTED"
elif [[ "$NEWMAN_FOLDER" == "Expired flow" ]]; then
    SCENARIO="expired"
    log "Escenario: EXPIRED"
elif [[ "$NEWMAN_FOLDER" == "Happy path epayments" ]]; then
    SCENARIO="epayments_happy"
    log "Escenario: EPAYMENTS HAPPY PATH"
elif [[ "$NEWMAN_FOLDER" == "Happy path wallet epayments" ]]; then
    SCENARIO="wallet_epayments_happy"
    log "Escenario: WALLET EPAYMENTS HAPPY PATH"
elif [[ "$NEWMAN_FOLDER" == "Happy path integration wallet" || "$NEWMAN_FOLDER" == "Happy path integration wallet varios documentos" ]]; then
    SCENARIO="wallet_happy"
    log "Escenario: WALLET INTEGRATIONS HAPPY PATH"
elif [[ "$NEWMAN_FOLDER" == "Happy path cobre" ]]; then
    SCENARIO="cobre_happy"
    log "Escenario: COBRE HAPPY PATH"
fi

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
log " FINKARGO QA AUDIT v2.2"
log " Proyecto : $PROYECTO"
log " Config   : $CONFIG_FILE"
log " Folder   : $FOLDER_NAME"
log " Newman F : $NEWMAN_FOLDER"
log " Pais     : $PAIS_INPUT"
log " Ambiente : $AMBIENTE"
log " Run #    : $EXEC_NUM"
log "============================================"

# ----------------------------------------------------------
# 3. OBTENER COLLECTION UID
# ----------------------------------------------------------
COLLECTION_UID=$(python3 "$HELPERS_DIR/get_config.py" "$CONFIG_PATH" "$PROYECTO" "" "id") || {
    log_err "Proyecto '$PROYECTO' no encontrado en $CONFIG_PATH."
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
# 5. CONSTRUCCION DE ARGUMENTOS NEWMAN
# ----------------------------------------------------------
COLLECTION_URL="https://api.getpostman.com/collections/${COLLECTION_UID}?apikey=${POSTMAN_API_KEY}"
ENV_URL="https://api.getpostman.com/environments/${ENV_UID}?apikey=${POSTMAN_API_KEY}"

# ----------------------------------------------------------
# 5.5 FILTRADO DE COLECCIÓN
# Detecta el tipo desde el JSON de config:
#   "type": "folder" → Newman ejecuta carpetas nativas de Postman (default)
#   "type": "items"  → Newman ejecuta requests filtrados por IDs
# Para agregar soporte a una colección nueva, solo cambia el JSON de config.
# ----------------------------------------------------------
FILTER_MODE=false
NEWMAN_COLLECTION_SOURCE="$COLLECTION_URL"
ITEM_IDS_ARRAY=()

CONFIG_TYPE=$(python3 "$HELPERS_DIR/get_config.py" "$CONFIG_PATH" "$PROYECTO" "" "type" 2>/dev/null || echo "folder")
log "Tipo de coleccion: $CONFIG_TYPE"

if [[ "$CONFIG_TYPE" == "items" && -n "$PROVIDER_PREFIX" ]]; then
    mapfile -t ITEM_IDS_ARRAY < <(
        python3 "$HELPERS_DIR/get_config.py" \
            "$CONFIG_PATH" "$PROYECTO" "$PROVIDER_PREFIX" "all_items" 2>/dev/null
    )
    if [[ ${#ITEM_IDS_ARRAY[@]} -gt 0 ]]; then
        log "Modo filtrado: ${#ITEM_IDS_ARRAY[@]} item(s) en '$PROVIDER_PREFIX'. Descargando coleccion..."
        COLLECTION_FULL="$SCRIPTS_DIR/collection_full.json"
        curl -sf --insecure \
            "https://api.getpostman.com/collections/${COLLECTION_UID}?apikey=${POSTMAN_API_KEY}" \
            -o "$COLLECTION_FULL" \
            || { log_err "No se pudo descargar la coleccion desde Postman API."; exit 1; }
        COLLECTION_FILTERED="$SCRIPTS_DIR/collection_filtered.json"
        python3 "$HELPERS_DIR/filter_collection.py" \
            "$COLLECTION_FULL" "$COLLECTION_FILTERED" "${ITEM_IDS_ARRAY[@]}" \
            || { log_err "Error al filtrar la coleccion."; exit 1; }
        NEWMAN_COLLECTION_SOURCE="$COLLECTION_FILTERED"
        FILTER_MODE=true
        log_ok "Coleccion filtrada lista: ${#ITEM_IDS_ARRAY[@]} request(s) seleccionado(s)."
    fi
fi

ENV_EXPORT="$SCRIPTS_DIR/environment_export.json"

NEWMAN_BASE_ARGS=(
    "$NEWMAN_COLLECTION_SOURCE"
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
set +e

if [[ "$FILTER_MODE" == "true" ]]; then
    log "Iniciando Newman (filtrado) | ${#ITEM_IDS_ARRAY[@]} request(s) | Pais: $PAIS_INPUT"
    newman run "${NEWMAN_BASE_ARGS[@]}" \
        --reporter-htmlextra-title "QA Audit | $FOLDER_NAME | $PAIS_INPUT | $AMBIENTE | $NOW" \
        2>&1 | tee "$LOG_FILE"
    NEWMAN_EXIT=${PIPESTATUS[0]}

elif [[ "$PAIS_INPUT" == "ALL" ]]; then
    log "Iniciando Newman (ALL): Colombia + Mexico"
    newman run "${NEWMAN_BASE_ARGS[@]}" \
        --folder "🇨🇴 Colombia" \
        --folder "🇲🇽 Mexico" \
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

set -e
log "Newman exit code: $NEWMAN_EXIT"

if [[ ! -f "$JSON_REPORT" ]]; then
    log_err "Newman no genero reporte JSON."
    log_err "  1. POSTMAN_API_KEY invalida o expirada"
    log_err "  2. Collection UID incorrecto en $CONFIG_FILE"
    log_err "  3. El folder '$NEWMAN_FOLDER' no existe en la coleccion de Postman"
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

if [[ "$SCENARIO" == "expired" ]]; then
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
        log "Transaction creada: $PAYIN_ID"
        log "Esperando 34 minutos para que el proveedor expire la transaccion automaticamente..."
        sleep 2040
        log "Espera finalizada. Procediendo a validar estado en BD..."
    else
        log_warn "No se encontro payin_id en el environment export."
    fi
fi

if [[ "$PAYMENT_LINK_FOUND" == "yes" && "$SCENARIO" != "rejected" ]]; then
    log "Iniciando Newman Fase 2 | Folder: 'Post payment'"
    POST_PAYMENT_FOLDER_ID=$(python3 "$HELPERS_DIR/get_config.py" "$CONFIG_PATH" "$PROYECTO" "Post payment" "folder_id" 2>/dev/null || echo "")
    if [[ -z "$POST_PAYMENT_FOLDER_ID" ]]; then
        log_warn "No se encontro UID para 'Post payment'. Usando nombre como fallback."
        POST_PAYMENT_FOLDER_ID="Post payment"
    else
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

# Busca una página en Confluence por título y padre exacto.
# Si no existe, la crea como índice de hijos.
# Devuelve el ID por stdout; logs van a stderr para no contaminar la captura.
conf_find_or_create() {
    local PARENT_ID="$1"
    local TITLE="$2"

    local CQL_ENC
    CQL_ENC=$(python3 -c "
import urllib.parse, sys
title, parent_id, space = sys.argv[1], sys.argv[2], sys.argv[3]
cql = 'title=\"{}\" AND parent={} AND space=\"{}\"'.format(title, parent_id, space)
print(urllib.parse.quote(cql))
" "$TITLE" "$PARENT_ID" "$SPACE_KEY")

    local SEARCH_RES
    SEARCH_RES=$(curl -sf --insecure -u "$CONF_USER:$CONF_TOKEN" \
        "${CONF_BASE_URL}/rest/api/content/search?cql=${CQL_ENC}&limit=5") || SEARCH_RES='{}'

    local PAGE_ID
    PAGE_ID=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    results = d.get('results', [])
    print(results[0]['id'] if results else '')
except:
    print('')
" "$SEARCH_RES")

    if [[ -z "$PAGE_ID" ]]; then
        echo "[$(date +'%H:%M:%S')] Creando carpeta Confluence: '$TITLE'..." >&2
        local CREATE_PAYLOAD
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
}))" "$TITLE" "$SPACE_KEY" "$PARENT_ID")

        PAGE_ID=$(curl -sf --insecure -u "$CONF_USER:$CONF_TOKEN" \
            -X POST -H 'Content-Type: application/json' \
            -d "$CREATE_PAYLOAD" \
            "$CONF_BASE_URL/rest/api/content" \
            | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")

        if [[ -z "$PAGE_ID" ]]; then
            echo "[$(date +'%H:%M:%S')] ERR  No se pudo crear carpeta '$TITLE'." >&2
            return 1
        fi
        echo "[$(date +'%H:%M:%S')] OK  Carpeta creada: '$TITLE' (ID: $PAGE_ID)" >&2
    else
        echo "[$(date +'%H:%M:%S')] Carpeta encontrada: '$TITLE' (ID: $PAGE_ID)" >&2
    fi

    echo "$PAGE_ID"
}

log "Publicando en Confluence..."

if [[ "$AMBIENTE" == "Staging" ]]; then
    AMBIENTE_PARENT_ID="2217115649"
else
    AMBIENTE_PARENT_ID="2216984577"
fi

# Verificar conectividad antes de la jerarquía completa
PROBE_URL="${CONF_BASE_URL}/rest/api/content?spaceKey=${SPACE_KEY}&limit=1"
curl -sf --insecure -u "$CONF_USER:$CONF_TOKEN" "$PROBE_URL" > /dev/null || {
    log_err "Error conectando a Confluence."
    log_err "Verifica CONF_USER ('${CONF_USER}') y CONF_TOKEN (${#CONF_TOKEN} chars)."
    exit 1
}

PAGE_TITLE="[$PROYECTO] [$PAIS_INPUT] $FOLDER_NAME - Run #$EXEC_NUM"

# Nivel 1 — Proyecto/Ambiente  (ej. "Auditorias Testing - Flows APP")
PROJECT_FOLDER_ID=$(conf_find_or_create "$AMBIENTE_PARENT_ID" "Auditorias $AMBIENTE - $PROYECTO") || exit 1

# Nivel 2 — Flujo              (ej. "Onboarding Colombia MD")
FLOW_FOLDER_ID=$(conf_find_or_create "$PROJECT_FOLDER_ID" "$FOLDER_NAME") || exit 1

# Nivel 3 — País               (ej. "CO" / "MX" / "ALL")
COUNTRY_FOLDER_ID=$(conf_find_or_create "$FLOW_FOLDER_ID" "$PAIS_INPUT") || exit 1

python3 "$HELPERS_DIR/build_confluence.py" \
    "$METRICS_FILE" "$CLAUDE_REPORT" "$LOG_FILE" \
    "$PROYECTO" "$FOLDER_NAME" "$PAIS_INPUT" "$AMBIENTE" "$NOW" "$EXEC_NUM" \
    "$DB_VALIDATION_FILE" \
    > "$CONFLUENCE_BODY"

log_ok "HTML de Confluence construido."

FINAL_PAYLOAD=$(python3 -c "
import json, sys
body = open(sys.argv[4], encoding='utf-8').read()
print(json.dumps({
    'type': 'page',
    'title': sys.argv[1],
    'space': {'key': sys.argv[2]},
    'ancestors': [{'id': sys.argv[3]}],
    'body': {'storage': {'value': body, 'representation': 'storage'}}
}))" "$PAGE_TITLE" "$SPACE_KEY" "$COUNTRY_FOLDER_ID" "$CONFLUENCE_BODY")

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
    exit 2
fi

log_ok "Todos los tests pasaron."
exit 0