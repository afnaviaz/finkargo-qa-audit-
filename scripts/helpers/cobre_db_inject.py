#!/usr/bin/env python3
"""
cobre_db_inject.py — Consulta cobre_movement_id desde cobre."transaction" e inyecta
el valor en el environment export de Newman para que el siguiente request
(payment notification) lo pueda usar.

Uso:
  python3 cobre_db_inject.py <env_export_path> <pais> <ambiente>

Se ejecuta ENTRE la Fase 1 (Quote + Transaction + founds to movement debit)
y la Fase 2 (payment notification) del pipeline cobre_happy.

Query:
  SELECT cobre_movement_id FROM cobre."transaction"
  WHERE exchange_quote_id = <cobre_quote_external_id>
  AND cobre_movement_id IS NOT NULL
  LIMIT 1

La columna exchange_quote_id en cobre."transaction" corresponde a
cobre_quote_external_id (external_id de la cotización, guardado en el env export
por el test script de Exchange Quote).
"""
import json, sys, os, time


def get_db_config(pais, ambiente):
    suffix = f"{ambiente.upper()}_{pais.upper()}"
    return {
        'host':     os.environ.get(f'DB_HOST_{suffix}', ''),
        'port':     int(os.environ.get(f'DB_PORT_{suffix}', '').strip() or '5432'),
        'dbname':   os.environ.get(f'DB_NAME_{suffix}', ''),
        'user':     os.environ.get(f'DB_USER_{suffix}', ''),
        'password': os.environ.get(f'DB_PASSWORD_{suffix}', ''),
    }


def get_env_var(env_export_path, key):
    with open(env_export_path, encoding='utf-8') as f:
        env = json.load(f)
    return next(
        (v['value'] for v in env.get('values', []) if v['key'] == key and v.get('value')),
        None
    )


def set_env_var(env_export_path, key, value):
    with open(env_export_path, encoding='utf-8') as f:
        env = json.load(f)
    values = env.get('values', [])
    for v in values:
        if v['key'] == key:
            v['value'] = value
            v['enabled'] = True
            break
    else:
        values.append({'key': key, 'value': value, 'enabled': True, 'type': 'default'})
    env['values'] = values
    with open(env_export_path, 'w', encoding='utf-8') as f:
        json.dump(env, f, ensure_ascii=False, indent=2)


def main():
    if len(sys.argv) < 4:
        print('Uso: cobre_db_inject.py <env_export> <pais> <ambiente>')
        sys.exit(1)

    env_export = sys.argv[1]
    pais       = sys.argv[2]
    ambiente   = sys.argv[3]

    exchange_quote_id = get_env_var(env_export, 'cobre_quote_external_id')
    if not exchange_quote_id:
        print('ERROR: cobre_quote_external_id no encontrado en el env export.')
        print('       Verificar que el test script de Exchange Quote guardó el valor.')
        sys.exit(1)

    print(f'Buscando cobre_movement_id para exchange_quote_id: {exchange_quote_id}')

    db_config = get_db_config(pais, ambiente)
    if not db_config['host']:
        print(f'INFO: No hay configuración DB para {pais}/{ambiente}. Saltando inyección.')
        sys.exit(0)

    try:
        import psycopg2
    except ImportError:
        print('WARN: psycopg2 no instalado. Saltando inyección de cobre_movement_id.')
        sys.exit(0)

    POLL_INTERVAL = 10
    POLL_TIMEOUT  = 120
    elapsed       = 0
    movement_id   = None

    try:
        conn = psycopg2.connect(**db_config)
        cur  = conn.cursor()

        print(f'Conectado a BD {pais}/{ambiente}. Polling cobre_movement_id (timeout: {POLL_TIMEOUT}s)...')
        while elapsed <= POLL_TIMEOUT:
            cur.execute(
                '''SELECT cobre_movement_id
                   FROM cobre."transaction"
                   WHERE exchange_quote_id = %s
                     AND cobre_movement_id IS NOT NULL
                   LIMIT 1''',
                (exchange_quote_id,)
            )
            row = cur.fetchone()
            if row and row[0]:
                movement_id = row[0]
                break
            print(f'  [{elapsed}s] cobre_movement_id aún no disponible, esperando...')
            time.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

        cur.close()
        conn.close()

    except Exception as e:
        print(f'ERROR conectando a BD ({pais}/{ambiente}): {e}')
        sys.exit(1)

    if not movement_id:
        print(f'ERROR: cobre_movement_id no encontrado tras {POLL_TIMEOUT}s.')
        print(f'       Query: exchange_quote_id = {exchange_quote_id}')
        print('       Verificar que el movimiento fue procesado en la BD.')
        sys.exit(1)

    set_env_var(env_export, 'cobre_movement_id', movement_id)
    print(f'OK cobre_movement_id inyectado: {movement_id}')


if __name__ == '__main__':
    main()
