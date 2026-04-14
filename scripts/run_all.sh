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

[[ ! -f "$CONFIG_PATH"             ]] && { log_err "No se encontro: $CONFIG_PATH";              exit 1; }
[[ ! -f "$HELPERS_DIR/get_config.py"      ]] && { log_err "No se encontro: $HELPERS_DIR/get_config.py";      exit 1; }
[[ ! -f "$HELPERS_DIR/extract_metrics.py" ]] && { log_err "No se encontro: $HELPERS_DIR/extract_metrics.py"; exit 1; }
[[ ! -f "$HELPERS_DIR/claude_analysis.py" ]] && { log_err "No se encontro: $HELPERS_DIR/claude_analysis.py"; exit 1; }
[[ ! -f "$HELPERS_DIR/build_confluence.py" ]] && { log_err "No se encontro: $HELPERS_DIR/build_confluence.py"; exit 1; }

EXEC_NUM="${GITHUB_RUN_NUMBER:-local-$(date +'%Y%m%d%H%M%S')}"
NOW="$(date +'%Y-%m-%d %H:%M:%S')"
FOLDER_NAME="$FOLDER_INPUT"

JSON_REPORT="$SCRIPTS_DIR/results_final.json"
HTML_NEWMAN="$SCRIPTS_DIR/reporte_visual_newman.html"
LOG_FILE="$SCRIPTS_DIR/log_${PROYECTO}.txt"
CLAUDE_REPORT="$SCRIPTS_DIR/claude_report.html"
METRICS_FILE="$SCRIPTS_DIR/metrics_summary.json"
CONFLUENCE_BODY="$SCRIPTS_DIR/confluence_body.html"

rm -f "$JSON_REPORT" "$HTML_NEWMAN" "$LOG_FILE" "$CLAUDE_REPORT" "$METRICS_FILE" "$CONFLUENCE_BODY"

CONF_USER="${CONF_USER:-andres.navia@finkargo.com}"
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

NEWMAN_BASE_ARGS=(
    "$COLLECTION_URL"
    --environment "$ENV_URL"
    --insecure
    -r cli,json,htmlextra
    --reporter-json-export      "$JSON_REPORT"
    --reporter-htmlextra-export "$HTML_NEWMAN"
    --suppress-exit-code
    --timeout-request 30000
    --timeout-script  10000
)

if [[ -f "$DATA_FILE" ]]; then
    NEWMAN_BASE_ARGS+=("-d" "$DATA_FILE")
    log "Data-driven: $DATA_FILE"
else
    log_warn "scenarios.json no encontrado. Ejecutando sin data-driven."
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
    log "Iniciando Newman | Folder: '$FOLDER_NAME' | Pais: $PAIS_INPUT"

    newman run "${NEWMAN_BASE_ARGS[@]}" \
        --folder "$FOLDER_NAME" \
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
SEARCH_RES=$(curl -sf -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL") || {
    log_err "Error conectando a Confluence. Verifica CONF_USER y CONF_TOKEN."
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

    PROJECT_FOLDER_ID=$(curl -sf -u "$CONF_USER:$CONF_TOKEN" \
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
    > "$CONFLUENCE_BODY"

log_ok "HTML de Confluence construido."

# Publicar pagina
FINAL_PAYLOAD=$(python3 -c "
import json, sys
body = open(sys.argv[4]).read()
print(json.dumps({
    'type': 'page',
    'title': sys.argv[1],
    'space': {'key': sys.argv[2]},
    'ancestors': [{'id': sys.argv[3]}],
    'body': {'storage': {'value': body, 'representation': 'storage'}}
}))" "$PAGE_TITLE" "$SPACE_KEY" "$PROJECT_FOLDER_ID" "$CONFLUENCE_BODY")

RESPONSE_PUB=$(curl -sf -u "$CONF_USER:$CONF_TOKEN" \
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
        -F "file=@${HTML_NEWMAN};type=text/html" \
        "$CONF_BASE_URL/rest/api/content/$NEW_PAGE_ID/attachments" > /dev/null \
        && log_ok "Reporte htmlextra adjuntado." \
        || log_warn "No se pudo adjuntar reporte htmlextra."
fi

if [[ -f "$METRICS_FILE" ]]; then
    curl -sf -u "$CONF_USER:$CONF_TOKEN" \
        -X POST -H "X-Atlassian-Token: nocheck" \
        -F "file=@${METRICS_FILE};type=application/json" \
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