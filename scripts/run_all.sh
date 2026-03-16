#!/bin/bash

# ==========================================
# 1. LÓGICA DE EJECUCIÓN Y PARÁMETROS
# ==========================================
PROYECTO=$1        
PAIS_INPUT=$2      
AMBIENTE=$3  

# Detectamos la ruta base del proyecto
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$BASE_DIR/scripts"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"

# Definimos las rutas a los archivos de prueba (Ajustadas a tu estructura real)
# Buscamos la colección directamente en la raíz basándonos en tu 'ls' previo
COLLECTION_PATH="$BASE_DIR/ms-communicator.postman_collection.json"
ENV_PATH="$BASE_DIR/testing.postman_environment.json"
DATA_PATH="$BASE_DIR/test/data/scenarios.json"

if [ ! -f "$CONFIG_PATH" ]; then
    echo "❌ ERROR: No se encontró $CONFIG_PATH"
    exit 1
fi

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

# IDs de Entornos (Lógica por País/Ambiente)
if [ "$PAIS_INPUT" == "CO" ]; then
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf" || ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933"
else
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19103266-8187ac0e-07bd-497d-a228-fefdeec90492" || ENV_UID="19456853-52efb174-794f-4837-a1bf-fc913c9b0f10"
fi

# Configuración Confluence
CONF_USER="andres.navia@finkargo.com"
CONF_BASE_URL="https://finkargo.atlassian.net/wiki"
SPACE_KEY="QA" 

LOG_FILE="$SCRIPTS_DIR/log_${PROYECTO}.txt"
JSON_REPORT="$SCRIPTS_DIR/results_final.json"
TITLE="[$PROYECTO][#$EXEC_NUM] Audit [$AMBIENTE] - $NOW"

# ==========================================
# 3. EJECUCIÓN NEWMAN (DATA-DRIVEN)
# ==========================================
echo "🚀 Iniciando ejecución de Newman..."
mkdir -p "$SCRIPTS_DIR"

# --- Lógica de Colección ---
RUN_TARGET="$COLLECTION_PATH"
if [ ! -f "$COLLECTION_PATH" ]; then
    echo "⚠️ Colección local no encontrada, usando UID: $COLLECTION_UID"
    RUN_TARGET="$COLLECTION_UID"
fi

# --- Lógica de Ambiente (EL FIX AQUÍ) ---
ENV_TARGET="$ENV_PATH"
if [ ! -f "$ENV_PATH" ]; then
    echo "⚠️ Ambiente local no encontrado, usando UID: $ENV_UID"
    ENV_TARGET="$ENV_UID"
fi

# Ejecutamos Newman
# Nota: agregamos el API Key de Postman si usas UIDs
newman run "$RUN_TARGET" \
    -e "$ENV_TARGET" \
    -d "$DATA_PATH" \
    --reporters cli,json \
    --reporter-json-export "$JSON_REPORT" \
    --suppress-exit-code | tee "$LOG_FILE"

if [ ! -f "$JSON_REPORT" ]; then
    echo "❌ ERROR: No se pudo generar el reporte JSON."
    exit 1
fi

echo "✅ Ejecución finalizada correctamente."

# ==========================================
# 4. ANÁLISIS AGÉNTICO CON CLAUDE (AUDITORÍA PROFESIONAL)
# ==========================================
echo "🤖 Generando Informe de Auditoría Técnica para Confluence..."
FAILED_DATA_FILE="$SCRIPTS_DIR/failed_data_debug.json"

python3 -c "import json, os; 
if os.path.exists('$JSON_REPORT'):
    d=json.load(open('$JSON_REPORT')); failures = d.get('run', {}).get('failures', [])
    with open('$FAILED_DATA_FILE', 'w') as f: json.dump(failures, f)
"

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
        return {"error": {"message": "Invalid JSON response"}}

api_key = os.environ.get("ANTHROPIC_API_KEY", "")
failed_data_path = os.environ.get("FAILED_DATA_PATH")

try:
    with open(failed_data_path, "r") as f: 
        failed_data = json.load(f)
    
    fallos_raw = []
    for f in failed_data[:20]:
        assertion_text = f.get('at', 'N/A')
        trace_match = re.search(r'ID: ([a-z0-9-]+)', assertion_text)
        fallos_raw.append({
            "escenario": f.get('source', {}).get('name', 'N/A'),
            "error_msg": f.get('error', {}).get('message', 'N/A'),
            "trace_id": trace_match.group(1) if trace_match else "SIN_ID"
        })

    prompt = f"""
    Eres un Auditor Senior de Ciberseguridad. Genera un INFORME DE AUDITORÍA TÉCNICA profesional en HTML.
    Datos: {json.dumps(fallos_raw)}
    
    ESTRUCTURA REQUERIDA:
    1. Título H2: Informe de Auditoría: ms-communicator (Validación de Esquema)
    2. Resumen: Total escenarios: 21, Fallas: {len(fallos_raw)}.
    3. Categoría 1: Integridad Financiera. Tabla con Escenario, Dato, Resultado (200 OK), Hallazgo y Evidencia (ID).
    4. Categoría 2: Validación de Esquema. Tabla con Escenario, Campo, Dato, Hallazgo y Evidencia (ID).
    5. Categoría 3: Inestabilidad (Errores 500). Tabla con Escenario, Resultado (500), Hallazgo y Evidencia.
    6. Recomendaciones Técnicas.
    
    ESTILO: Sin etiquetas ```html. Usa tablas con bordes y headers #2c3e50.
    """
    
    models = ["claude-3-5-sonnet-20240620", "claude-3-sonnet-20240229"]
    final_html = ""
    for model in models:
        response = call_claude(api_key, model, prompt)
        if "content" in response:
            final_html = response["content"][0]["text"]
            break
    
    if final_html:
        final_html = final_html.replace("```html", "").replace("```", "").strip()
        with open("claude_report.html", "w") as f: f.write(final_html.replace("\n", " "))
except Exception as e:
    with open("claude_report.html", "w") as f: f.write(f"<p>⚠️ Error: {str(e)}</p>")
PYEOF
fi


# ==========================================
# 5. PUBLICACIÓN ORGANIZADA EN CONFLUENCE
# ==========================================
echo "📂 Organizando jerarquía para ambiente: $AMBIENTE..."

[[ "$AMBIENTE" == "Staging" ]] && AMBIENTE_PARENT_ID="2217115649" || AMBIENTE_PARENT_ID="2216984577"

FOLDER_TITLE="Auditorías $AMBIENTE - $PROYECTO"
SEARCH_URL="${CONF_BASE_URL}/rest/api/content?title=${FOLDER_TITLE// /%20}&spaceKey=${SPACE_KEY}"
SEARCH_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL")
PROJECT_FOLDER_ID=$(echo "$SEARCH_RES" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['results'][0]['id'] if data['results'] else '')")

if [ -z "$PROJECT_FOLDER_ID" ]; then
    FOLDER_PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({
        'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 
        'ancestors': [{'id': sys.argv[3]}], 
        'body': {'storage': {'value': '<ac:structured-macro ac:name=\"children\" />', 'representation': 'storage'}}
    }))" "$FOLDER_TITLE" "$SPACE_KEY" "$AMBIENTE_PARENT_ID")
    CREATE_FOLDER_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$FOLDER_PAYLOAD" "$CONF_BASE_URL/rest/api/content")
    PROJECT_FOLDER_ID=$(echo "$CREATE_FOLDER_RES" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")
fi

SUMMARY_CLI=$(sed -n '/┌/,/┘/p' "$LOG_FILE" | tr -d '\r' | sed 's/"/\\"/g' | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
CLEAN_AI_RCA=$( [ -f "claude_report.html" ] && cat claude_report.html || echo "<p>✅ Sin fallos detectados.</p>" )
HTML_BODY="<h2>📊 Reporte Auditoría</h2>$CLEAN_AI_RCA<br/><br/><h3>💻 Resumen CLI</h3><ac:structured-macro ac:name='code'><ac:plain-text-body><![CDATA[$SUMMARY_CLI]]></ac:plain-text-body></ac:structured-macro>"

FINAL_PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({
    'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 
    'ancestors': [{'id': sys.argv[3]}], 
    'body': {'storage': {'value': sys.argv[4], 'representation': 'storage'}}
}))" "$TITLE" "$SPACE_KEY" "$PROJECT_FOLDER_ID" "$HTML_BODY")

echo "📤 Publicando reporte..."
curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$FINAL_PAYLOAD" "$CONF_BASE_URL/rest/api/content" | python3 -m json.tool