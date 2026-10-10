#!/usr/bin/env python3
"""Fetch the full message batch from chat.z.ai using cookie auth,
extract all messages + files, and write them to disk."""
import json
import subprocess

with open('/home/z/my-project/ids_clean.json') as f:
    ids = json.load(f)

with open('/home/z/my-project/cookie_header.txt') as f:
    cookie = f.read().strip()

payload = json.dumps({"ids": ids})
cmd = [
    'curl', '-s', '-X', 'POST',
    'https://chat.z.ai/api/v1/chats/be6a3ab7-bc07-4857-aa49-b33801e9b40d/messages/batch',
    '-H', f'Cookie: {cookie}',
    '-H', 'Accept: application/json',
    '-H', 'Content-Type: application/json',
    '-d', payload,
    '-o', '/home/z/my-project/chat_batch.json',
    '-w', '%{http_code} %{size_download}',
]
result = subprocess.run(cmd, capture_output=True, text=True)
print('HTTP result:', result.stdout)
