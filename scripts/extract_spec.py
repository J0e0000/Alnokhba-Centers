import json

out = json.load(open('/home/z/my-project/chatdata/messages.json', 'r', encoding='utf-8'))
spec = out[1]['content']
with open('/home/z/my-project/chatdata/spec_full.txt', 'w', encoding='utf-8') as f:
    f.write(spec)
print(f"Spec length: {len(spec)} chars")
print(spec[:3000])
