// Extract all messages from the shared chat and save to a JSON file
// Run inside agent-browser eval context
async function main() {
  const d = JSON.parse(window.__chatData);
  const msgs = d.chat.history.messages;
  const keys = Object.keys(msgs);
  
  // Build ordered list via parentId/childrenIds tree
  const byId = msgs;
  let rootIds = keys.filter(k => !msgs[k].parentId);
  
  const ordered = [];
  const visited = new Set();
  function walk(id) {
    if (!id || visited.has(id) || !byId[id]) return;
    visited.add(id);
    ordered.push(byId[id]);
    (byId[id].childrenIds || []).forEach(walk);
  }
  rootIds.forEach(walk);
  
  const out = ordered.map(m => ({
    id: m.id,
    role: m.role,
    timestamp: m.timestamp,
    contentLen: (m.content || '').length,
    contentPreview: (m.content || '').substring(0, 300),
  }));
  
  window.__ordered = JSON.stringify(ordered.map((m, i) => ({ ...m, content: ordered[i].contentLen > 0 ? m.content : undefined })));
  return JSON.stringify({ total: ordered.length, withContent: out.filter(o => o.contentLen > 0).length });
}
return main();
