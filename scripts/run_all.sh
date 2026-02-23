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
POSTMAN_API_KEY="${POSTMAN_API_KEY:?Error: variable de entorno POSTMAN_API_KEY no definida}"
COLLECTION_UID="45103176-fc8836e1-6797-444a-a378-d43987d95165"

if [ "$PAIS_INPUT" == "CO" ]; then
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19456853-9abeee01-9104-4f55-84b1-a7424aa6aedf" || ENV_UID="19103266-4be86e2c-b894-4577-95c4-f4b827281933"
else
    [[ "$AMBIENTE" == "Staging" ]] && ENV_UID="19103266-8187ac0e-07bd-497d-a228-fefdeec90492" || ENV_UID="19456853-52efb174-794f-4837-a1bf-fc913c9b0f10"
fi

CONF_USER="${CONF_USER:?Error: variable de entorno CONF_USER no definida}"
CONF_TOKEN="${CONF_TOKEN:?Error: variable de entorno CONF_TOKEN no definida}"
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
# 4. ANÁLISIS AGÉNTICO (EXTRACCIÓN BLINDADA)
# ==========================================
echo "🤖 Analizando fallos técnicos..."

# Extraer fallos del JSON
FAILED_DATA=$(python3 -c "import json, sys; d=json.load(open('$JSON_REPORT')); print(json.dumps(d['run']['failures']))" 2>/dev/null)

if [ -z "$FAILED_DATA" ] || [ "$FAILED_DATA" == "[]" ]; then
    AI_RCA="<p style='color:green;'>✅ Todas las pruebas pasaron correctamente.</p>"
else
    # 1. Preparar datos limpios para la IA
    FAILED_CLEAN=$(python3 -c "import json, sys, re; data = json.loads(sys.stdin.read()); lines = [];
for i, f in enumerate(data, 1):
    req=f.get('source',{}).get('name','N/A'); msg=f.get('error',{}).get('message','N/A'); code=re.search(r'got (\d{3})', msg); code=code.group(1) if code else 'N/A';
    lines.append(f'{i}|{req}|AssertionError|{msg}|{code}')
print('\n'.join(lines))" <<< "$FAILED_DATA" 2>/dev/null)

    # 2. Función de limpieza quirúrgica
    extract_rows() {
        python3 -c "import sys, re; text = sys.stdin.read(); matches = re.findall(r'<tr>(.*?)</tr>', text, re.DOTALL | re.IGNORECASE); print(''.join([f'<tr>{m}</tr>' for m in matches]))"
    }

    # 3. Llamadas a Ollama
    ROWS_RESUMEN=$(curl -s http://localhost:11434/api/generate -d "{
      \"model\": \"llama3\",
      \"prompt\": \"Genera filas HTML <tr> para esta tabla: #|Request|Tipo|Mensaje|Código|Origen. Si code=422 pon '🔴 API', si msg=undefined pon '⚠️ Cadena'. DATOS: $FAILED_CLEAN\",
      \"system\": \"Responde ÚNICAMENTE con filas <tr> y <td>. No saludes. No expliques nada.\",
      \"stream\": false
    }" | python3 -c "import sys,json; print(json.load(sys.stdin).get('response',''))" | extract_rows)

    ROWS_RCA=$(curl -s http://localhost:11434/api/generate -d "{
      \"model\": \"llama3\",
      \"prompt\": \"Genera filas HTML <tr> con: #, Request, Causa Raíz Técnica, Acción. Errores: $FAILED_CLEAN\",
      \"system\": \"Responde ÚNICAMENTE con filas <tr> y <td>. No saludes.\",
      \"stream\": false
    }" | python3 -c "import sys,json; print(json.load(sys.stdin).get('response',''))" | extract_rows)

    # 4. 🔥 FALLBACK DE SEGURIDAD (Si la IA falla, Python pinta la tabla)
    if [ -z "$ROWS_RESUMEN" ]; then
        echo "⚠️ Ollama no generó HTML válido. Usando motor de respaldo..."
        ROWS_RESUMEN=$(python3 -c "import json, sys, re; data = json.loads(sys.argv[1]); rows = '';
for i, f in enumerate(data, 1):
    req=f.get('source',{}).get('name','N/A'); msg=f.get('error',{}).get('message','N/A'); code=re.search(r'got (\d{3})', msg); code=code.group(1) if code else 'N/A';
    rows += f'<tr><td>{i}</td><td>{req}</td><td>AssertionError</td><td>{msg}</td><td>{code}</td><td>🔴 Fallo</td></tr>'
print(rows)" "$FAILED_DATA")
    fi

    if [ -z "$ROWS_RCA" ]; then
        ROWS_RCA=$(python3 -c "import json, sys; data = json.loads(sys.argv[1]); rows = '';
for i, f in enumerate(data, 1):
    req=f.get('source',{}).get('name','N/A');
    rows += f'<tr><td>{i}</td><td>{req}</td><td>Error técnico detectado en el response</td><td>Revisar logs adjuntos</td></tr>'
print(rows)" "$FAILED_DATA")
    fi

    # 5. Construcción final
    AI_RCA="<ac:structured-macro ac:name='panel'><ac:parameter ac:name='title'>🔴 Resumen de Fallas</ac:parameter><ac:rich-text-body><table><thead><tr><th>#</th><th>Request</th><th>Tipo</th><th>Mensaje</th><th>Código</th><th>Origen</th></tr></thead><tbody>$ROWS_RESUMEN</tbody></table></ac:rich-text-body></ac:structured-macro>
    <ac:structured-macro ac:name='panel'><ac:parameter ac:name='title'>🔍 Análisis Técnico (IA)</ac:parameter><ac:rich-text-body><table><thead><tr><th>#</th><th>Request</th><th>Causa Raíz</th><th>Acción</th></tr></thead><tbody>$ROWS_RCA</tbody></table></ac:rich-text-body></ac:structured-macro>"
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