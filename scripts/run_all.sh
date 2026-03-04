#!/bin/bash

# ==========================================
# 1. LÓGICA DE EJECUCIÓN Y PARÁMETROS
# ==========================================
PROYECTO=$1        
PAIS_INPUT=$2      
AMBIENTE=$3  

# Localización dinámica: detecta la carpeta real del script
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"

echo "📍 Validando entorno de ejecución..."
echo "🔎 Buscando configuración en: $CONFIG_PATH"

# ✅ Verificación física del archivo antes de iniciar
if [ ! -f "$CONFIG_PATH" ]; then
    echo "❌ ERROR: No se encontró el archivo collections.json en la ruta esperada."
    echo "📂 Contenido de la carpeta scripts:"
    ls -R "$SCRIPTS_DIR"
    exit 1
fi

# ✅ Validación de parámetros iniciales
if [ -z "$PROYECTO" ] || [ -z "$PAIS_INPUT" ] || [ -z "$AMBIENTE" ]; then
    echo "❌ Uso: ./run_all.sh <PROYECTO> <PAIS> <AMBIENTE>"
    exit 1
fi

EXEC_NUM="${GITHUB_RUN_NUMBER:-1}"
UNIQUE_ID=$(date +'%H%M%S') 

# Lógica para ejecución GLOBAL (ALL)
if [[ "$PAIS_INPUT" == "ALL" ]]; then
    echo "🌍 INICIANDO AUDITORÍA GLOBAL [$PROYECTO] [$AMBIENTE]"
    for p in "CO" "MX"; do
        bash "$0" "$PROYECTO" "$p" "$AMBIENTE" "$EXEC_NUM"
        sleep 10
    done
    exit 0
fi

if [ ! -z "$4" ]; then EXEC_NUM=$4; fi

# ==========================================
# 2. CONFIGURACIÓN DINÁMICA (JSON + PYTHON)
# ==========================================

# Función blindada para leer JSON con soporte UTF-8 (Emojis)
get_config() {
    python3 -c "
import json, sys, os
try:
    with open('$CONFIG_PATH', encoding='utf-8') as f:
        data = json.load(f)
    proyecto = '$1'
    key = '$2'
    campo = '$3'
    if campo == 'id':
        print(data[proyecto]['collection_id'])
    else:
        print(data[proyecto]['folders'][key])
except Exception as e:
    sys.exit(1)
"
}

COLLECTION_UID=$(get_config "$PROYECTO" "$PAIS_INPUT" "id")
FOLDER_NAME=$(get_config "$PROYECTO" "$PAIS_INPUT" "folder")

if [ -z "$COLLECTION_UID" ] || [ -z "$FOLDER_NAME" ]; then
    echo "❌ ERROR: No se encontró la configuración para $PROYECTO / $PAIS_INPUT"
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

PAIS=$PAIS_INPUT
NOW=$(date +'%Y-%m-%d %H:%M:%S')
LOG_FILE="$SCRIPTS_DIR/log_${PAIS}_${PROYECTO}.txt"
JSON_REPORT="$SCRIPTS_DIR/results_${PAIS}_${PROYECTO}.json"
HTML_REPORT="$SCRIPTS_DIR/report_${PAIS}_${PROYECTO}.html"
TITLE="[$PROYECTO][#$EXEC_NUM] Audit [$AMBIENTE][$PAIS] - $NOW"

# ==========================================
# 3. EJECUCIÓN SECUENCIAL NEWMAN
# ==========================================

# --- FASE 1: Carpeta del País ---
echo "🚀 [FASE 1] Ejecutando País: $FOLDER_NAME"
newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
  -e "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
  --folder "$FOLDER_NAME" --insecure -r cli,json,htmlextra \
  --reporter-json-export "$JSON_REPORT" --reporter-htmlextra-export "$HTML_REPORT" | tee "$LOG_FILE"

# --- FASE 2 y 3: Verification y Cross (Solo para CORE) ---
if [ "$PROYECTO" == "CORE" ]; then
    # Fase 2: Verification
    FOLDER_VERIF=$(get_config "CORE" "VERIF" "folder")
    echo "🔍 [FASE 2] Iniciando Verifications ($FOLDER_VERIF)..."
    newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
      -e "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
      --folder "$FOLDER_VERIF" --insecure -r cli,json \
      --reporter-json-export "$SCRIPTS_DIR/results_verif.json" | tee -a "$LOG_FILE"

    # Fase 3: Cross
    FOLDER_CROSS=$(get_config "CORE" "CROSS" "folder")
    echo "🌎 [FASE 3] Iniciando Cross-Entity ($FOLDER_CROSS)..."
    newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
      -e "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
      --folder "$FOLDER_CROSS" --insecure -r cli,json \
      --reporter-json-export "$SCRIPTS_DIR/results_cross.json" | tee -a "$LOG_FILE"

    # Unificar fallos para el análisis de Claude
    python3 -c "
import json, os
files = ['$JSON_REPORT', '$SCRIPTS_DIR/results_verif.json', '$SCRIPTS_DIR/results_cross.json']
try:
    with open(files[0], 'r') as f: main = json.load(f)
    for f_path in files[1:]:
        if os.path.exists(f_path):
            with open(f_path, 'r') as f:
                extra = json.load(f)
                main['run']['failures'].extend(extra.get('run', {}).get('failures', []))
    with open(files[0], 'w') as f: json.dump(main, f)
except Exception: pass
"
fi

# ==========================================
# 4. ANÁLISIS AGÉNTICO CON CLAUDE
# ==========================================
echo "🤖 Analizando fallos con Claude AI..."
FAILED_DATA=$(python3 -c "import json, os; 
if os.path.exists('$JSON_REPORT'):
    d=json.load(open('$JSON_REPORT')); 
    print(json.dumps(d['run']['failures']))
else:
    print('[]')")

if [ -z "$FAILED_DATA" ] || [ "$FAILED_DATA" == "[]" ]; then
    AI_RCA="<p style='color:green;'>✅ Auditoría Exitosa: Todas las fases pasaron correctamente.</p>"
else
    echo "$FAILED_DATA" > /tmp/failed_data.json
    AI_RCA=$(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python3 << 'PYEOF'
import json, subprocess, os, re
api_key = os.environ.get("ANTHROPIC_API_KEY", "")
try:
    with open("/tmp/failed_data.json", "r") as f: failed_data = json.load(f)
except: failed_data = []

fallos = []
for i, f in enumerate(failed_data, 1):
    req = f.get('source', {}).get('name', 'N/A')
    msg = f.get('error', {}).get('message', 'N/A')
    code = re.search(r'got (\d{3})', msg)
    code = code.group(1) if code else 'N/A'
    fallos.append({"num": i, "req": req, "msg": msg, "code": code})

rows_resumen = "".join([f"<tr><td>{f['num']}</td><td>{f['req']}</td><td>{f['msg']}</td><td>{f['code']}</td></tr>" for f in fallos])
prompt = f"Analiza estos fallos de API y responde SOLO con un array JSON: [{{'num':1,'causa':'...','accion':'...'}}]. Fallos:\n{json.dumps(fallos)}"

body = json.dumps({"model": "claude-3-5-sonnet-20240620", "max_tokens": 1024, "messages": [{"role": "user", "content": prompt}]})
result = subprocess.run(["curl", "-s", "https://api.anthropic.com/v1/messages", "-H", f"x-api-key: {api_key}", "-H", "anthropic-version: 2023-06-01", "-H", "content-type: application/json", "-d", body], capture_output=True, text=True)

rows_rca = ""
try:
    res_json = json.loads(result.stdout)
    rca_list = json.loads(re.search(r'\[.*\]', res_json["content"][0]["text"], re.DOTALL).group())
    for r in rca_list:
        rows_rca += f"<tr><td>{r['num']}</td><td>{r['causa']}</td><td>{r['accion']}</td></tr>"
except: rows_rca = "<tr><td colspan='3'>Error en análisis AI</td></tr>"

print(f'<h4>Resumen de Fallos</h4><table><thead><tr><th>#</th><th>Request</th><th>Mensaje</th><th>Código</th></tr></thead><tbody>{rows_resumen}</tbody></table><h4>🔍 Análisis Claude AI</h4><table><thead><tr><th>#</th><th>Causa Raíz</th><th>Acción Sugerida</th></tr></thead><tbody>{rows_rca}</tbody></table>')
PYEOF
)
fi

# ==========================================
# 5. PUBLICACIÓN EN CONFLUENCE
# ==========================================
SUMMARY_CLI=$(sed -n '/┌/,/┘/p' "$LOG_FILE" | tr -d '\r' | sed 's/"/\\"/g' | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
HTML_BODY="<h2>📊 Reporte Auditoría Unificada</h2>$AI_RCA<ac:structured-macro ac:name='code'><ac:plain-text-body><![CDATA[$SUMMARY_CLI]]></ac:plain-text-body></ac:structured-macro>"

PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 'ancestors': [{'id': sys.argv[3]}], 'body': {'storage': {'value': sys.argv[4], 'representation': 'storage'}}}))" "$TITLE" "$SPACE_KEY" "$PARENT_PAGE_ID" "$HTML_BODY")

echo "📤 Publicando en Confluence..."
CREATE_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$CONF_BASE_URL/rest/api/content")
PAGE_ID=$(echo "$CREATE_RES" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")

if [ ! -z "$PAGE_ID" ] && [ "$PAGE_ID" != "" ] && [ "$PAGE_ID" != "None" ]; then
    curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H "X-Atlassian-Token: no-check" -F "file=@$HTML_REPORT" "$CONF_BASE_URL/rest/api/content/$PAGE_ID/child/attachment" > /dev/null
    echo "✅ Publicado con éxito: $TITLE"
else
    echo "❌ Error de Publicación."
    echo "$CREATE_RES" | python3 -m json.tool
fi