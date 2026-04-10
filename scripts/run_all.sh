#!/bin/bash

# ==========================================
# 1. LÓGICA DE EJECUCIÓN Y PARÁMETROS
# ==========================================
PROYECTO=$1
FOLDER_OVERRIDE=$2  # El input de GitHub: "01-Register Company", "Suppliers", etc.
PAIS_INPUT=$3        # CO, MX, ALL
AMBIENTE=$4         # Testing, Staging

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"
DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/scenarios.json"

[ ! -f "$CONFIG_PATH" ] && { echo "❌ ERROR: No se encontró $CONFIG_PATH"; exit 1; }

EXEC_NUM="${GITHUB_RUN_NUMBER:-1}"
NOW=$(date +'%Y-%m-%d %H:%M:%S')

# ==========================================
# 2. CONFIGURACIÓN DINÁMICA (PYTHON HELPERS)
# ==========================================
get_config() {
    python3 -c "
import json, sys
try:
    with open('$CONFIG_PATH', encoding='utf-8') as f:
        data = json.load(f)
    if '$3' == 'id': print(data['$1']['collection_id'])
    elif '$3' == 'all_folders': print('\n'.join(data['$1']['folders'].values()))
    else: print(data['$1']['folders'].get('$2', ''))
except Exception as e:
    sys.exit(1)
"
}

COLLECTION_UID=$(get_config "$PROYECTO" "$PAIS_INPUT" "id")

# IDs de Entornos (Mapping de Finkargo)
if [ "$PAIS_INPUT" == "CO" ] || [ "$FOLDER_OVERRIDE" == "Suppliers" ]; then
    if [ "$AMBIENTE" == "Staging" ]; then
        ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf"
    else
        ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933"
    fi
else
    if [ "$AMBIENTE" == "Staging" ]; then
        ENV_UID="19103266-8187ac0e-07bd-497d-a228-fefdeec90492"
    else
        ENV_UID="19456853-52efb174-794f-4837-a1bf-fc913c9b0f10"
    fi
fi

# Configuración Confluence
CONF_USER="andres.navia@finkargo.com"
CONF_BASE_URL="https://finkargo.atlassian.net/wiki"
SPACE_KEY="QA" 

# ==========================================
# 3. EJECUCIÓN NEWMAN (FIX HTMLEXTRA MATCH)
# ==========================================
rm -f "$SCRIPTS_DIR"/results_final.json "$SCRIPTS_DIR"/reporte_visual_newman.html
JSON_REPORT="$SCRIPTS_DIR/results_final.json"
HTML_NEWMAN="$SCRIPTS_DIR/reporte_visual_newman.html"
LOG_FILE="$SCRIPTS_DIR/log_${PROYECTO}.txt"

DATA_PARAM=""
[ -f "$DATA_FILE" ] && DATA_PARAM="-d \"$DATA_FILE\""

# Lógica de Carpeta (Si no hay override, busca en config)
if [ -n "$FOLDER_OVERRIDE" ]; then
    FOLDER_NAME="$FOLDER_OVERRIDE"
else
    FOLDER_NAME=$(get_config "$PROYECTO" "$PAIS_INPUT" "")
fi

# Construir flags de carpeta
if [ "$PAIS_INPUT" == "ALL" ]; then
    FOLDER_CO=$(get_config "$PROYECTO" "CO" "")
    FOLDER_MX=$(get_config "$PROYECTO" "MX" "")
    FOLDER_FLAGS="--folder \"$FOLDER_CO\" --folder \"$FOLDER_MX\""
    echo "🚀 Iniciando Newman (ALL): $FOLDER_CO + $FOLDER_MX"
else
    FOLDER_FLAGS="--folder \"$FOLDER_NAME\""
    echo "🚀 Iniciando Newman para Folder: $FOLDER_NAME con Env UID: $ENV_UID"
fi

# EJECUCIÓN NEWMAN
# --reporter-htmlextra-title previene el error 'match' de htmlextra
eval newman run "\"https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY\"" \
  --environment "\"https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY\"" \
  $FOLDER_FLAGS $DATA_PARAM --insecure -r cli,json,htmlextra \
  --reporter-json-export "\"$JSON_REPORT\"" \
  --reporter-htmlextra-export "\"$HTML_NEWMAN\"" \
  --reporter-htmlextra-title "\"Audit Report - $FOLDER_NAME - $NOW\"" \
  --suppress-exit-code | tee "$LOG_FILE"

# ==========================================
# 4. ANÁLISIS AGÉNTICO CON CLAUDE
# ==========================================
echo "🤖 Analizando resultados con Claude 3.5 Sonnet..."
FAILED_DATA_FILE="$SCRIPTS_DIR/failed_data_debug.json"
CLAUDE_REPORT_FILE="$SCRIPTS_DIR/claude_report.html"

# Extraer fallos del JSON
python3 -c "
import json, os
try:
    if os.path.exists('$JSON_REPORT'):
        with open('$JSON_REPORT', 'r') as f:
            data = json.load(f)
        failures = data.get('run', {}).get('failures', [])
        with open('$FAILED_DATA_FILE', 'w') as f:
            json.dump(failures, f)
        print(f'✅ Fallos encontrados: {len(failures)}')
    else:
        print('⚠️ No se encontró el archivo JSON de Newman.')
except Exception as e:
    print(f'❌ Error procesando JSON: {e}')
"

# Llamada a Claude vía Python
export ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
export FAILED_DATA_PATH="$FAILED_DATA_FILE"

python3 << 'PYEOF'
import json, subprocess, os, re

def call_claude(api_key, prompt):
    payload = {
        "model": "claude-3-5-sonnet-20240620",
        "max_tokens": 4000,
        "messages": [{"role": "user", "content": prompt}]
    }
    res = subprocess.run([
        "curl", "-s", "https://api.anthropic.com/v1/messages",
        "-H", f"x-api-key: {api_key}",
        "-H", "anthropic-version: 2023-06-01",
        "-H", "content-type: application/json",
        "-d", json.dumps(payload)
    ], capture_output=True, text=True)
    return res.stdout

api_key = os.environ.get("ANTHROPIC_API_KEY")
failed_path = os.environ.get("FAILED_DATA_PATH")

try:
    if not os.path.exists(failed_path):
        html = "<p>⚠️ No hay datos de fallos para analizar.</p>"
    else:
        with open(failed_path, "r") as f:
            failures = json.load(f)

        if not failures:
            html = "<div style='background: #e8f5e9; padding: 15px; border-radius: 5px; color: #2e7d32;'><b>✅ Auditoría Exitosa:</b> Todos los escenarios pasaron las validaciones de seguridad y contrato.</div>"
        else:
            clean_failures = []
            for f in failures:
                clean_failures.append({
                    "escenario": f.get('source', {}).get('name', 'N/A'),
                    "error": f.get('error', {}).get('message', 'N/A'),
                    "url": f.get('source', {}).get('request', {}).get('url', {}).get('raw', 'N/A')
                })

            prompt = f"Actúa como Auditor Senior de QA. Analiza estos fallos en Finkargo: {json.dumps(clean_failures)}. Genera un reporte técnico en HTML (solo el div) con tabla de: Escenario, Hallazgo, Impacto y Acción. Usa estilos inline profesionales."
            
            response_raw = call_claude(api_key, prompt)
            response_json = json.loads(response_raw)
            
            if "content" in response_json:
                html = response_json["content"][0]["text"]
                html = re.sub(r'```html|```', '', html).strip()
            else:
                html = f"<p>⚠️ Error de IA: {response_json.get('error', {}).get('message', 'Unknown')}</p>"

    with open("claude_report.html", "w") as f:
        f.write(html)
except Exception as e:
    with open("claude_report.html", "w") as f:
        f.write(f"<p>❌ Error en análisis de IA: {str(e)}</p>")
PYEOF

# ==========================================
# 5. PUBLICACIÓN EN CONFLUENCE
# ==========================================
echo "📤 Publicando en Confluence..."
[[ "$AMBIENTE" == "Staging" ]] && AMBIENTE_PARENT_ID="2217115649" || AMBIENTE_PARENT_ID="2216984577"
FOLDER_TITLE="Auditorías $AMBIENTE - $PROYECTO"
TITLE="[$PROYECTO] Audit [$FOLDER_NAME] - Run $EXEC_NUM"

# Lógica de búsqueda de carpeta padre...
SEARCH_URL="${CONF_BASE_URL}/rest/api/content?title=${FOLDER_TITLE// /%20}&spaceKey=${SPACE_KEY}"
SEARCH_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL")
PROJECT_FOLDER_ID=$(echo "$SEARCH_RES" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['results'][0]['id'] if data['results'] else '')")

if [ -z "$PROJECT_FOLDER_ID" ] || [ "$PROJECT_FOLDER_ID" == "" ]; then
    PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 'ancestors': [{'id': sys.argv[3]}], 'body': {'storage': {'value': '<ac:structured-macro ac:name=\"children\" />', 'representation': 'storage'}}}))" "$FOLDER_TITLE" "$SPACE_KEY" "$AMBIENTE_PARENT_ID")
    PROJECT_FOLDER_ID=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$CONF_BASE_URL/rest/api/content" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")
fi

CLEAN_AI_RCA=$( [ -f "claude_report.html" ] && cat claude_report.html || echo "<p>✅ Sin fallos detectados.</p>" )
SUMMARY_CLI=$(cat "$LOG_FILE" | tr -d '\r' | sed 's/"/\\"/g' | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
HTML_BODY="<h2>📊 Reporte Auditoría</h2>$CLEAN_AI_RCA<br/><h3>💻 Consola</h3><ac:structured-macro ac:name='code'><ac:plain-text-body><![CDATA[$SUMMARY_CLI]]></ac:plain-text-body></ac:structured-macro>"

FINAL_PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 'ancestors': [{'id': sys.argv[3]}], 'body': {'storage': {'value': sys.argv[4], 'representation': 'storage'}}}))" "$TITLE" "$SPACE_KEY" "$PROJECT_FOLDER_ID" "$HTML_BODY")
RESPONSE_PUB=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$FINAL_PAYLOAD" "$CONF_BASE_URL/rest/api/content")

NEW_PAGE_ID=$(echo "$RESPONSE_PUB" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")

# ==========================================
# 6. ADJUNTAR REPORTE HTML
# ==========================================
if [ -n "$NEW_PAGE_ID" ] && [ "$NEW_PAGE_ID" != "" ] && [ -f "$HTML_NEWMAN" ]; then
    echo "📎 Adjuntando reporte htmlextra..."
    curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H "X-Atlassian-Token: nocheck" \
         -F "file=@$HTML_NEWMAN" "$CONF_BASE_URL/rest/api/content/$NEW_PAGE_ID/attachments"
    echo "✅ Finalizado con éxito."
else
    echo "⚠️ Fallo al publicar o adjuntar archivo."
fi
