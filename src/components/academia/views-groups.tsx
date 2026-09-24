"use client";

/* Groups view — academic structure: groups, recurring schedule occurrences
   (one group → many times, spec §11), enrollment, conflict dialogs (§12) */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Clock, MapPin, Users2, Repeat2, UserPlus, TriangleAlert, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { acaApi, ApiErr, fmt12, DOW_AR, type AcaUserClient } from "./client";

type GroupRow = {
  id: string; name: string; gradeName: string | null; room: string | null; capacity: number;
  pricePerSession: number | null; isActive: boolean;
  subject: { name: string; color: string }; teacher: { id: string; name: string };
  enrolled: number; scheduleCount: number; sessionCount: number;
};
type Occ = { id: string; dayOfWeek: number; startTime: string; endTime: string; room: string | null; status: string };
type Enr = { id: string; status: string; student: { profileId: string; code: string; name: string } };
type Detail = {
  group: GroupRow & { id: string };
  schedules: Occ[];
  enrollments: Enr[];
};

export function GroupsView({ user }: { user: AcaUserClient }) {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addOccOpen, setAddOccOpen] = useState(false);
  const [addStudentOpen, setAddStudentOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = user.permissions.includes("groups.manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await acaApi<{ groups: GroupRow[] }>("/api/academia/groups");
      setGroups(d.groups);
      if (user.permissions.includes("teachers.view")) {
        const t = await acaApi<{ teachers: { id: string; name: string }[] }>("/api/academia/teachers", { silent: true });
        setTeachers(t.teachers.filter((x) => x.id).map((x) => ({ id: x.id, name: x.name })));
      }
    } finally {
      setLoading(false);
    }
  }, [user.permissions]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const d = await acaApi<Detail>(`/api/academia/groups/${id}`);
      setDetail(d);
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-black">المجموعات</h2>
        {canManage && (
          <Button className="rounded-xl font-extrabold nk-brand-bg text-white" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> مجموعة جديدة
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-muted-foreground" /></div>
      ) : groups.length === 0 ? (
        <div className="rounded-3xl border border-dashed p-10 text-center">
          <p className="font-extrabold">مفيش مجموعات لسه</p>
          <p className="text-sm text-muted-foreground">ابدأ بمجموعة واحدة لكل مادة ومستوى.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {groups.map((g) => (
            <button key={g.id} onClick={() => openDetail(g.id)}
              className="text-start rounded-3xl border border-border bg-white/80 dark:bg-white/5 p-4 hover:shadow-md transition">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.subject.color }} />
                <span className="nk-subject-text text-xs font-extrabold" style={{ "--subject-color": g.subject.color } as React.CSSProperties}>{g.subject.name}</span>
                {!g.isActive && <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">موقوفة</span>}
              </div>
              <p className="font-black mt-1.5 truncate">{g.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{g.gradeName ?? "—"} · أ. {g.teacher.name}</p>
              <div className="flex items-center gap-3 mt-2 text-[11px] font-bold text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Users2 className="w-3.5 h-3.5" />{g.enrolled}/{g.capacity}</span>
                <span className="inline-flex items-center gap-1"><Repeat2 className="w-3.5 h-3.5" />{g.scheduleCount} مواعيد/أسبوع</span>
                <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{g.sessionCount} حصة</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ---------- create group ---------- */}
      <CreateGroupDialog open={createOpen} onClose={() => setCreateOpen(false)} teachers={teachers} onDone={() => { setCreateOpen(false); load(); }} />
      {/* ---------- detail ---------- */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto rounded-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="text-start font-black">{detail.group.name}</DialogTitle>
                <DialogDescription className="text-start">
                  {detail.group.subject.name} · أ. {detail.group.teacher.name} · {detail.group.gradeName ?? "—"}
                </DialogDescription>
              </DialogHeader>

              {/* schedule occurrences */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-extrabold text-sm">المواعيد الأسبوعية ({detail.schedules.length})</h3>
                  {canManage && (
                    <Button size="sm" variant="outline" className="rounded-xl font-extrabold" onClick={() => setAddOccOpen(true)}>
                      <Plus className="w-3.5 h-3.5" /> موعد
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {detail.schedules.map((o) => (
                    <div key={o.id} className={`flex items-center justify-between rounded-xl border p-2.5 text-sm ${o.status === "CANCELLED" ? "opacity-50 border-red-200" : "border-border"}`}>
                      <span className="font-bold">{DOW_AR[o.dayOfWeek]} · {fmt12(o.startTime)}–{fmt12(o.endTime)}</span>
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{o.room ?? "—"}</span>
                    </div>
                  ))}
                  {detail.schedules.length === 0 && <p className="text-sm text-muted-foreground">مفيش مواعيد — ضيف أول موعد أسبوعي.</p>}
                </div>
              </section>

              {/* enrollments */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-extrabold text-sm">الطلاب ({detail.enrollments.filter((e) => e.status === "ACTIVE").length})</h3>
                  <Button size="sm" variant="outline" className="rounded-xl font-extrabold" onClick={() => setAddStudentOpen(true)}>
                    <UserPlus className="w-3.5 h-3.5" /> تسجيل طالب
                  </Button>
                </div>
                <div className="grid gap-1.5 max-h-56 overflow-y-auto">
                  {detail.enrollments.map((e) => (
                    <div key={e.id} className="flex items-center justify-between rounded-xl border border-border p-2 text-sm">
                      <span className="font-bold">{e.student.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground" dir="ltr">{e.student.code}</span>
                        {e.status !== "ACTIVE" && <span className="text-[10px] font-extrabold text-red-600">{e.status === "PAUSED" ? "موقوف" : "منسحب"}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>

      {detail && <AddOccDialog open={addOccOpen} onClose={() => setAddOccOpen(false)} groupId={detail.group.id}
        teacherMode={user.role === "TEACHER"}
        onDone={async (msg) => { setAddOccOpen(false); toast.success(msg ?? "اتضاف"); await openDetail(detail.group.id); load(); }} />}
      {detail && <AddStudentDialog open={addStudentOpen} onClose={() => setAddStudentOpen(false)} groupId={detail.group.id}
        existingIds={detail.enrollments.filter((e) => e.status === "ACTIVE").map((e) => e.student.profileId)}
        onDone={async () => { setAddStudentOpen(false); toast.success("اتسجل الطالب"); await openDetail(detail.group.id); load(); }} />}
    </div>
  );
}

/* ---------- dialogs ---------- */

function CreateGroupDialog({ open, onClose, teachers, onDone }: {
  open: boolean; onClose: () => void; teachers: { id: string; name: string }[]; onDone: () => void;
}) {
  const [name, setName] = useState(""); const [subject, setSubject] = useState(""); const [teacherId, setTeacherId] = useState("");
  const [gradeName, setGradeName] = useState(""); const [room, setRoom] = useState(""); const [capacity, setCapacity] = useState("20");
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) acaApi<{ subjects: { id: string; name: string }[] }>("/api/academia/subjects", { silent: true }).then((d) => setSubjects(d.subjects)).catch(() => {});
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      await acaApi("/api/academia/groups", { method: "POST", body: JSON.stringify({ name, subjectId: subject, teacherId, gradeName, room, capacity: Number(capacity) }) });
      toast.success("اتعملت المجموعة");
      setName(""); setSubject(""); setTeacherId(""); setGradeName(""); setRoom(""); setCapacity("20");
      onDone();
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader><DialogTitle className="text-start">مجموعة جديدة</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المجموعة — مثال: الرياضيات — أولى ثانوي — A" className="h-11 rounded-2xl font-bold" />
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="h-11 rounded-2xl font-bold"><SelectValue placeholder="المادة" /></SelectTrigger>
            <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger className="h-11 rounded-2xl font-bold"><SelectValue placeholder="المدرس" /></SelectTrigger>
            <SelectContent>{teachers.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-3 gap-2">
            <Input value={gradeName} onChange={(e) => setGradeName(e.target.value)} placeholder="الصف" className="h-11 rounded-2xl font-bold" />
            <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="القاعة" className="h-11 rounded-2xl font-bold" />
            <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" placeholder="السعة" className="h-11 rounded-2xl font-bold" />
          </div>
          <Button disabled={busy || !name || !subject || !teacherId} onClick={submit} className="w-full h-11 rounded-2xl font-extrabold nk-brand-bg text-white">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "إنشاء المجموعة"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddOccDialog({ open, onClose, groupId, onDone, teacherMode }: {
  open: boolean; onClose: () => void; groupId: string; onDone: (msg?: string) => void; teacherMode: boolean;
}) {
  const [day, setDay] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const [room, setRoom] = useState("");
  const [conflicts, setConflicts] = useState<{ message: string }[]>([]); const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setConflicts([]);
    try {
      const res = await acaApi<{ requested?: boolean; message?: string }>(`/api/academia/groups/${groupId}`, {
        method: "POST", body: JSON.stringify({ action: "addSchedule", dayOfWeek: Number(day), startTime: start, endTime: end, room }),
      });
      onDone(res.requested ? res.message : "اتضاف الموعد الأسبوعي");
    } catch (e) {
      if (e instanceof ApiErr && e.conflicts) setConflicts(e.conflicts);
      else if (e instanceof ApiErr) toast.error(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-start">موعد أسبوعي جديد</DialogTitle>
          <DialogDescription className="text-start">المجموعة الواحدة ليها أكتر من موعد — كل موعد له وجوده المستقل في الجدول والحصص.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={day} onValueChange={setDay}>
            <SelectTrigger className="h-11 rounded-2xl font-bold"><SelectValue placeholder="اليوم" /></SelectTrigger>
            <SelectContent>{DOW_AR.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-11 rounded-2xl font-bold" aria-label="من" />
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-11 rounded-2xl font-bold" aria-label="إلى" />
          </div>
          <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="القاعة (اختياري)" className="h-11 rounded-2xl font-bold" />

          {conflicts.length > 0 && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-1.5">
              <p className="font-extrabold text-sm text-amber-800 dark:text-amber-300 flex items-center gap-1.5"><TriangleAlert className="w-4 h-4" /> في تعارضات لازم تتحل الأول:</p>
              <ul className="list-disc ps-5 text-xs font-bold text-amber-800 dark:text-amber-300 space-y-1">
                {conflicts.map((c, i) => <li key={i}>{c.message}</li>)}
              </ul>
            </div>
          )}

          <Button disabled={busy || !day || !start || !end} onClick={submit} className="w-full h-11 rounded-2xl font-extrabold nk-brand-bg text-white">
            <Send className="w-4 h-4" /> {teacherMode ? "ابعت طلب للإدارة" : "إضافة الموعد"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddStudentDialog({ open, onClose, groupId, existingIds, onDone }: {
  open: boolean; onClose: () => void; groupId: string; existingIds: string[]; onDone: () => void;
}) {
  const [q, setQ] = useState(""); const [students, setStudents] = useState<{ profileId: string; code: string; name: string }[]>([]); const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!open) return;
    acaApi<{ students: { profileId: string; code: string; name: string }[] }>(`/api/academia/students?q=${encodeURIComponent(q)}`, { silent: true })
      .then((d) => setStudents(d.students.filter((s) => !existingIds.includes(s.profileId))))
      .catch(() => {});
  }, [q, open, existingIds]);

  const enroll = async (sid: string) => {
    setBusy(sid);
    try {
      await acaApi(`/api/academia/groups/${groupId}`, { method: "POST", body: JSON.stringify({ action: "addEnrollment", studentId: sid }) });
      onDone();
    } catch (e) { if (e instanceof ApiErr) toast.error(e.message); } finally { setBusy(""); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader><DialogTitle className="text-start">تسجيل طالب في المجموعة</DialogTitle></DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الكود" className="h-11 rounded-2xl font-bold" />
        <div className="grid gap-1.5 max-h-72 overflow-y-auto">
          {students.map((s) => (
            <button key={s.profileId} disabled={!!busy} onClick={() => enroll(s.profileId)}
              className="flex items-center justify-between rounded-xl border border-border p-2.5 text-sm hover:bg-muted/50 disabled:opacity-50">
              <span className="font-bold">{s.name}</span>
              <span className="text-[11px] text-muted-foreground" dir="ltr">{s.code}</span>
            </button>
          ))}
          {students.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">مفيش نتائج</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
