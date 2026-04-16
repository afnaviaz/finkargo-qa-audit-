#!/bin/bash
# ----------------------------------------------------------
# Playwright Runner - Flujo de pago
# Recibe: $1 = ENV_EXPORT path, $2 = SCRIPTS_DIR path
# ----------------------------------------------------------

ENV_EXPORT="${1:-}"
SCRIPTS_DIR="${2:-}"

if [[ -z "$ENV_EXPORT" || -z "$SCRIPTS_DIR" ]]; then
    echo "⚠️ Uso: run_playwright.sh <ENV_EXPORT> <SCRIPTS_DIR>"
    exit 0
fi

# Extraer payment_link del environment exportado por Newman
# NOTA: pasar ENV_EXPORT como sys.argv[1] para que Git Bash traduzca el path Windows
PAYMENT_LINK=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        env = json.load(f)
    values = env.get('values', [])
    match = next((v['value'] for v in values if v['key'] == 'payment_link' and v['value']), None)
    print(match or '')
except Exception as e:
    sys.stderr.write('run_playwright: ' + str(e) + '\n')
    print('')
" "$ENV_EXPORT" 2>/dev/null)

if [ -n "$PAYMENT_LINK" ]; then
    echo "[$(date +'%H:%M:%S')] 🎭 payment_link detectado. Iniciando Playwright..."
    export PAYMENT_LINK="$PAYMENT_LINK"
    export SCRIPTS_DIR="$SCRIPTS_DIR"
    export CI="true"
    node "$SCRIPTS_DIR/playwright/payment_flow.js" "$PAYMENT_LINK" \
        || echo "[$(date +'%H:%M:%S')] ⚠️ Playwright terminó con errores (no bloquea el pipeline)"
else
    echo "[$(date +'%H:%M:%S')] ℹ️ No se encontró payment_link. Saltando Playwright."
fi
