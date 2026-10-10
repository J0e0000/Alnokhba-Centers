#!/usr/bin/env python3
"""Convert agent-browser cookies JSON to a curl cookie-header string."""
import json

with open('/home/z/my-project/cookies.json') as f:
    data = json.load(f)

cookies = data['data']['cookies']
header = '; '.join(f"{c['name']}={c['value']}" for c in cookies if 'z.ai' in c['domain'])
with open('/home/z/my-project/cookie_header.txt', 'w') as f:
    f.write(header)
print(f"Wrote {len(cookies)} cookies, header length: {len(header)}")
