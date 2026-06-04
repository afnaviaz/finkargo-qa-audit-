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
[[ -z "$PAIS_INPUT"   ]] && { log_err "Param 3 (PAIS: CO|MX|ALL) obligatorio.";    ERRORS=1; }
[[ -z "$AMBIENTE"     ]] && { log_err "Param 4 (Testing|Staging) obligatorio.";    ERRORS=1; }
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
CONFIG_PATH="$SCRIPTS_DIR/config/${PROYECTO}.json"
DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/scenarios.json"
SUPRA_DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/supra_scenarios.json"
SUPRA_EPAYMENTS_DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/supra_epayments_scenarios.json"
WALLET_DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/wallet_scenarios.json"
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
elif [[ "$NEWMAN_FOLDER" == "SUPRA EPAYMENTS" || "$NEWMAN_FOLDER" == "Supra epayments" ]]; then
    SCENARIO="supra_epayments"
    log "Escenario: SUPRA EPAYMENTS — 13 escenarios EP/VL/NEG"
elif [[ "$NEWMAN_FOLDER" == "Happy path wallet epayments" ]]; then
    SCENARIO="wallet_epayments_happy"
    log "Escenario: WALLET EPAYMENTS HAPPY PATH — validará epayment.transaction status SUCCESSFUL"
elif [[ "$NEWMAN_FOLDER" == "Happy path integration wallet" || "$NEWMAN_FOLDER" == "Happy path integration wallet varios documentos" ]]; then
    SCENARIO="wallet_happy"
    log "Escenario: WALLET INTEGRATIONS HAPPY PATH"
elif [[ "$NEWMAN_FOLDER" == "Happy path cobre" ]]; then
    SCENARIO="cobre_happy"
    NEWMAN_FOLDER="925d11ef-abf1-4786-8910-3d6a4585d4f1"
    log "Escenario: COBRE HAPPY PATH — Quote + Transaction + Debit + Payment Notification (2 fases)"
elif [[ "$NEWMAN_FOLDER" == "Happy path cobre fondos insuficientes" ]]; then
    SCENARIO="cobre_fondos_insuficientes"
    log "Escenario: COBRE FONDOS INSUFICIENTES — Quote + Transaction + Debit (3 pasos)"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Card one time" ]]; then
    SCENARIO="stripe_card"
    log "Escenario: STRIPE CARD ONE TIME — Playwright llenará el checkout"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Card recurring" ]]; then
    SCENARIO="stripe_card_recurring"
    log "Escenario: STRIPE CARD RECURRING — Playwright llenará el checkout de suscripción"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Oxxo one time" ]]; then
    SCENARIO="stripe_oxxo"
    log "Escenario: STRIPE OXXO ONE TIME"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Customer balance recurring" && "$PROVIDER_PREFIX" == "STRIPE EPAYMENTS" ]]; then
    SCENARIO="stripe_balance_recurring_epayments"
    log "Escenario: STRIPE BALANCE RECURRING EPAYMENTS (PG005)"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Customer balance recurring" ]]; then
    SCENARIO="stripe_balance_recurring"
    log "Escenario: STRIPE BALANCE RECURRING — Playwright aplicará pago externo en dashboard"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Customer balance one time" && "$PROVIDER_PREFIX" == "STRIPE EPAYMENTS" ]]; then
    SCENARIO="stripe_balance_one_time_epayments"
    log "Escenario: STRIPE BALANCE ONE TIME EPAYMENTS (PG005)"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Customer balance one time" ]]; then
    SCENARIO="stripe_balance_one_time"
    log "Escenario: STRIPE BALANCE ONE TIME — pago único con customer_balance"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Card one time epayments" ]]; then
    SCENARIO="stripe_card_epayments"
    log "Escenario: STRIPE CARD ONE TIME EPAYMENTS — Playwright llenará el checkout"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Card recurring epayments" ]]; then
    SCENARIO="stripe_card_recurring_epayments"
    log "Escenario: STRIPE CARD RECURRING EPAYMENTS — Playwright llenará el checkout de suscripción PG005"
elif [[ "$NEWMAN_FOLDER" == "Create Payment Oxxo one time epayments" ]]; then
    SCENARIO="stripe_oxxo_epayments"
    log "Escenario: STRIPE OXXO ONE TIME EPAYMENTS (PG005)"
elif [[ "$NEWMAN_FOLDER" == "laft-reconsult-monolito" ]]; then
    SCENARIO="laft_reconsult"
    NEWMAN_FOLDER="RECONSULT"
    log "Escenario: LAFT RECONSULT — 36 compañías, corre monolito + integrations en orden"
elif [[ "$NEWMAN_FOLDER" == "upload-buro-mx" ]]; then
    SCENARIO="upload_buro_mx"
    NEWMAN_FOLDER="ea1f69c0-7bf1-4cf1-91e7-427294a69625"
    log "Escenario: UPLOAD BURO MX — 35 RFCs, integrations + monolito"
elif [[ "$NEWMAN_FOLDER" == "Happy path vertice integrations" ]]; then
    SCENARIO="vertice_happy_path"
    NEWMAN_FOLDER="8b3a4385-df77-466a-a356-a4e2fdaf7e9b"
    log "Escenario: VERTICE HAPPY PATH — Create Insured (9 iter) + Crear Certificado Transporte (11 iter)"
elif [[ "$NEWMAN_FOLDER" == "Crear Certificado Transporte" ]]; then
    SCENARIO="vertice_cert_transporte"
    NEWMAN_FOLDER="9a19703f-9142-4dc9-8f86-b9e64f7fbb6b"
    log "Escenario: VERTICE CREAR CERTIFICADO TRANSPORTE — 11 iteraciones EP/VL/NEG"
elif [[ "$NEWMAN_FOLDER" == "common-nit-dates" ]]; then
    SCENARIO="common_nit_dates"
    NEWMAN_FOLDER="ff93f1b8-4369-451b-96c0-b3cdbb4300dc"
    log "Escenario: COMMON NIT DATES — 36 NITs, GET /v1/common/{{nit}}/dates"
elif [[ "$NEWMAN_FOLDER" == "sarlaft-last-date" ]]; then
    SCENARIO="sarlaft_last_date"
    NEWMAN_FOLDER="354e9e44-359b-432f-b382-50cd1b8e7f4a"
    log "Escenario: SARLAFT LAST DATE METAMAP — 36 NITs"
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
elif [[ "$NEWMAN_FOLDER" == "Happy path integration" && -f "$SUPRA_DATA_FILE" ]]; then
    NEWMAN_BASE_ARGS+=("-d" "$SUPRA_DATA_FILE")
    log "Data-driven (SUPRA): $SUPRA_DATA_FILE"
elif [[ ( "$SCENARIO" == "supra_epayments" || "$SCENARIO" == "epayments_happy" ) && -f "$SUPRA_EPAYMENTS_DATA_FILE" ]]; then
    NEWMAN_BASE_ARGS+=("-d" "$SUPRA_EPAYMENTS_DATA_FILE")
    log "Data-driven (SUPRA EPAYMENTS): $SUPRA_EPAYMENTS_DATA_FILE"
elif [[ ( "$SCENARIO" == "wallet_happy" || "$SCENARIO" == "wallet_epayments_happy" ) && -f "$WALLET_DATA_FILE" ]]; then
    NEWMAN_BASE_ARGS+=("-d" "$WALLET_DATA_FILE")
    log "Data-driven (WALLET): $WALLET_DATA_FILE"
fi

# Inyectar URLs y parámetros de cuerpo para flujos Stripe
if [[ "$SCENARIO" == "stripe_oxxo" || "$SCENARIO" == "stripe_card" || "$SCENARIO" == "stripe_card_recurring" || "$SCENARIO" == "stripe_balance_recurring" || "$SCENARIO" == "stripe_balance_one_time" || "$SCENARIO" == "stripe_card_epayments" || "$SCENARIO" == "stripe_card_recurring_epayments" || "$SCENARIO" == "stripe_oxxo_epayments" || "$SCENARIO" == "stripe_balance_recurring_epayments" || "$SCENARIO" == "stripe_balance_one_time_epayments" ]]; then
    if [[ "$AMBIENTE" == "Staging" ]]; then
        STRIPE_BASE_URL="https://api-staging.finkargo.com.mx/integrations"
        API_EPAYMENTS2="https://api-epayments-staging.back.finkargo.com.mx"
    else
        STRIPE_BASE_URL="https://api-testing.finkargo.com.mx/integrations"
        API_EPAYMENTS2="https://api-epayments-testing.back.finkargo.com.mx"
    fi
    NEWMAN_BASE_ARGS+=("--env-var" "services-integrations=${STRIPE_BASE_URL}")
    NEWMAN_BASE_ARGS+=("--env-var" "api-epayments2=${API_EPAYMENTS2}")
    log "Stripe base URL  : ${STRIPE_BASE_URL}"
    log "api-epayments2   : ${API_EPAYMENTS2}"

    # type y payment_method según flujo — usados en el body de {{api-epayments2}}/v1/mx/create-payment
    if [[ "$SCENARIO" == "stripe_card" ]]; then
        NEWMAN_BASE_ARGS+=("--env-var" "stripe_type=one_time" "--env-var" "stripe_payment_method=card")
    elif [[ "$SCENARIO" == "stripe_card_recurring" ]]; then
        NEWMAN_BASE_ARGS+=("--env-var" "stripe_type=recurring" "--env-var" "stripe_payment_method=card")
    elif [[ "$SCENARIO" == "stripe_oxxo" ]]; then
        NEWMAN_BASE_ARGS+=("--env-var" "stripe_type=one_time" "--env-var" "stripe_payment_method=oxxo")
    elif [[ "$SCENARIO" == "stripe_balance_recurring" ]]; then
        NEWMAN_BASE_ARGS+=("--env-var" "stripe_type=recurring" "--env-var" "stripe_payment_method=customer_balance")
    elif [[ "$SCENARIO" == "stripe_balance_one_time" ]]; then
        NEWMAN_BASE_ARGS+=("--env-var" "stripe_type=one_time" "--env-var" "stripe_payment_method=customer_balance")
    fi
    log "stripe_type            : $(echo "${NEWMAN_BASE_ARGS[@]}" | grep -o 'stripe_type=[^ ]*' | cut -d= -f2)"
    log "stripe_payment_method  : $(echo "${NEWMAN_BASE_ARGS[@]}" | grep -o 'stripe_payment_method=[^ ]*' | cut -d= -f2)"
fi

# Iteraciones para escenarios multi-step (reemplaza pm.setNextRequest, no soportado en Newman con --folder)
if [[ "$SCENARIO" == "expired" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "10")
    log "Expired flow: 10 iteraciones (EP-01→EP-02, VL-01→VL-03, NEG-01→NEG-05)"
elif [[ "$SCENARIO" == "stripe_oxxo" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe OXXO: 11 iteraciones"
elif [[ "$SCENARIO" == "stripe_card" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "21")
    log "Stripe Card one time: 21 iteraciones (13 EP/VL/NEG + 8 DEC declined)"
elif [[ "$SCENARIO" == "stripe_card_recurring" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe Card recurring: 11 iteraciones"
elif [[ "$SCENARIO" == "stripe_balance_recurring" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe Balance recurring: 11 iteraciones"
elif [[ "$SCENARIO" == "stripe_balance_one_time" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe Balance one time: 11 iteraciones"
elif [[ "$SCENARIO" == "stripe_card_epayments" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "21")
    log "Stripe Card one time epayments: 21 iteraciones (13 EP/VL/NEG + 8 DEC declined)"
elif [[ "$SCENARIO" == "stripe_card_recurring_epayments" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe Card recurring epayments: 11 iteraciones"
elif [[ "$SCENARIO" == "stripe_oxxo_epayments" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe OXXO one time epayments: 11 iteraciones"
elif [[ "$SCENARIO" == "stripe_balance_recurring_epayments" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe Balance recurring epayments: 11 iteraciones"
elif [[ "$SCENARIO" == "stripe_balance_one_time_epayments" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    log "Stripe Balance one time epayments: 11 iteraciones"
elif [[ "$SCENARIO" == "laft_reconsult" ]]; then
    case "${PAIS_INPUT}:${AMBIENTE}" in
        CO:Testing)  LAFT_COUNT=36;  LAFT_MONOLITO_BASE="https://msa-api-testing.back.finkargo.com" ;;
        CO:Staging)  LAFT_COUNT=36;  LAFT_MONOLITO_BASE="https://msa-api-staging.back.finkargo.com" ;;
        MX:Testing)  LAFT_COUNT=40;  LAFT_MONOLITO_BASE="https://msa-api-testing.back.finkargo.com.mx" ;;
        MX:Staging)  LAFT_COUNT=23;  LAFT_MONOLITO_BASE="https://msa-api-staging.back.finkargo.com.mx" ;;
        *)           LAFT_COUNT=36;  LAFT_MONOLITO_BASE="https://msa-api-testing.back.finkargo.com" ;;
    esac
    NEWMAN_BASE_ARGS+=("--iteration-count" "${LAFT_COUNT}")
    NEWMAN_BASE_ARGS+=("--env-var" "companyIndex=0")
    NEWMAN_BASE_ARGS+=("--env-var" "querySummary=[]")
    NEWMAN_BASE_ARGS+=("--env-var" "consumoLaft=[]")
    NEWMAN_BASE_ARGS+=("--env-var" "pais=${PAIS_INPUT}")
    NEWMAN_BASE_ARGS+=("--env-var" "ambiente=${AMBIENTE}")
    NEWMAN_BASE_ARGS+=("--env-var" "api-monolito=${LAFT_MONOLITO_BASE}")
    log "LAFT Reconsult: ${LAFT_COUNT} iteraciones | ${PAIS_INPUT}:${AMBIENTE} | monolito: ${LAFT_MONOLITO_BASE}"
elif [[ "$SCENARIO" == "vertice_happy_path" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    if [[ "$AMBIENTE" == "Staging" ]]; then
        VERTICE_BASE_URL="https://api-staging.finkargo.com/integrations"
    else
        VERTICE_BASE_URL="https://api-testing.finkargo.com/integrations"
    fi
    NEWMAN_BASE_ARGS+=("--env-var" "services-integrations=${VERTICE_BASE_URL}")
    log "Vertice base URL : ${VERTICE_BASE_URL}"
    log "Vertice Happy Path: 11 iteraciones — Create Insured + Crear Certificado Transporte"
elif [[ "$SCENARIO" == "vertice_cert_transporte" ]]; then
    NEWMAN_BASE_ARGS+=("--iteration-count" "11")
    if [[ "$AMBIENTE" == "Staging" ]]; then
        VERTICE_BASE_URL="https://api-staging.finkargo.com/integrations"
    else
        VERTICE_BASE_URL="https://api-testing.finkargo.com/integrations"
    fi
    NEWMAN_BASE_ARGS+=("--env-var" "services-integrations=${VERTICE_BASE_URL}")
    log "Vertice base URL : ${VERTICE_BASE_URL}"
    log "Vertice Crear Certificado Transporte: 11 iteraciones (EP-01→EP-03, VL-01→VL-03, NEG-01→NEG-05)"
elif [[ "$SCENARIO" == "upload_buro_mx" ]]; then
    if [[ "$AMBIENTE" == "Staging" ]]; then
        BURO_MONOLITO_BASE="https://msa-api-staging.back.finkargo.com.mx"
        BURO_INTEGRATIONS_MX="https://msa-integrations-mx-staging.back.finkargo.com.mx"
    else
        BURO_MONOLITO_BASE="https://msa-api-testing.back.finkargo.com.mx"
        BURO_INTEGRATIONS_MX="https://msa-integrations-mx-testing.back.finkargo.com.mx"
    fi
    NEWMAN_BASE_ARGS+=("--iteration-count" "34")
    NEWMAN_BASE_ARGS+=("--env-var" "rfcIndex=0")
    NEWMAN_BASE_ARGS+=("--env-var" "querySummary=[]")
    NEWMAN_BASE_ARGS+=("--env-var" "consumoBuro=[]")
    NEWMAN_BASE_ARGS+=("--env-var" "api-monolito=${BURO_MONOLITO_BASE}")
    NEWMAN_BASE_ARGS+=("--env-var" "api-integrations-mx=${BURO_INTEGRATIONS_MX}")
    NEWMAN_BASE_ARGS+=("--working-dir" "${SCRIPTS_DIR}/data")
    log "Upload Buro MX: 35 iteraciones | monolito: ${BURO_MONOLITO_BASE} | integrations-mx: ${BURO_INTEGRATIONS_MX} | working-dir: ${SCRIPTS_DIR}/data"
elif [[ "$SCENARIO" == "common_nit_dates" || "$SCENARIO" == "sarlaft_last_date" ]]; then
    if [[ "$AMBIENTE" == "Staging" ]]; then
        NIT_DATES_MONOLITO="https://msa-api-staging.back.finkargo.com"
    else
        NIT_DATES_MONOLITO="https://msa-api-testing.back.finkargo.com"
    fi
    NEWMAN_BASE_ARGS+=("--iteration-count" "36")
    NEWMAN_BASE_ARGS+=("--env-var" "nitDatesIndex=0")
    NEWMAN_BASE_ARGS+=("--env-var" "nitDatesSummary=[]")
    NEWMAN_BASE_ARGS+=("--env-var" "consumoDates=[]")
    NEWMAN_BASE_ARGS+=("--env-var" "nit=0")
    NEWMAN_BASE_ARGS+=("--env-var" "api-monolito=${NIT_DATES_MONOLITO}")
    log "${SCENARIO}: 36 iteraciones | monolito: ${NIT_DATES_MONOLITO}"
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
    # Usar UID directo para folders con nombres duplicados (evita ambigüedad en Newman)
    if [[ "$SCENARIO" == "stripe_balance_one_time" ]]; then
        NEWMAN_FOLDER="e0d59532-aa3b-40ad-89a7-196d2874ba35"
        log "Iniciando Newman | Folder UID: '$NEWMAN_FOLDER' (stripe_balance_one_time) | Pais: $PAIS_INPUT"
    elif [[ "$SCENARIO" == "stripe_balance_one_time_epayments" ]]; then
        NEWMAN_FOLDER="b2154d80-2628-4ade-8c7f-75abe9800a5d"
        log "Iniciando Newman | Folder UID: '$NEWMAN_FOLDER' (stripe_balance_one_time_epayments) | Pais: $PAIS_INPUT"
    else
        log "Iniciando Newman | Folder: '$NEWMAN_FOLDER' | Pais: $PAIS_INPUT"
    fi

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
elif [[ "$SCENARIO" == "stripe_oxxo" || "$SCENARIO" == "stripe_oxxo_epayments" ]]; then
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "stripe_oxxo" || true
elif [[ "$SCENARIO" == "rejected" ]]; then
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "rejected" || true
elif [[ "$SCENARIO" == "stripe_card" || "$SCENARIO" == "stripe_card_recurring" ]]; then
    [[ "$SCENARIO" == "stripe_card_recurring" ]] && export STRIPE_PAYMENT_TYPE="recurring" || export STRIPE_PAYMENT_TYPE="one_time"
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "stripe_card" || true
    # ── Escenarios de tarjeta rechazada (DEC-01 a DEC-08) — solo one_time ─────
    if [[ "$SCENARIO" == "stripe_card" ]]; then
        log "🚫 Ejecutando escenarios declined card (DEC-01 a DEC-08)..."
        NEWMAN_ENV_FILE="$ENV_EXPORT" SCRIPTS_DIR="$SCRIPTS_DIR" CI="true" \
            node "$SCRIPTS_DIR/playwright/run_stripe_declined_scenarios.js" \
            || log_warn "Declined card scenarios terminaron con errores (no bloquea el pipeline)"
    fi
elif [[ "$SCENARIO" == "stripe_card_epayments" ]]; then
    export STRIPE_PAYMENT_TYPE="one_time"
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "stripe_card" || true
    log "Ejecutando escenarios declined card epayments (DEC-01 a DEC-08)..."
    NEWMAN_ENV_FILE="$ENV_EXPORT" SCRIPTS_DIR="$SCRIPTS_DIR" CI="true" \
        node "$SCRIPTS_DIR/playwright/run_stripe_declined_scenarios.js" \
        || log_warn "Declined card scenarios epayments terminaron con errores (no bloquea el pipeline)"
elif [[ "$SCENARIO" == "stripe_card_recurring_epayments" ]]; then
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "stripe_card_recurring" || true
elif [[ "$SCENARIO" == "stripe_balance_recurring" || "$SCENARIO" == "stripe_balance_recurring_epayments" ]]; then
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "stripe_balance" || true
elif [[ "$SCENARIO" == "stripe_balance_one_time" || "$SCENARIO" == "stripe_balance_one_time_epayments" ]]; then
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "stripe_balance_onetime" || true
elif [[ "$NEWMAN_FOLDER" == "Happy path integration" ]]; then
    log "Escenario SUPRA INTEGRATION — Playwright para cada happy path link..."
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "supra_integration" || true
elif [[ "$SCENARIO" == "supra_epayments" || "$SCENARIO" == "epayments_happy" ]]; then
    log "Escenario SUPRA EPAYMENTS — Playwright para cada happy path link..."
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" "supra_integration" || true
elif [[ "$SCENARIO" == "cobre_happy" || "$SCENARIO" == "cobre_fondos_insuficientes" ]]; then
    log "Cobre — sin Playwright."
else
    bash "$SCRIPTS_DIR/playwright/run_playwright.sh" "$ENV_EXPORT" "$SCRIPTS_DIR" || true
fi

# ----------------------------------------------------------
# 7.55 COBRE FASE 2 — Inyectar cobre_movement_id + payment notification
# ----------------------------------------------------------
if [[ "$SCENARIO" == "cobre_happy" ]]; then
    log "Cobre Fase 2: consultando cobre_movement_id en BD ${PAIS_INPUT}/${AMBIENTE}..."
    python3 "$HELPERS_DIR/cobre_db_inject.py" "$ENV_EXPORT" "$PAIS_INPUT" "$AMBIENTE" || {
        log_warn "cobre_db_inject: no se pudo inyectar cobre_movement_id. El payment notification puede fallar."
    }

    log "Iniciando Newman Cobre Fase 2 | Folder: 'payment notification' | Pais: $PAIS_INPUT"
    JSON_REPORT_COBRE_P2="$SCRIPTS_DIR/results_cobre_phase2.json"
    HTML_NEWMAN_COBRE_P2="$SCRIPTS_DIR/reporte_cobre_phase2.html"
    ENV_EXPORT_COBRE_P2="$SCRIPTS_DIR/environment_export_cobre_phase2.json"
    set +e
    newman run "$COLLECTION_URL" \
        --environment "$ENV_EXPORT" \
        --insecure \
        -r cli,json,htmlextra \
        --reporter-json-export      "$JSON_REPORT_COBRE_P2" \
        --reporter-htmlextra-export "$HTML_NEWMAN_COBRE_P2" \
        --export-environment        "$ENV_EXPORT_COBRE_P2" \
        --suppress-exit-code \
        --timeout-request 30000 \
        --timeout-script  10000 \
        --folder "payment notification" \
        --reporter-htmlextra-title "QA Audit | Cobre payment notification | $PAIS_INPUT | $AMBIENTE | $NOW" \
        2>&1 | tee -a "$LOG_FILE"
    NEWMAN_COBRE_P2_EXIT=${PIPESTATUS[0]}
    set -e
    log "Newman Cobre Fase 2 exit code: $NEWMAN_COBRE_P2_EXIT"
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

# Escenario EXPIRED: esperar 34 minutos para que el proveedor expire la transacción
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
        log "Esperando 34 minutos para que el proveedor expire la transacción automáticamente..."
        sleep 2040
        log "Espera finalizada. Procediendo a validar estado en BD..."
    else
        log_warn "No se encontró payin_id en el environment export."
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
SEARCH_RAW=$(curl -s --insecure -w "\nHTTP_CODE:%{http_code}" -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL")
SEARCH_HTTP=$(echo "$SEARCH_RAW" | grep "HTTP_CODE:" | cut -d: -f2)
SEARCH_RES=$(echo "$SEARCH_RAW" | grep -v "HTTP_CODE:")
log "Confluence HTTP status: $SEARCH_HTTP"
log "Confluence response: ${SEARCH_RES:0:200}"
if [[ "$SEARCH_HTTP" != "200" ]]; then
    log_err "Error conectando a Confluence (HTTP $SEARCH_HTTP)."
    log_err "URL intentada: $SEARCH_URL"
    log_err "Verifica CONF_USER ('${CONF_USER}') y CONF_TOKEN (${#CONF_TOKEN} chars)."
    exit 1
fi

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
