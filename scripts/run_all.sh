#!/bin/bash

# ==========================================
# 1. LÓGICA DE EJECUCIÓN Y PARÁMETROS
# ==========================================
PROYECTO=$1        
PAIS_INPUT=$2      
AMBIENTE=$3  

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"

# ✅ Validación de existencia del archivo (Evita el FileNotFoundError)
if [ ! -f "$CONFIG_PATH" ]; then
    echo "❌ ERROR: No se encontró $CONFIG_PATH"
    echo "📂 Contenido de scripts/:"
    ls -R "$SCRIPTS_DIR"
    exit 1
fi

EXEC_NUM="${GITHUB_RUN_NUMBER:-1}"
UNIQUE_ID=$(date +'%H%M%S') 
NOW=$(date +'%Y-%m-%d %H:%M:%S')

# ==========================================
# 2. CONFIGURACIÓN DINÁMICA (JSON + PYTHON)
# ==========================================

get_config() {
    python3 -c "
import json, sys
try:
    with open('$CONFIG_PATH', encoding='utf-8') as f:
        data = json.load(f)
    if '$3' == 'id':
        print(data['$1']['collection_id'])
    elif '$3' == 'all_folders':
        print(' '.join(data['$1']['folders'].values()))
    else:
        print(data['$1']['folders']['$2'])
except Exception:
    sys.exit(1)
"
}

COLLECTION_UID=$(get_config "$PROYECTO" "$PAIS_INPUT" "id")

if [ -z "$COLLECTION_UID" ]; then
    echo "❌ ERROR: No se encontró la Collection ID para el proyecto: $PROYECTO"
    exit 1
fi

# IDs de Entornos de Postman
if [ "$PAIS_INPUT" == "CO" ]; then
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf" || ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933"
else
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19103266-8187ac0e-07bd-497d-a228-fefdeec90492" || ENV_UID="19456853-52efb174-794f-4837-a1bf-fc913c9b0f10"
fi

# Configuración Confluence
CONF_USER="andres.navia@finkargo.com"
CONF_BASE_URL="https://finkargo.atlassian.net/wiki"
SPACE_KEY="QA" 
[[ "$AMBIENTE" == "Testing" ]] && PARENT_PAGE_ID="2216984577" || PARENT_PAGE_ID="2217115649"

LOG_FILE="$SCRIPTS_DIR/log_${PROYECTO}.txt"
JSON_REPORT="$SCRIPTS_DIR/results_final.json"
HTML_REPORT="$SCRIPTS_DIR/report_final.html"
TITLE="[$PROYECTO][#$EXEC_NUM] Audit [$AMBIENTE] - $NOW"

# ==========================================
# 3. EJECUCIÓN SECUENCIAL NEWMAN
# ==========================================

# Limpiar reportes previos
rm -f "$SCRIPTS_DIR/results_*.json"

if [ "$PROYECTO" == "ms-auth" ]; then
    # --- MODO MULTI-CARPETA (ms-auth) ---
    FOLDERS=$(get_config "$PROYECTO" "" "all_folders")
    echo "🔐 Iniciando auditoría completa de MS-AUTH (Módulos: $FOLDERS)"
    
    for f in $FOLDERS; do
        echo "🚀 Ejecutando módulo: $f"
        newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
          -e "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
          --folder "$f" --insecure -r cli,json \
          --reporter-json-export "$SCRIPTS_DIR/results_${f}.json" | tee -a "$LOG_FILE"
    done
else
    # --- MODO PAÍS (CORE) ---
    FOLDER_NAME=$(get_config "$PROYECTO" "$PAIS_INPUT" "folder")
    echo "🚀 Ejecutando Carpeta: $FOLDER_NAME"
    newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
      -e "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
      --folder "$FOLDER_NAME" --insecure -r cli,json \
      --reporter-json-export "$JSON_REPORT" | tee "$LOG_FILE"
fi
# ==========================================
# 4. ANÁLISIS AGÉNTICO CON CLAUDE 4.6
# ==========================================
echo "🤖 Iniciando fase de análisis con Claude 4.6..."

FAILED_DATA_FILE="$SCRIPTS_DIR/failed_data_debug.json"

python3 -c "import json, os; 
if os.path.exists('$JSON_REPORT'):
    with open('$JSON_REPORT', 'r') as f: d = json.load(f)
    failures = d.get('run', {}).get('failures', [])
    with open('$FAILED_DATA_FILE', 'w') as f: json.dump(failures, f)
    print(f'📊 Fallos detectados: {len(failures)}')
"

if [ -f "$FAILED_DATA_FILE" ] && [ "$(cat $FAILED_DATA_FILE)" != "[]" ]; then
    echo "🧠 Generando RCA con Claude Sonnet 4.6..."
    
    AI_RCA=$(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" FAILED_DATA_PATH="$FAILED_DATA_FILE" python3 << 'PYEOF'
import json, subprocess, os, re, sys

def log_debug(msg):
    print(f"DEBUG: {msg}", file=sys.stderr)

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
failed_data_path = os.environ.get("FAILED_DATA_PATH")

try:
    with open(failed_data_path, "r") as f:
        failed_data = json.load(f)
except Exception as e:
    log_debug(f"Error archivo: {e}")
    sys.exit(0)

# Preparamos los fallos para el prompt
fallos = [{"n": i, "req": f.get('source', {}).get('name', 'N/A')[:50], "err": f.get('error', {}).get('message', 'N/A')[:100]} for i, f in enumerate(failed_data[:20], 1)]

# USAMOS EL MODELO claude-sonnet-4-6 DE TU LISTA
payload = {
    "model": "claude-sonnet-4-6",
    "max_tokens": 1500,
    "messages": [
        {
            "role": "user", 
            "content": f"Eres un experto Senior en QA. Analiza estos fallos de API de Finkargo y responde SOLO con un array JSON: [{{'num':1,'causa':'...','accion':'...'}}].\n\nFallos: {json.dumps(fallos)}"
        }
    ]
}

result = subprocess.run([
    "curl", "-s", "-w", "\n%{http_code}", "https://api.anthropic.com/v1/messages",
    "-H", f"x-api-key: {api_key}",
    "-H", "anthropic-version: 2023-06-01",
    "-H", "content-type: application/json",
    "-d", json.dumps(payload)
], capture_output=True, text=True)

output = result.stdout.strip().split('\n')
http_status = output[-1]
response_body = "\n".join(output[:-1])

log_debug(f"HTTP Status: {http_status}")

if http_status == "200":
    try:
        raw_text = json.loads(response_body)["content"][0]["text"]
        json_match = re.search(r'\[.*\]', raw_text, re.DOTALL)
        if json_match:
            rca_list = json.loads(json_match.group())
            rows = ""
            for r in rca_list:
                idx = int(r['num']) - 1
                name = fallos[idx]['req'] if idx < len(fallos) else "N/A"
                rows += f"<tr><td>{r['num']}</td><td><b>{name}</b></td><td>{r['causa']}</td><td>{r['accion']}</td></tr>"
            
            print(f'<h4>🔍 Análisis Inteligente (Claude 4.6)</h4><table border="1"><thead><tr><th>#</th><th>Request</th><th>Causa Raíz</th><th>Acción Sugerida</th></tr></thead><tbody>{rows}</tbody></table>')
    except Exception as e:
        log_debug(f"Error parseo: {e}")
        print("<p>⚠️ Error al procesar la respuesta de la IA.</p>")
else:
    log_debug(f"Error API: {response_body}")
    print(f"<p style='color:red;'>⚠️ Error de Claude API ({http_status}).</p>")
PYEOF
)
else
    AI_RCA="<p style='color:green;'>✅ Sin fallos detectados para analizar.</p>"
fi
# ==========================================
# 5. PUBLICACIÓN EN CONFLUENCE (VERSIÓN FIX)
# ==========================================
# 1. Limpiamos el resumen de la CLI para evitar que rompa el JSON
SUMMARY_CLI=$(sed -n '/┌/,/┘/p' "$LOG_FILE" | tr -d '\r' | sed 's/"/\\"/g' | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')

# 2. Aseguramos que AI_RCA sea una sola línea y no tenga caracteres extraños
# Esto evita que el JSON de envío sea inválido
CLEAN_AI_RCA=$(echo "$AI_RCA" | tr -d '\n' | tr -d '\r' | sed 's/"/\\"/g')

# 3. Construimos el HTML Body
HTML_BODY="<h2>📊 Reporte Auditoría Unificada</h2>$CLEAN_AI_RCA<br/><br/><h3>💻 Resumen de Ejecución</h3><ac:structured-macro ac:name='code'><ac:plain-text-body><![CDATA[$SUMMARY_CLI]]></ac:plain-text-body></ac:structured-macro>"

# 4. Generamos el PAYLOAD usando Python para asegurar un JSON perfecto
PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({
    'type': 'page', 
    'title': sys.argv[1], 
    'space': {'key': sys.argv[2]}, 
    'ancestors': [{'id': sys.argv[3]}], 
    'body': {'storage': {'value': sys.argv[4], 'representation': 'storage'}}
}))" "$TITLE" "$SPACE_KEY" "$PARENT_PAGE_ID" "$HTML_BODY")

echo "📤 Publicando reporte único en Confluence..."
CREATE_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$CONF_BASE_URL/rest/api/content")

# Verificamos si se publicó bien
PAGE_ID=$(echo "$CREATE_RES" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")

if [ ! -z "$PAGE_ID" ] && [ "$PAGE_ID" != "None" ]; then
    echo "✅ Reporte publicado con éxito. ID: $PAGE_ID"
    # Adjuntamos el reporte HTML de Newman
    curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H "X-Atlassian-Token: no-check" -F "file=@$HTML_REPORT" "$CONF_BASE_URL/rest/api/content/$PAGE_ID/child/attachment" > /dev/null
else
    echo "❌ Error al publicar en Confluence:"
    echo "$CREATE_RES" | python3 -m json.tool
fi