# -*- coding: utf-8 -*-
"""Descope schema.prisma: remove ALL academic models/fields (quizzes, exams,
assignments, session exams, academia module). Attendance + financial stay."""
import sys

P = "/home/z/my-project/prisma/schema.prisma"
lines = open(P, encoding="utf-8").read().split("\n")  # 0-indexed

def cut(a, b, why):
    """delete lines a..b (1-indexed inclusive)"""
    global lines
    assert a >= 1 and b <= len(lines), (a, b, len(lines))
    seg = "\n".join(lines[a - 1 : b])
    # sanity anchors to make sure we cut the right block
    print(f"CUT {a}..{b} ({b-a+1} lines) — {why}\n   first: {lines[a-1].strip()!r}\n   last : {lines[b-1].strip()!r}")
    del lines[a - 1 : b]

def drop(needle, why, count=1):
    global lines
    hits = [i for i, l in enumerate(lines) if needle in l]
    assert len(hits) == count, f"{needle!r}: expected {count} hits, got {len(hits)} -> {hits}"
    for i in sorted(hits, reverse=True):
        print(f"DROP L{i+1} — {why}: {lines[i].strip()!r}")
        del lines[i]

# ---- 1) big model blocks (bottom-up so line numbers stay valid) ----
cut(1768, 1937, "ONLINE EXAMS (Exam/ExamQuestion/ExamAttempt/ExamAnswer/ExamSecurityEvent) + ASSIGNMENTS (Assignment/AssignmentQuestion/AssignmentSubmission)")
cut(1618, 1677, "QUIZZES (Quiz/QuizQuestion/QuizAttempt)")
cut(1089, 1456, "ALNOKHBA ACADEMIA block (AcademicTerm..AcaInsight + header comments)")
cut(403, 435, "SessionExam + SessionExamScore")

# ---- 2) field/relation removals by exact text ----
drop("quizzes          Quiz[]", "Center.quizzes")
drop("exams            Exam[]", "Center.exams")
drop("assignments      Assignment[]", "Center.assignments")

drop("// ALNOKHBA ACADEMIA — product scope + granular academia permission overrides", "User academia comment")
drop('scope           String   @default("centers")', "User.scope")
drop("acaPermissions  String?", "User.acaPermissions")
drop('acaTeacherGroups   AcaGroup[]', "User.acaTeacherGroups")
drop('acaTeacherSessions AcaSession[]', "User.acaTeacherSessions")
drop("acaStudentProfile  AcaStudentProfile?", "User.acaStudentProfile")
drop('acaRequestsMade    AcaRequest[]', "User.acaRequestsMade")
drop('acaRequestsDecided AcaRequest[]', "User.acaRequestsDecided")
drop("acaNotifications   AcaNotification[]", "User.acaNotifications")

drop("quizzes        Quiz[]", "Group.quizzes")
drop("exams          Exam[]", "Group.exams")
drop("assignments    Assignment[]", "Group.assignments")

drop("quizAttempts QuizAttempt[]", "Student.quizAttempts")
drop("examAttempts ExamAttempt[]", "Student.examAttempts")
drop("assignmentSubmissions AssignmentSubmission[]", "Student.assignmentSubmissions")
drop("sessionExamScores SessionExamScore[]", "Student.sessionExamScores")

# ---- 3) SessionInstance/Attendance field blocks (text-anchored cuts, drop-order-safe) ----
def cut_block(start_anchor, end_anchor, why):
    global lines
    s = next(i for i, l in enumerate(lines) if start_anchor in l)
    e = next(i for i, l in enumerate(lines) if i > s and end_anchor in l)
    print(f"CUTBLOCK {s+1}..{e+1} — {why}\n   first: {lines[s].strip()!r}\n   last : {lines[e].strip()!r}")
    del lines[s : e + 1]

cut_block("// ===== تقرير الحصة (نقل من منصة النخبة الأساسية — workflow الحصص) =====",
          "videoLink     String?", "SessionInstance lessonTopic/homeworkText/videoLink block")
drop("exam          SessionExam?", "SessionInstance.exam relation")
cut_block("// ===== التفاعل والواجب (نقل من منصة النخبة الأساسية — workflow الحصص) =====",
          "interactionMinus Int @default(0)", "Attendance homeworkStatus/interactionPlus/interactionMinus block")

drop('scope         String   @default("CENTERS")', "SessionQRToken.scope")
lines = [l.replace("centerId      String? // null للـ ACADEMIA (مفيش multi-tenant هناك)",
                   "centerId      String?") for l in lines]
lines = [l.replace("sessionId     String // SessionInstance.id أو AcaSession.id حسب scope",
                   "sessionId     String // SessionInstance.id") for l in lines]

out = "\n".join(lines)
# final sanity: no academic identifiers left
import re
bad = re.findall(r"model (Quiz|Exam|Assignment|SessionExam|Aca|Academic)\w*", out)
assert not bad, f"leftover academic models: {bad}"
for kw in ("Quiz", "QuizAttempt", "SessionExam", "AcaGroup", "Assignment", "homeworkStatus",
           "interactionPlus", "lessonTopic", "videoLink", "acaPermissions"):
    hits = [i + 1 for i, l in enumerate(out.split("\n")) if kw in l]
    if hits:
        print(f"WARN leftover {kw}: {hits}")
open(P, "w", encoding="utf-8").write(out)
print("OK — schema now", len(out.split("\n")), "lines")
