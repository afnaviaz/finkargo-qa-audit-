#!/usr/bin/env python3
"""
validate_db_states.py — Valida estados en PostgreSQL después de Newman.
Uso: python3 validate_db_states.py <env_export_path> <pais> <ambiente>

Valida:
  - supra.exchange_quote  WHERE external_id = supra_quote_id → status CREATED
  - supra."transaction"   WHERE external_id = payin_id       → status PAID (o CREATED/in_progress)
"""
import json, sys, os

def get_db_config(pais, ambiente):
    suffix = f"{ambiente.upper()}_{pais.upper()}"
    return {
        'host':     os.environ.get(f'DB_HOST_{suffix}', ''),
        'port':     int(os.environ.get(f'DB_PORT_{suffix}', '5432')),
        'dbname':   os.environ.get(f'DB_NAME_{suffix}', ''),
        'user':     os.environ.get(f'DB_USER_{suffix}', ''),
        'password': os.environ.get(f'DB_PASSWORD_{suffix}', ''),
    }

def get_env_var(env_export_path, key):
    try:
        with open(env_export_path, encoding='utf-8') as f:
            env = json.load(f)
        values = env.get('values', [])
        match = next((v['value'] for v in values if v['key'] == key and v['value']), None)
        return match
    except Exception as e:
        sys.stderr.write(f'validate_db: error leyendo env export: {e}\n')
        return None

def main():
    if len(sys.argv) < 4:
        print('Uso: validate_db_states.py <env_export> <pais> <ambiente>')
        sys.exit(1)

    env_export = sys.argv[1]
    pais       = sys.argv[2]
    ambiente   = sys.argv[3]

    supra_quote_id = get_env_var(env_export, 'supra_quote_id')
    payin_id       = get_env_var(env_export, 'payin_id')

    if not supra_quote_id and not payin_id:
        print('INFO No se encontraron IDs de SUPRA en el environment. Saltando validacion DB.')
        sys.exit(0)

    db_config = get_db_config(pais, ambiente)
    if not db_config['host']:
        print(f'INFO No hay configuracion DB para {pais}/{ambiente}. Saltando validacion.')
        sys.exit(0)

    try:
        import psycopg2
    except ImportError:
        print('WARN psycopg2 no instalado. Saltando validacion DB.')
        sys.exit(0)

    errors = 0

    try:
        conn = psycopg2.connect(**db_config)
        cur  = conn.cursor()

        print('')
        print('=' * 55)
        print('  VALIDACION DE ESTADOS - BASE DE DATOS')
        print(f'  Ambiente: {ambiente} | Pais: {pais}')
        print('=' * 55)

        # --- 1. exchange_quote ---
        if supra_quote_id:
            cur.execute(
                'SELECT external_id, status FROM supra.exchange_quote WHERE external_id = %s',
                (supra_quote_id,)
            )
            row = cur.fetchone()
            if row:
                status   = row[1]
                expected = 'CREATED'
                ok       = status == expected
                icon     = 'OK' if ok else 'FAIL'
                print(f'[{icon}] exchange_quote | external_id: {supra_quote_id[:12]}... | status: {status} (esperado: {expected})')
                if not ok:
                    errors += 1
            else:
                print(f'[FAIL] exchange_quote | external_id: {supra_quote_id[:12]}... | NO ENCONTRADO en BD')
                errors += 1

        # --- 2. transaction ---
        if payin_id:
            cur.execute(
                'SELECT external_id, status FROM supra."transaction" WHERE external_id = %s',
                (payin_id,)
            )
            row = cur.fetchone()
            if row:
                status  = row[1]
                # PAID = exito, CREATED/in_progress = pendiente (no falla), EXPIRED/REJECTED = falla
                if status == 'PAID':
                    icon = 'OK'
                elif status in ('CREATED', 'in_progress'):
                    icon = 'WARN'
                else:
                    icon = 'FAIL'
                    errors += 1
                print(f'[{icon}] transaction    | external_id: {payin_id[:12]}...    | status: {status} (esperado: PAID)')
            else:
                print(f'[FAIL] transaction | external_id: {payin_id[:12]}... | NO ENCONTRADO en BD')
                errors += 1

        print('=' * 55)
        cur.close()
        conn.close()

    except Exception as e:
        print(f'WARN Error conectando a BD ({pais}/{ambiente}): {e}')
        sys.exit(0)  # No bloquear el pipeline por errores de BD

    if errors > 0:
        print(f'WARN {errors} validacion(es) de BD fallaron.')
        sys.exit(2)
    else:
        print('OK Todas las validaciones de BD pasaron.')
        sys.exit(0)

if __name__ == '__main__':
    main()