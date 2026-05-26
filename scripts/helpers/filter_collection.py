#!/usr/bin/env python3
"""
filter_collection.py — Filtra una colección de Postman dejando solo los requests con IDs indicados.
Uso: python3 filter_collection.py <collection.json> <output.json> <id1> [id2 ...]
"""
import json, sys


def normalize_id(uid):
    """Strips workspace prefix: '19198347-uuid' → 'uuid'."""
    parts = uid.split('-', 1)
    return parts[1] if len(parts) > 1 and parts[0].isdigit() else uid


def filter_items(items, target_ids):
    result = []
    for item in items:
        if 'item' in item:  # es una carpeta
            children = filter_items(item['item'], target_ids)
            if children:
                result.append({**item, 'item': children})
        else:  # es un request
            if normalize_id(item.get('id', '')) in target_ids:
                result.append(item)
    return result


def main():
    if len(sys.argv) < 4:
        print(f"Uso: {sys.argv[0]} <collection.json> <output.json> <id1> [id2 ...]", file=sys.stderr)
        sys.exit(1)

    collection_path = sys.argv[1]
    output_path     = sys.argv[2]
    target_ids      = set(normalize_id(uid) for uid in sys.argv[3:])

    with open(collection_path, encoding='utf-8') as f:
        data = json.load(f)

    # La API de Postman envuelve la colección bajo la clave 'collection'
    collection = data.get('collection', data)
    collection['item'] = filter_items(collection.get('item', []), target_ids)

    if not collection['item']:
        print(f"ERROR: ningún request coincide con los IDs proporcionados.", file=sys.stderr)
        print(f"IDs buscados: {target_ids}", file=sys.stderr)
        sys.exit(1)

    if 'collection' in data:
        data['collection'] = collection
    else:
        data = collection

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    total = sum(1 for i in collection['item'] for _ in ([i] if 'item' not in i else i['item']))
    print(f"Colección filtrada: {len(collection['item'])} carpeta(s) raíz, {len(target_ids)} request(s) → {output_path}")


if __name__ == '__main__':
    main()
