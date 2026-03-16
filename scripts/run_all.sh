#!/bin/bash

# ==========================================
# 1. LÓGICA DE EJECUCIÓN Y PARÁMETROS
# ==========================================
PROYECTO=$1        
PAIS_INPUT=$2      
AMBIENTE=$3  

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="$SCRIPTS_DIR/config/collections.json"

# Ruta al nuevo archivo de escenarios (Data-Driven)
DATA_FILE="$(dirname "$SCRIPTS_DIR")/test/data/scenarios.json"

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

if [ -z "$COLLECTION_UID" ]; then
    echo "❌ ERROR: No se encontró la Collection ID para: $PROYECTO"
    exit 1
fi

# IDs de Entornos
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
echo "🚀 Iniciando ejecución de Newman con escenarios..."

# Aseguramos que la carpeta de reportes exista
mkdir -p "$SCRIPTS_DIR"

newman run "$COLLECTION_PATH" \
    -e "$ENV_PATH" \
    -d "$DATA_PATH" \
    --reporters cli,json \
    --reporter-json-export "$JSON_REPORT" \
    --suppress-exit-code

# Verificación de seguridad: ¿Se generó el reporte?
if [ ! -f "$JSON_REPORT" ]; then
    echo "❌ ERROR: No se pudo generar el reporte JSON en $JSON_REPORT"
    exit 1
fi

echo "✅ Ejecución finalizada. Reporte generado."



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
        "curl", "-s", "[https://api.anthropic.com/v1/messages](https://api.anthropic.com/v1/messages)",
        "-H", f"x-api-key: {api_key}", 
        "-H", "anthropic-version: 2023-06-01",
        "-H", "content-type: application/json", 
        "-d", json.dumps(payload)
    ], capture_output=True, text=True)
    try:
        return json.loads(res.stdout)
    except:
        return {"error": {"message": "Invalid JSON response from API"}}

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
    Eres un Auditor Senior de Ciberseguridad. Genera un INFORME DE AUDITORÍA TÉCNICA en HTML puro.
    Dátos de fallos: {json.dumps(fallos_raw)}
    
    ESTRUCTURA OBLIGATORIA:
    1. Título H2: Informe de Auditoría: ms-communicator (Validación de Esquema)
    2. Resumen de Ejecución: Total escenarios: 21, Fallas detectadas: {len(fallos_raw)}.
    3. Categoría 1: Fallas de Integridad Financiera (Reglas de Negocio). Tabla con Escenario, Dato Enviado, Resultado (200 OK), Hallazgo y Evidencia (ID).
    4. Categoría 2: Ausencia de Validación de Esquema. Tabla con Escenario, Campo, Dato Enviado, Hallazgo y Evidencia (ID).
    5. Categoría 3: Inestabilidad y Crashing (Errores 500). Tabla con Escenario, Condición de Fallo, Resultado (500), Hallazgo y Evidencia.
    6. Sección: Recomendaciones Técnicas (Joi/Zod, Sanitización, Error Handler).

    ESTILO: 
    - No uses etiquetas ```html. Responde directamente con el código <div>...</div>.
    - Headers de tabla fondo #2c3e50, letras blancas.
    - Usa estilos inline para todo.
    """
    
    # Intentamos modelos en cascada desde el más nuevo al más compatible
    models = ["claude-3-5-sonnet-20240620", "claude-3-sonnet-20240229", "claude-2.1"]
    final_html = ""
    
    for model in models:
        response = call_claude(api_key, model, prompt)
        if "content" in response:
            final_html = response["content"][0]["text"]
            break
        else:
            print(f"DEBUG: Falló modelo {model}: {response.get('error', {}).get('message')}")
    
    if final_html:
        # Limpieza de seguridad
        final_html = final_html.replace("```html", "").replace("```", "").strip()
        with open("claude_report.html", "w") as f: 
            f.write(final_html.replace("\n", " "))
    else:
        raise Exception("Ningún modelo de Claude respondió. Revisa permisos y API Key.")

except Exception as e:
    with open("claude_report.html", "w") as f: 
        f.write(f"<p style='color:red;'>⚠️ Error Crítico en Auditoría: {str(e)}</p>")
PYEOF
fi




# ==========================================
# 5. PUBLICACIÓN ORGANIZADA EN CONFLUENCE
# ==========================================
echo "📂 Organizando jerarquía para ambiente: $AMBIENTE..."

if [ "$AMBIENTE" == "Staging" ]; then
    AMBIENTE_PARENT_ID="2217115649" 
else
    AMBIENTE_PARENT_ID="2216984577" 
fi

FOLDER_TITLE="Auditorías $AMBIENTE - $PROYECTO"

# Buscar carpeta del proyecto
SEARCH_URL="${CONF_BASE_URL}/rest/api/content?title=${FOLDER_TITLE// /%20}&spaceKey=${SPACE_KEY}"
SEARCH_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" "$SEARCH_URL")
PROJECT_FOLDER_ID=$(echo "$SEARCH_RES" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['results'][0]['id'] if data['results'] else '')")

# Crear carpeta si no existe
if [ -z "$PROJECT_FOLDER_ID" ] || [ "$PROJECT_FOLDER_ID" == "None" ] || [ "$PROJECT_FOLDER_ID" == "" ]; then
    echo "📁 Creando nueva carpeta: $FOLDER_TITLE"
    FOLDER_PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({
        'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 
        'ancestors': [{'id': sys.argv[3]}], 
        'body': {'storage': {'value': '<p>Reportes de $PROYECTO en $AMBIENTE</p><ac:structured-macro ac:name=\"children\" />', 'representation': 'storage'}}
    }))" "$FOLDER_TITLE" "$SPACE_KEY" "$AMBIENTE_PARENT_ID")
    
    CREATE_FOLDER_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$FOLDER_PAYLOAD" "$CONF_BASE_URL/rest/api/content")
    PROJECT_FOLDER_ID=$(echo "$CREATE_FOLDER_RES" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")
fi

# Preparar Reporte Final
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