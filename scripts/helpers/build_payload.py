import json, sys

page_title = sys.argv[1]
space_key  = sys.argv[2]
parent_id  = sys.argv[3]
body_file  = sys.argv[4]
out_file   = sys.argv[5]

with open(body_file, encoding='utf-8') as f:
    body = f.read()

payload = {
    'type': 'page',
    'title': page_title,
    'space': {'key': space_key},
    'ancestors': [{'id': parent_id}],
    'body': {'storage': {'value': body, 'representation': 'storage'}}
}

with open(out_file, 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False)

print(f"[CONF] Payload escrito: {out_file} ({len(body)} chars de HTML)")