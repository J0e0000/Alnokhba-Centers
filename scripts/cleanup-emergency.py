#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تنضيف بيانات اختبارات الطوارئ والإعلانات والبورتال — يرجّع الداتابيز لحالتها."""
import sqlite3, json, glob, os

DB = "/home/z/my-project/db/custom.db"
con = sqlite3.connect(DB)
cur = con.cursor()

def count(sql, args=()):
    cur.execute(sql, args)
    return cur.fetchone()[0]

report = []

# 1) معاملات وحضور الطوارئ التجريبية (idemKey EMG)
emg_txns = count("SELECT COUNT(*) FROM StudentTransaction WHERE idemKey LIKE 'EMG-%' OR idemKey LIKE 'chg-EMG-%'")
cur.execute("SELECT DISTINCT sessionId FROM StudentTransaction WHERE idemKey LIKE 'chg-EMG-%' AND sessionId IS NOT NULL")
emg_sessions = [r[0] for r in cur.fetchall()]
cur.execute("DELETE FROM StudentTransaction WHERE idemKey LIKE 'EMG-%' OR idemKey LIKE 'chg-EMG-%'")

emg_att = count("SELECT COUNT(*) FROM Attendance WHERE idemKey LIKE 'EMG-%'")
cur.execute("SELECT DISTINCT sessionId FROM Attendance WHERE idemKey LIKE 'EMG-%'")
att_sessions = [r[0] for r in cur.fetchall()]
cur.execute("DELETE FROM Attendance WHERE idemKey LIKE 'EMG-%'")
report.append(f"transactions EMG: {emg_txns} حذفت · attendance EMG: {emg_att} حذفوا")

# 2) الحصص اللي عملها الاستيراد التجريبي (بقى فيها صفر حضور بعد التنضيف)
for sid in set(emg_sessions + att_sessions):
    if not sid:
        continue
    cur.execute("SELECT COUNT(*) FROM Attendance WHERE sessionId=?", (sid,))
    if cur.fetchone()[0] == 0:
        # اتفتحت من الاستيراد؟ بص على أسباب الحركات المرتبطة بيها
        cur.execute("SELECT COUNT(*) FROM StudentTransaction WHERE sessionId=? AND reason LIKE '%طوارئ%'", (sid,))
        if cur.fetchone()[0] == 0:
            cur.execute("DELETE FROM SessionInstance WHERE id=?", (sid,))
            report.append(f"session {sid[:8]}… حذفت (طارئ تجريبي)")

# 3) سجل مزامنات الطوارئ التجريبية
n = count("SELECT COUNT(*) FROM EmergencyImport WHERE fileName LIKE '%test%' OR fileName LIKE '%junk%'")
cur.execute("DELETE FROM EmergencyImport")
report.append(f"emergency imports: {n} حذفت")

# 4) إعلانات الاختبار + إشعاراتها
ids = []
for p in ["/tmp/test-ann-ids.json"]:
    if os.path.exists(p):
        ids = json.load(open(p))
if ids:
    qmarks = ",".join("?" * len(ids))
    cur.execute(f"DELETE FROM StudentNotification WHERE announcementId IN ({qmarks})", ids)
    cur.execute(f"DELETE FROM Announcement WHERE id IN ({qmarks})", ids)
    report.append(f"announcements (ids): {len(ids)} حذفت")
n2 = count("SELECT COUNT(*) FROM Announcement WHERE title LIKE 'اختبار%'")
cur.execute("DELETE FROM StudentNotification WHERE announcementId IN (SELECT id FROM Announcement WHERE title LIKE 'اختبار%')")
cur.execute("DELETE FROM Announcement WHERE title LIKE 'اختبار%'")
report.append(f"announcements (title): {n2} حذفت")

# 5) إشعارات تغيير الجدول التجريبية (من الاختبار)
n3 = count("SELECT COUNT(*) FROM StudentNotification WHERE type IN ('TIME_CHANGE','LOCATION_CHANGE','SCHEDULE_CHANGE')")
cur.execute("DELETE FROM StudentNotification WHERE type IN ('TIME_CHANGE','LOCATION_CHANGE','SCHEDULE_CHANGE')")
report.append(f"schedule-change notifications: {n3} حذفت")

# 6) جلسات بورتال الطالب التجريبية + اشتراكات push تجريبية
n4 = count("SELECT COUNT(*) FROM StudentPortalSession")
cur.execute("DELETE FROM StudentPortalSession")
cur.execute("DELETE FROM PushSubscription WHERE endpoint LIKE '%test.example%'")
report.append(f"portal sessions: {n4} حذفت")

# 7) إشعارات طالب الاختبار المتبقية (ANNOUNCEMENT من غير إعلان موجود)
n5 = count("SELECT COUNT(*) FROM StudentNotification WHERE announcementId IS NULL AND type='ANNOUNCEMENT'")
cur.execute("DELETE FROM StudentNotification WHERE announcementId IS NULL AND type='ANNOUNCEMENT'")
report.append(f"orphan announcement notifications: {n5} حذفت")

con.commit()

# تحقق نهائي
students = count("SELECT COUNT(*) FROM Student WHERE status != 'ARCHIVED'")
print("\n".join(report))
print(f"\nالطلاب (غير الأرشيف): {students}")
cur.close()
con.close()
print("OK — الداتابيز نضيفة")
