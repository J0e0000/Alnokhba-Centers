"use client";

/* Exams & grades view — grade entry with audited changes (spec §8, §32) */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { acaApi, ApiErr, fmtDate, type AcaUserClient } from "./client";
import { cn } from "@/lib/utils";

type ExamRow = { id: string; title: string; type: string; date: string; maxScore: number; subject: { name: string; color: string }; group: { name: string }; graded?: number; myScore?: number | null };

export function ExamsView({ user }: { user: AcaUserClient }) {
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState<{ exam: ExamRow } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const isStudent = user.role === "STUDENT";
  const canManage = user.permissions.includes("exams.manage");
  const canGrade = user.permissions.includes("grades.edit");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await acaApi<{ exams: ExamRow[] }>("/api/academia/exams");
      setExams(d.exams);
      if (!isStudent) {
        const g = await acaApi<{ groups: { id: string; name: string }[] }>("/api/academia/groups", { silent: true });
        setGroups(g.groups);
      }
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setLoading(false); }
  }, [isStudent]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-black">{isStudent ? "امتحاناتي ودرجاتي" : "الامتحانات والدرجات"}</h2>
        {canManage && (
          <Button className="rounded-xl font-extrabold nk-brand-bg text-white" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> امتحان جديد
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : exams.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center">
          <FileCheck2 className="w-9 h-9 mx-auto text-muted-foreground" />
          <p className="font-extrabold mt-2">مفيش امتحانات لسه</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {exams.map((e) => (
            <ExamCard key={e.id} e={e} isStudent={isStudent} canGrade={canGrade} onGrade={() => setGrading({ exam: e })} />
          ))}
        </div>
      )}

      {createOpen && <CreateExam groups={groups} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); load(); }} />}
      {grading && <GradeDialog exam={grading.exam} onClose={() => setGrading(null)} onDone={() => { setGrading(null); load(); }} />}
    </div>
  );
}

function ExamCard({ e, isStudent, canGrade, onGrade }: { e: ExamRow; isStudent: boolean; canGrade: boolean; onGrade: () => void }) {
  const pct = isStudent ? (e.myScore != null ? Math.round((e.myScore / e.maxScore) * 100) : null) : null;
  return (
    <div className="rounded-2xl border border-border bg-white/80 dark:bg-white/5 p-3.5 flex items-center gap-3">
      <div className="w-1.5 self-stretch rounded-full" style={{ background: e.subject.color }} />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-sm truncate">{e.title}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {e.subject.name} · {e.group.name} · {fmtDate(e.date)}{!isStudent && e.graded != null ? ` · مرصود: ${e.graded}` : ""}
        </p>
      </div>
      {isStudent ? (
        <span className={cn("font-black text-lg shrink-0", pct != null && pct >= 85 && "text-emerald-600", pct != null && pct < 60 && "text-red-600")}>
          {e.myScore ?? "—"}<span className="text-xs text-muted-foreground">/{e.maxScore}</span>
        </span>
      ) : canGrade ? (
        <Button size="sm" variant="outline" className="rounded-xl font-extrabold shrink-0" onClick={onGrade}>رصد الدرجات</Button>
      ) : null}
    </div>
  );
}

function CreateExam({ groups, onClose, onDone }: { groups: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [groupId, setGroupId] = useState(""); const [title, setTitle] = useState(""); const [type, setType] = useState("QUIZ");
  const [date, setDate] = useState(""); const [maxScore, setMaxScore] = useState("20"); const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await acaApi("/api/academia/exams", { method: "POST", body: JSON.stringify({ action: "create", groupId, title, type, date, maxScore: Number(maxScore) }) });
      toast.success("اتعمل الامتحان");
      onDone();
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader><DialogTitle className="text-start">امتحان جديد</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="العنوان — مثال: كويز الجبر" className="h-11 rounded-2xl font-bold" />
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-11 rounded-2xl font-bold"><SelectValue placeholder="المجموعة" /></SelectTrigger>
            <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-3 gap-2">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-11 rounded-2xl font-bold"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="QUIZ">كويز</SelectItem>
                <SelectItem value="MIDTERM">نصفي</SelectItem>
                <SelectItem value="FINAL">نهائي</SelectItem>
                <SelectItem value="PRACTICAL">عملي</SelectItem>
                <SelectItem value="ASSIGNMENT">واجب كبير</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-2xl font-bold col-span-2" aria-label="التاريخ" />
          </div>
          <Input type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} placeholder="الدرجة الكاملة" className="h-11 rounded-2xl font-bold" />
          <Button disabled={busy || !title || !groupId || !date} onClick={submit} className="w-full h-11 rounded-2xl font-extrabold nk-brand-bg text-white">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "إنشاء"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GradeDialog({ exam, onClose, onDone }: { exam: ExamRow; onClose: () => void; onDone: () => void }) {
  const [roster, setRoster] = useState<{ profileId: string; code: string; name: string }[]>([]);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    type GD = {
      roster: { profileId: string; code: string; name: string }[];
      results: { studentId: string; score: number | null }[];
    };
    acaApi<GD>("/api/academia/exams", { method: "PUT", body: JSON.stringify({ examId: exam.id }) })
      .then((d) => {
        setRoster(d.roster);
        const s: Record<string, string> = {};
        d.results.forEach((r) => (s[r.studentId] = r.score?.toString() ?? ""));
        setScores(s);
      })
      .catch((e) => { if (e instanceof ApiErr) toast.error(e.message); onClose(); });
  }, [exam.id, onClose]);

  const submit = async () => {
    setBusy(true);
    try {
      const results = roster.map((r) => ({ studentId: r.profileId, score: scores[r.profileId] === "" ? null : Number(scores[r.profileId] ?? null) }));
      const d = await acaApi<{ changed: number }>("/api/academia/exams", { method: "POST", body: JSON.stringify({ action: "results", examId: exam.id, results }) });
      toast.success(d.changed > 0 ? `اتحفظت الدرجات (${d.changed} تغيير مسجل في التدقيق)` : "مفيش تغييرات");
      onDone();
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-start">رصد الدرجات — {exam.title}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground font-bold -mt-1">الدرجة من {exam.maxScore} — كل تعديل بيتسجل في سجل التدقيق (مين وإمتى وقبل وبعد).</p>
        <div className="grid gap-1.5 max-h-[50dvh] overflow-y-auto">
          {roster.map((r) => (
            <div key={r.profileId} className="flex items-center gap-2">
              <span className="font-bold text-sm flex-1 truncate">{r.name}</span>
              <Input
                type="number" min={0} max={exam.maxScore} inputMode="numeric" dir="ltr"
                value={scores[r.profileId] ?? ""}
                onChange={(e) => setScores((m) => ({ ...m, [r.profileId]: e.target.value }))}
                className="w-20 h-10 rounded-xl text-center font-black" aria-label={`درجة ${r.name}`}
              />
            </div>
          ))}
        </div>
        <Button disabled={busy} onClick={submit} className="w-full h-11 rounded-2xl font-extrabold nk-brand-bg text-white">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ الدرجات"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
