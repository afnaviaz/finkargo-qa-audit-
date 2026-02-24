#!/bin/bash

# ==========================================
# 1. LÓGICA DE EJECUCIÓN GLOBAL Y CONTADOR
# ==========================================
PAIS_INPUT=$1      
AMBIENTE=$2  

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
COUNTER_FILE="$SCRIPTS_DIR/.run_counter"
[ ! -f "$COUNTER_FILE" ] && echo "1" > "$COUNTER_FILE"
EXEC_NUM=$(cat "$COUNTER_FILE")

if [[ "$PAIS_INPUT" == "ALL" ]]; then
    echo "🌍 INICIANDO AUDITORÍA GLOBAL (CO & MX) [$AMBIENTE] - Exec #$EXEC_NUM"
    echo $((EXEC_NUM + 1)) > "$COUNTER_FILE"
    for p in "CO" "MX"; do
        bash "$0" "$p" "$AMBIENTE" "$EXEC_NUM"
        echo "⏳ Pausa anti-bloqueo (15s)..."
        sleep 15
    done
    exit 0
fi

if [ ! -z "$3" ]; then EXEC_NUM=$3; else echo $((EXEC_NUM + 1)) > "$COUNTER_FILE"; fi

# ==========================================
# 2. CONFIGURACIÓN POSTMAN API
# ==========================================
POSTMAN_API_KEY="${POSTMAN_API_KEY}"
COLLECTION_UID="45103176-fc8836e1-6797-444a-a378-d43987d95165"

if [ "$PAIS_INPUT" == "CO" ]; then
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf" || ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933"
else
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19103266-8187ac0e-07bd-497d-a228-fefdeec90492" || ENV_UID="19456853-52efb174-794f-4837-a1bf-fc913c9b0f10"
fi

CONF_USER="andres.navia@finkargo.com"
CONF_TOKEN="${CONF_TOKEN}"
CONF_BASE_URL="https://finkargo.atlassian.net/wiki"
SPACE_KEY="QA" 
[[ "$AMBIENTE" == "Testing" ]] && PARENT_PAGE_ID="2216984577" || PARENT_PAGE_ID="2217115649"

PAIS=$PAIS_INPUT
NOW=$(date +'%Y-%m-%d %H:%M:%S')
LOG_FILE="$SCRIPTS_DIR/log_${PAIS}.txt"
JSON_REPORT="$SCRIPTS_DIR/results_${PAIS}.json"
HTML_REPORT="$SCRIPTS_DIR/report_${PAIS}.html"
TITLE="[Exec #$EXEC_NUM] Test Report [$AMBIENTE][$PAIS] - $NOW"

[ "$PAIS" == "MX" ] && FOLDER_NAME="Mexico (MX)" || FOLDER_NAME="Colombia (CO)"

# ==========================================
# 3. EJECUCIÓN NEWMAN (AHORA CON SALIDA EN CONSOLA)
# ==========================================
echo "🚀 Ejecutando pruebas en $PAIS ($AMBIENTE)..."
# Usamos 'tee' para que se vea en consola Y se guarde en el log
newman run "https://api.getpostman.com/collections/$COLLECTION_UID?apikey=$POSTMAN_API_KEY" \
  -e "https://api.getpostman.com/environments/$ENV_UID?apikey=$POSTMAN_API_KEY" \
  --folder "$FOLDER_NAME" --insecure -r cli,json,htmlextra \
  --reporter-json-export "$JSON_REPORT" --reporter-htmlextra-export "$HTML_REPORT" | tee "$LOG_FILE"

# ==========================================
# 4. ANÁLISIS AGÉNTICO CON CLAUDE
# ==========================================
echo "🤖 Analizando fallos técnicos..."

FAILED_DATA=$(python3 -c "import json; d=json.load(open('$JSON_REPORT')); print(json.dumps(d['run']['failures']))" 2>/dev/null)

if [ -z "$FAILED_DATA" ] || [ "$FAILED_DATA" == "[]" ]; then
    AI_RCA="<p style='color:green;'>✅ Todas las pruebas pasaron correctamente.</p>"
else
    echo "$FAILED_DATA" > /tmp/failed_data.json

    AI_RCA=$(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" python3 << 'PYEOF'
import json, subprocess, os, re, sys

api_key = os.environ.get("ANTHROPIC_API_KEY", "")

with open("/tmp/failed_data.json", "r") as f:
    failed_data = json.load(f)

# Preparar datos de fallos
fallos = []
for i, f in enumerate(failed_data, 1):
    req = f.get('source', {}).get('name', 'N/A')
    msg = f.get('error', {}).get('message', 'N/A')
    code = re.search(r'got (\d{3})', msg)
    code = code.group(1) if code else 'N/A'
    fallos.append({"num": i, "req": req, "msg": msg, "code": code})

# Construir tabla de resumen con Python (sin IA para HTML)
rows_resumen = ""
for f in fallos:
    if f["code"] == "422":
        origen = "🔴 API"
    elif "undefined" in f["msg"]:
        origen = "⚠️ Cadena"
    else:
        origen = "🔴 Fallo"
    rows_resumen += f"<tr><td>{f['num']}</td><td>{f['req']}</td><td>AssertionError</td><td>{f['msg']}</td><td>{f['code']}</td><td>{origen}</td></tr>"

# Pedir a Claude SOLO la causa raíz y acción — formato JSON estricto
fallos_texto = "\n".join([f"{f['num']}|{f['req']}|{f['msg']}|{f['code']}" for f in fallos])

prompt = f"""Analiza estos fallos de pruebas de API y responde ÚNICAMENTE con un array JSON válido, sin texto adicional, sin explicaciones, sin markdown, sin bloques de código.

Formato exacto requerido:
[{{"num":1,"causa":"texto","accion":"texto"}},{{"num":2,"causa":"texto","accion":"texto"}}]

Fallos (formato: #|request|mensaje_error|codigo_http):
{fallos_texto}"""

body = json.dumps({
    "model": "claude-opus-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": prompt}]
})

result = subprocess.run([
    "curl", "-s",
    "https://api.anthropic.com/v1/messages",
    "-H", f"x-api-key: {api_key}",
    "-H", "anthropic-version: 2023-06-01",
    "-H", "content-type: application/json",
    "-d", body
], capture_output=True, text=True)

rows_rca = ""
try:
    data = json.loads(result.stdout)
    if "content" in data:
        raw = data["content"][0]["text"].strip()
        # Limpiar por si Claude agrega algo antes/después del JSON
        raw = re.sub(r'^[^[]*', '', raw)
        raw = re.sub(r'[^\]]*$', '', raw)
        rca_list = json.loads(raw)
        for r in rca_list:
            rows_rca += f"<tr><td>{r['num']}</td><td>{fallos[r['num']-1]['req']}</td><td>{r['causa']}</td><td>{r['accion']}</td></tr>"
    else:
        raise Exception("no content")
except Exception as e:
    sys.stderr.write(f"Claude RCA error: {e}\n")
    for f in fallos:
        rows_rca += f"<tr><td>{f['num']}</td><td>{f['req']}</td><td>Error técnico en response</td><td>Revisar logs adjuntos</td></tr>"

print(f'<ac:structured-macro ac:name="panel"><ac:parameter ac:name="title">🔴 Resumen de Fallas</ac:parameter><ac:rich-text-body><table><thead><tr><th>#</th><th>Request</th><th>Tipo</th><th>Mensaje</th><th>Código</th><th>Origen</th></tr></thead><tbody>{rows_resumen}</tbody></table></ac:rich-text-body></ac:structured-macro><ac:structured-macro ac:name="panel"><ac:parameter ac:name="title">🔍 Análisis Técnico (Claude AI)</ac:parameter><ac:rich-text-body><table><thead><tr><th>#</th><th>Request</th><th>Causa Raíz</th><th>Acción</th></tr></thead><tbody>{rows_rca}</tbody></table></ac:rich-text-body></ac:structured-macro>')
PYEOF
)
# Guardar análisis para Job Summary de GitHub
    mkdir -p "$SCRIPTS_DIR/../reports"
    {
        echo "### Fallos detectados: ${#fallos[@]}"
        echo ""
        echo "$AI_RCA"
    } > "$SCRIPTS_DIR/../reports/claude-analysis.md"

fi

# ==========================================
# 5. PUBLICACIÓN FINAL
# ==========================================
SUMMARY_CLI=$(sed -n '/┌/,/┘/p' "$LOG_FILE" | tr -d '\r' | sed 's/"/\\"/g' | sed 's/&/\&amp;/g' | sed 's/</\&lt;/g' | sed 's/>/\&gt;/g')
HTML_BODY="<h2>📊 Reporte QA [$PAIS] - $AMBIENTE</h2>$AI_RCA<ac:structured-macro ac:name='code'><ac:plain-text-body><![CDATA[$SUMMARY_CLI]]></ac:plain-text-body></ac:structured-macro>"
PAYLOAD=$(python3 -c "import json, sys; print(json.dumps({'type': 'page', 'title': sys.argv[1], 'space': {'key': sys.argv[2]}, 'ancestors': [{'id': sys.argv[3]}], 'body': {'storage': {'value': sys.argv[4], 'representation': 'storage'}}}))" "$TITLE" "$SPACE_KEY" "$PARENT_PAGE_ID" "$HTML_BODY")

# Publicación con reintentos
MAX_RETRIES=3; RETRY=0; SUCCESS=false
while [ $RETRY -lt $MAX_RETRIES ] && [ "$SUCCESS" = false ]; do
    CREATE_RES=$(curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$CONF_BASE_URL/rest/api/content")
    if [[ "$CREATE_RES" == *"429"* ]]; then RETRY=$((RETRY+1)); sleep 20; else SUCCESS=true; fi
done

PAGE_ID=$(echo "$CREATE_RES" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")

if [ ! -z "$PAGE_ID" ] && [ "$PAGE_ID" != "None" ]; then
    curl -s -u "$CONF_USER:$CONF_TOKEN" -X POST -H "X-Atlassian-Token: no-check" -F "file=@$HTML_REPORT" "$CONF_BASE_URL/rest/api/content/$PAGE_ID/child/attachment" > /dev/null
    echo "✅ Reporte Publicado: $TITLE"
else
    echo "❌ Error de Publicación: $CREATE_RES"
fi
