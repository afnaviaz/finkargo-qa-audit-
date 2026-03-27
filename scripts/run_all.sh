#!/bin/bash

# ==========================================
# 1. LÓGICA DE EJECUCIÓN Y PARÁMETROS
# ==========================================
PROYECTO=$1
PAIS_INPUT=$2
AMBIENTE=$3
FOLDER_OVERRIDE=$4

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"
DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/scenarios.json"

[ ! -f "$CONFIG_PATH" ] && { echo "❌ ERROR: No se encontró $CONFIG_PATH"; exit 1; }

EXEC_NUM="${GITHUB_RUN_NUMBER:-1}"
NOW=$(date +'%Y-%m-%d %H:%M:%S')

# ==========================================
# 2. CONFIGURACIÓN DINÁMICA
# ==========================================
get_config() {
    python3 -c "
import json, sys
try:
    with open('$CONFIG_PATH', encoding='utf-8') as f:
        data = json.load(f)
    if '$3' == 'id': print(data['$1']['collection_id'])
    elif '$3' == 'all_folders': print('\n'.join(data['$1']['folders'].values()))
    elif '$3' == 'multi_folder': print('true' if data['$1'].get('multi_folder', False) else 'false')
    elif '$3' == 'first_folder':
        folders = data['$1']['folders']
        print(list(folders.values())[0] if folders else '')
    else: print(data['$1']['folders'].get('$2', ''))
except: sys.exit(1)
"
}

COLLECTION_UID=$(get_config "$PROYECTO" "$PAIS_INPUT" "id")

# IDs de Entornos (Se mantiene tu ID de Testing CO: 19103266-4be86e2c-b894-4577-95c4-f4b827281933)
if [ "$PAIS_INPUT" == "CO" ] || [ "$PAIS_INPUT" == "Suppliers" ]; then
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
# 3. EJECUCIÓN NEWMAN (CON HTMLEXTRA Y FIX VARIABLES)
# ==========================================
rm -f "$SCRIPTS_DIR"/results_*.json "$SCRIPTS_DIR"/newman_report_*.html claude_report.html
JSON_REPORT="$SCRIPTS_DIR/results_final.json"
HTML_NEWMAN="$SCRIPTS_DIR/reporte_visual_newman.html"
LOG_FILE="$SCRIPTS_DIR/log_${PROYECTO}.txt"

DATA_PARAM=""
[ -f "$DATA_FILE" ] && DATA_PARAM="-d $DATA_FILE"

# Lógica para detectar el folder correcto (Prioridad absoluta a Suppliers si viene en el input)
if [ "$PAIS_INPUT" == "Suppliers" ] || [ "$FOLDER_OVERRIDE" == "Suppliers" ]; then
    FOLDER_NAME="Suppliers"
else
    FOLDER_NAME=$(get_config "$PROYECTO" "$PAIS_INPUT" "")
fi

echo "🚀 Iniciando Newman para Folder: $FOLDER_NAME con Env UID: $ENV_UID"

# Usamos la URL completa del environment para forzar la descarga y resolución de {{api_version}}
newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
  --environment "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
  --folder "$FOLDER_NAME" $DATA_PARAM --insecure -r cli,json,htmlextra \
  --reporter-json-export "$JSON_REPORT" \
  --reporter-htmlextra-export "$HTML_NEWMAN" \
  --suppress-exit-code | tee "$LOG_FILE"

#!/bin/bash

# ... [Secciones 1, 2 y 3 se mantienen iguales] ...

# ==========================================
# 4. ANÁLISIS AGÉNTICO CON CLAUDE
# ==========================================
echo "🤖 Analizando fallos con IA..."
FAILED_DATA_FILE="$SCRIPTS_DIR/failed_data_debug.json"
CLAUDE_REPORT_FILE="claude_report.html"

# Resetear reporte de la IA
echo "<p>⏳ Iniciando análisis de IA...</p>" > "$CLAUDE_REPORT_FILE"

# Extraemos fallos del reporte unificado
python3 -c "import json, os; 
if os.path.exists('$JSON_REPORT'):
    with open('$JSON_REPORT', 'r') as f:
        d=json.load(f)
    failures = d.get('run', {}).get('failures', [])
    with open('$FAILED_DATA_FILE', 'w') as f: json.dump(failures, f)
else:
    with open('$FAILED_DATA_FILE', 'w') as f: json.dump([], f)
"

# SOLO ejecutar Claude si hay fallos registrados
if [ -s "$FAILED_DATA_FILE" ] && [ "$(cat $FAILED_DATA_FILE)" != "[]" ]; then
    ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" FAILED_DATA_PATH="$FAILED_DATA_FILE" python3 << 'PYEOF'
import json, subprocess, os, re

def call_claude(api_key, model_id, prompt):
    payload = {
        "model": model_id, 
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
    try:
        return json.loads(res.stdout)
    except:
        return {"error": {"message": "Error decodificando respuesta de Anthropic"}}

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
failed_path = os.environ.get("FAILED_DATA_PATH")

try:
    with open(failed_path, "r") as f:
        failed_data = json.load(f)
    
    # Limpiamos los datos para enviarle a Claude solo lo importante (ahorro de tokens y claridad)
    fallos_puros = []
    for f in failed_data:
        assertion_text = f.get('at', 'N/A')
        fallos_puros.append({
            "request": f.get('source', {}).get('name', 'N/A'),
            "error": f.get('error', {}).get('message', 'N/A'),
            "test": assertion_text
        })

    prompt = f"Actúa como QA Lead Senior. Analiza estos fallos técnicos de Postman y genera un reporte HTML (solo el contenido interno de <div>) categorizando por Negocio, Estabilidad y Seguridad. Sé muy técnico y directo. FALLOS: {json.dumps(fallos_puros)}"

    # Usar el modelo correcto
    response = call_claude(api_key, "claude-3-5-sonnet-20240620", prompt)
    
    if "content" in response:
        html_content = response["content"][0]["text"]
        # Limpiar posibles bloques de código markdown
        html_content = re.sub(r'```html|```', '', html_content).strip()
        with open("claude_report.html", "w") as f:
            f.write(html_content)
    elif "error" in response:
        with open("claude_report.html", "w") as f:
            f.write(f"<p>⚠️ Error de API: {response['error'].get('message')}</p>")
except Exception as e:
    with open("claude_report.html", "w") as f:
        f.write(f"<p>⚠️ Error en script de análisis: {str(e)}</p>")
PYEOF
else
    echo "<p>✅ <b>Finkargo Audit:</b> No se detectaron fallos funcionales en esta corrida.</p>" > "$CLAUDE_REPORT_FILE"
fi

# ==========================================
# 5. PUBLICACIÓN EN CONFLUENCE
# ==========================================
echo "📤 Publicando página en Confluence..."
[[ "$AMBIENTE" == "Staging" ]] && AMBIENTE_PARENT_ID="2217115649" || AMBIENTE_PARENT_ID="2216984577"
FOLDER_TITLE="Auditorías $AMBIENTE - $PROYECTO"
TITLE="[$PROYECTO][#$EXEC_NUM] Audit [$AMBIENTE] - $NOW"

SEARCH_URL="${CONF_BASE_URL}/rest/api/content?title=${FOLDER_TITLE// /%20}&spaceKey=${SPACE_KEY}"
SEARCH_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL")
PROJECT_FOLDER_ID=$(echo "$SEARCH_RES" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['results'][0]['id'] if data['results'] else '')")

if [ -z "$PROJECT_FOLDER_ID" ] || [ "$PROJECT_FOLDER_ID" == "None" ]; then
    PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 'ancestors': [{'id': sys.argv[3]}], 'body': {'storage': {'value': '<ac:structured-macro ac:name=\"children\" />', 'representation': 'storage'}}}))" "$FOLDER_TITLE" "$SPACE_KEY" "$AMBIENTE_PARENT_ID")
    PROJECT_FOLDER_ID=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$CONF_BASE_URL/rest/api/content" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")
fi

CLEAN_AI_RCA=$( [ -f "claude_report.html" ] && cat claude_report.html || echo "<p>✅ Sin fallos detectados.</p>" )
SUMMARY_CLI=$(cat "$LOG_FILE" | tr -d '\r' | sed 's/"/\\"/g' | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
HTML_BODY="<h2>📊 Reporte Auditoría</h2>$CLEAN_AI_RCA<br/><h3>💻 Resumen CLI</h3><ac:structured-macro ac:name='code'><ac:plain-text-body><![CDATA[$SUMMARY_CLI]]></ac:plain-text-body></ac:structured-macro>"

FINAL_PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 'ancestors': [{'id': sys.argv[3]}], 'body': {'storage': {'value': sys.argv[4], 'representation': 'storage'}}}))" "$TITLE" "$SPACE_KEY" "$PROJECT_FOLDER_ID" "$HTML_BODY")
RESPONSE_PUB=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$FINAL_PAYLOAD" "$CONF_BASE_URL/rest/api/content")

# CAPTURAR ID DE LA NUEVA PÁGINA PARA ADJUNTAR EL HTML
NEW_PAGE_ID=$(echo "$RESPONSE_PUB" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")

# ==========================================
# 6. ADJUNTAR REPORTE VISUAL (HTMLEXTRA)
# ==========================================
if [ -n "$NEW_PAGE_ID" ] && [ "$NEW_PAGE_ID" != "None" ] && [ -f "$HTML_NEWMAN" ]; then
    echo "📎 Adjuntando reporte htmlextra a la página ID: $NEW_PAGE_ID"
    
    # Subir el archivo como adjunto a la página de Confluence
    curl -s -u "$CONF_USER:$CONF_TOKEN" \
         -X POST \
         -H "X-Atlassian-Token: nocheck" \
         -F "file=@$HTML_NEWMAN" \
         -F "comment=Reporte detallado Newman generado automáticamente" \
         "$CONF_BASE_URL/rest/api/content/$NEW_PAGE_ID/attachments" | python3 -m json.tool
    
    echo "✅ Todo finalizado. Revisa Confluence para ver el reporte y el adjunto."
else
    echo "⚠️ No se pudo adjuntar el reporte (Página no encontrada o archivo faltante)."
fi