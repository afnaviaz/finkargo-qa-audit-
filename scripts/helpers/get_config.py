#!/usr/bin/env python3
"""
get_config.py — Lee collections.json y devuelve el valor solicitado.
Uso: python3 get_config.py <config_path> <proyecto> <key> <mode>
  mode=id          → devuelve collection_id
  mode=folder_id   → devuelve el ID de la carpeta cuyo nombre es <key>
  mode=all_folders → devuelve todos los IDs de carpetas separados por newline
  mode=all_items   → devuelve todos los IDs de items dentro de folders[key], uno por línea
"""
import json, sys

def main():
    if len(sys.argv) < 5:
        print(f"Uso: {sys.argv[0]} <config_path> <proyecto> <key> <mode>", file=sys.stderr)
        sys.exit(1)

    config_path = sys.argv[1]
    proyecto    = sys.argv[2]
    key         = sys.argv[3]
    mode        = sys.argv[4]

    try:
        with open(config_path, encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: No se encontró {config_path}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: collections.json inválido: {e}", file=sys.stderr)
        sys.exit(1)

    proj = data.get(proyecto)
    if not proj:
        available = list(data.keys())
        print(f"ERROR: proyecto '{proyecto}' no encontrado. Disponibles: {available}", file=sys.stderr)
        sys.exit(1)

    if mode == 'id':
        cid = proj.get('collection_id', '')
        if not cid:
            print(f"ERROR: collection_id no definido para '{proyecto}'", file=sys.stderr)
            sys.exit(1)
        print(cid)

    elif mode == 'all_folders':
        folders = proj.get('folders', {})
        if not folders:
            print(f"ERROR: no hay folders definidos para '{proyecto}'", file=sys.stderr)
            sys.exit(1)
        ids = []
        for v in folders.values():
            ids.append(v['id'] if isinstance(v, dict) else v)
        print('\n'.join(ids))

    elif mode == 'folder_id':
        folders = proj.get('folders', {})
        entry = folders.get(key, '')
        if not entry:
            available = list(folders.keys())
            print(f"ERROR: folder '{key}' no encontrado para '{proyecto}'. Disponibles: {available}", file=sys.stderr)
            sys.exit(1)
        print(entry['id'] if isinstance(entry, dict) else entry)

    elif mode == 'item_id':
        if len(sys.argv) < 6:
            print(f"ERROR: item_id requiere 6 args: config proyecto pais item_id item_name", file=sys.stderr)
            sys.exit(1)
        item_name = sys.argv[5]
        folders = proj.get('folders', {})
        entry = folders.get(key, '')
        if not entry or not isinstance(entry, dict):
            print(f"ERROR: folder '{key}' no tiene estructura de items", file=sys.stderr)
            sys.exit(1)
        item_id = entry.get('items', {}).get(item_name, '')
        if not item_id:
            available = list(entry.get('items', {}).keys())
            print(f"ERROR: item '{item_name}' no encontrado en '{key}'. Disponibles: {available}", file=sys.stderr)
            sys.exit(1)
        print(item_id)

    elif mode == 'all_items':
        folders = proj.get('folders', {})
        entry = folders.get(key, '')
        if not entry or not isinstance(entry, dict):
            print(f"ERROR: folder '{key}' no tiene estructura de items", file=sys.stderr)
            sys.exit(1)
        items = entry.get('items', {})
        if not items:
            print(f"ERROR: no hay items definidos en folder '{key}'", file=sys.stderr)
            sys.exit(1)
        print('\n'.join(items.values()))

    else:
        print(f"ERROR: mode inválido '{mode}'. Usar: id, all_folders, folder_id, item_id, all_items", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()