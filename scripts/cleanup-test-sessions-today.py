#!/usr/bin/env python3
"""Restore production state: remove today's EMPTY sessions in النخبة that were
   auto-opened by test runs (zero attendance / payments / settlements / journal)."""
import sqlite3

con = sqlite3.connect("/home/z/my-project/db/custom.db")
cur = con.cursor()

today = "2026-09-03"
rows = cur.execute("""
  SELECT id, startTime, status, openedBy
  FROM SessionInstance
  WHERE date = ? AND centerId = (SELECT id FROM Center WHERE slug = 'alnokhba-elite')
""", (today,)).fetchall()

print("today's النخبة sessions:", len(rows))
for sid, st, status, openedBy in rows:
    att = cur.execute("SELECT COUNT(*) FROM Attendance WHERE sessionId=?", (sid,)).fetchone()[0]
    txn = cur.execute("SELECT COUNT(*) FROM StudentTransaction WHERE sessionId=?", (sid,)).fetchone()[0]
    setl = cur.execute("SELECT COUNT(*) FROM TeacherSettlement WHERE sessionId=?", (sid,)).fetchone()[0]
    jr = cur.execute("SELECT COUNT(*) FROM CenterTransaction WHERE refId=?", (sid,)).fetchone()[0]
    user = cur.execute("SELECT username FROM User WHERE id=?", (openedBy,)).fetchone()
    print(f"  {st} {status} by {user} att={att} txn={txn} setl={setl} journal={jr}")
    if att == 0 and txn == 0 and setl == 0 and jr == 0:
        cur.execute("DELETE FROM SessionInstance WHERE id=?", (sid,))
        print("   -> deleted (empty test-opened session)")

con.commit()
print("remaining today:", cur.execute(
    "SELECT COUNT(*) FROM SessionInstance WHERE date=? AND centerId=(SELECT id FROM Center WHERE slug='alnokhba-elite')", (today,)
).fetchone()[0])
