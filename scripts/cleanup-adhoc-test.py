#!/usr/bin/env python3
"""Cleanup: remove test ad-hoc sessions created during browser verification
   (sessions with zero attendance, zero payments/settlements/journal — safe)."""
import sqlite3, sys

con = sqlite3.connect("/home/z/my-project/db/custom.db")
cur = con.cursor()

rows = cur.execute("""
  SELECT si.id, si.date, si.startTime, si.groupId
  FROM SessionInstance si
  JOIN "Group" g ON g.id = si.groupId
  WHERE si.scheduleId IS NULL
    AND si.date >= date('now', '+1 day')
    AND (SELECT COUNT(*) FROM Attendance a WHERE a.sessionId = si.id) = 0
""").fetchall()

print("candidate ad-hoc future sessions:", len(rows))
for sid, date, st, gid in rows:
    att = cur.execute("SELECT COUNT(*) FROM Attendance WHERE sessionId=?", (sid,)).fetchone()[0]
    txn = cur.execute("SELECT COUNT(*) FROM StudentTransaction WHERE sessionId=?", (sid,)).fetchone()[0]
    setl = cur.execute("SELECT COUNT(*) FROM TeacherSettlement WHERE sessionId=?", (sid,)).fetchone()[0]
    jr = cur.execute("SELECT COUNT(*) FROM CenterTransaction WHERE refId=?", (sid,)).fetchone()[0]
    print(f"  {sid} {date} {st} att={att} txn={txn} setl={setl} journal={jr}")
    if att == 0 and txn == 0 and setl == 0 and jr == 0:
        cur.execute("DELETE FROM SessionInstance WHERE id=?", (sid,))
        print("  -> deleted (clean)")

con.commit()
print("done. remaining future ad-hoc:", cur.execute("SELECT COUNT(*) FROM SessionInstance WHERE scheduleId IS NULL AND date >= date('now','+1 day')").fetchone()[0])
