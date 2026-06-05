import json, sys

src, dst, base_url = sys.argv[1], sys.argv[2], sys.argv[3]

with open(src, encoding='utf-8') as f:
    raw_data = json.load(f)

if 'collection' in raw_data:
    col = raw_data['collection']
    wrapper = True
else:
    col = raw_data
    wrapper = False

def fix_urls(items):
    count = 0
    for item in items:
        if 'item' in item:
            count += fix_urls(item['item'])
        elif 'request' in item:
            url = item['request'].get('url', {})
            if not isinstance(url, dict):
                continue
            raw = url.get('raw', '')
            if '{{api-core-entities}}' not in raw:
                continue
            url['raw'] = raw.replace('{{api-core-entities}}', base_url)
            url['protocol'] = 'https'
            url['host'] = [base_url.replace('https://', '').replace('http://', '')]
            item['request']['url'] = url
            count += 1
    return count

fixed = fix_urls(col.get('item', []))

if wrapper:
    raw_data['collection'] = col
    output = raw_data
else:
    output = col

with open(dst, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)

print(f"[FIX] {fixed} URLs corregidas en raw (wrapper={wrapper}) — double slash eliminado")