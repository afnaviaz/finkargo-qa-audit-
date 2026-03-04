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
# 4. ANÁLISIS AGÉNTICO CON CLAUDE (MODO DEBUG)
# ==========================================
echo "🤖 Iniciando fase de análisis..."

FAILED_DATA_FILE="$SCRIPTS_DIR/failed_data_debug.json"
# Extraemos fallos asegurando que el JSON exista
python3 -c "import json, os; 
if os.path.exists('$JSON_REPORT'):
    d=json.load(open('$JSON_REPORT')); 
    failures = d.get('run', {}).get('failures', [])
    with open('$FAILED_DATA_FILE', 'w') as f: json.dump(failures, f)
    print(f'📊 Fallos detectados en JSON: {len(failures)}')
else:
    print('❌ ERROR: No se encontró el reporte results_final.json')"

if [ -s "$FAILED_DATA_FILE" ] && [ "$(cat $FAILED_DATA_FILE)" != "[]" ]; then
    echo "🧠 Solicitando RCA a Claude..."
    
    # Capturamos la salida y los errores por separado
    AI_RCA=$(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python3 << 'PYEOF'
import json, subprocess, os, re, sys

def log_debug(msg):
    print(f"DEBUG: {msg}", file=sys.stderr)

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
if not api_key:
    log_debug("ANTHROPIC_API_KEY está vacía.")
    print("<p style='color:red;'>⚠️ Error: API Key de Claude no encontrada en el entorno.</p>")
    sys.exit(0)

try:
    with open("failed_data_debug.json", "r") as f:
        failed_data = json.load(f)
except Exception as e:
    log_debug(f"Error leyendo JSON: {e}")
    sys.exit(0)

fallos = []
for i, f in enumerate(failed_data[:15], 1): # Limitamos a 15 para no saturar el prompt
    req = f.get('source', {}).get('name', 'N/A')
    msg = f.get('error', {}).get('message', 'N/A')
    code = re.search(r'got (\d{3})', msg).group(1) if re.search(r'got (\d{3})', msg) else 'N/A'
    fallos.append({"num": i, "req": req, "msg": msg, "code": code})

prompt = f"Eres un experto en QA. Analiza estos fallos de API y responde ÚNICAMENTE con un array JSON siguiendo este formato exacto: [{{'num':1,'causa':'descripción breve','accion':'qué arreglar'}}]. Fallos:\n{json.dumps(fallos)}"

payload = {
    "model": "claude-3-5-sonnet-20240620",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": prompt}]
}

# Llamada a la API
result = subprocess.run([
    "curl", "-s", "-w", "\n%{http_code}", "https://api.anthropic.com/v1/messages",
    "-H", f"x-api-key: {api_key}",
    "-H", "anthropic-version: 2023-06-01",
    "-H", "content-type: application/json",
    "-d", json.dumps(payload)
], capture_output=True, text=True)

# Separar el cuerpo del código de estado HTTP
output_lines = result.stdout.strip().split('\n')
http_status = output_lines[-1]
response_body = "\n".join(output_lines[:-1])

log_debug(f"HTTP Status: {http_status}")

if http_status != "200":
    log_debug(f"Error de API Claude: {response_body}")
    print(f"<p style='color:red;'>⚠️ Claude API Error (Status {http_status}). Revisa los logs de GitHub.</p>")
    sys.exit(0)

try:
    res_json = json.loads(response_body)
    raw_text = res_json["content"][0]["text"]
    log_debug(f"Texto recibido de Claude: {raw_text[:100]}...")
    
    # Extraer el JSON del texto por si Claude añade charla
    json_match = re.search(r'\[.*\]', raw_text, re.DOTALL)
    if json_match:
        rca_list = json.loads(json_match.group())
        rows = "".join([f"<tr><td>{r['num']}</td><td><b>{fallos[int(r['num'])-1]['req']}</b></td><td>{r['causa']}</td><td><code>{r['accion']}</code></td></tr>" for r in rca_list])
        print(f'<h4>🔍 Análisis de Causa Raíz (Claude AI)</h4><table border="1"><thead><tr><th>#</th><th>Request</th><th>Causa Raíz</th><th>Acción Sugerida</th></tr></thead><tbody>{rows}</tbody></table>')
    else:
        log_debug("No se encontró formato JSON en la respuesta.")
        print("<p>⚠️ Claude no devolvió un formato de análisis válido.</p>")
except Exception as e:
    log_debug(f"Error procesando respuesta: {e}")
    print(f"<p>Error procesando análisis: {e}</p>")
PYEOF
)
else
    AI_RCA="<p style='color:green;'>✅ Sin fallos detectados para analizar.</p>"
fi



# ==========================================
# 5. PUBLICACIÓN EN CONFLUENCE
# ==========================================
SUMMARY_CLI=$(sed -n '/┌/,/┘/p' "$LOG_FILE" | tr -d '\r' | sed 's/"/\\"/g' | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
HTML_BODY="<h2>📊 Reporte Consolidado [$PROYECTO]</h2>$AI_RCA<ac:structured-macro ac:name='code'><ac:plain-text-body><![CDATA[$SUMMARY_CLI]]></ac:plain-text-body></ac:structured-macro>"

PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 'ancestors': [{'id': sys.argv[3]}], 'body': {'storage': {'value': sys.argv[4], 'representation': 'storage'}}}))" "$TITLE" "$SPACE_KEY" "$PARENT_PAGE_ID" "$HTML_BODY")

echo "📤 Publicando reporte único en Confluence..."
curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$CONF_BASE_URL/rest/api/content" | python3 -m json.tool