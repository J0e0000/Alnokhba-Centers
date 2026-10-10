#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Replace dashboard hero+table section with lesson cards (surgical line replacement)."""

PATH = "/home/z/my-project/src/components/nokhba/dashboard.tsx"

NEW_SECTION = '''      {/* ===== Now / next quick banner ===== */}
      {(nowSession || nextSession) && (
        <div className="grid md:grid-cols-2 gap-3">
          <SessionHero title="شغالة دلوقتي" session={nowSession ?? undefined} emptyText="مفيش حصة شغالة حالياً" onOpen={openSession} cta="افتح الحصة" />
          <SessionHero title="الميعاد الجاي" session={nextSession ?? (nowSession ? undefined : data.sessions.find((s) => s.status === "OPEN"))} emptyText="خلصت حصص النهاردة 🎉" onOpen={openSession} cta="التفاصيل" />
        </div>
      )}

      {/* ===== Today's lessons — كروت واضحة ===== */}
      <SectionCard title="حصص النهاردة" icon={<CalendarDays className="w-4 h-4" />}>
        {data.sessions.length === 0 && planned.length === 0 ? (
          <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="مفيش حصص النهاردة" hint="شوف الجدول الأسبوعي أو ضيف حصة جديدة." />
        ) : (
          <div className="space-y-3">
            {/* الحصص المفتوحة/المقفولة فعليًا */}
            {data.sessions.map((s) => {
              const phase = sessionPhase(s.startTime, s.endTime);
              const isOpen = s.status === "OPEN";
              const running = isOpen && phase === "now";
              return (
                <div
                  key={s.id}
                  className={cn(
                    "rounded-2xl border p-4 flex items-center gap-3.5 transition",
                    running ? "border-emerald-300 bg-emerald-50/70" :
                    isOpen ? "border-[color-mix(in_srgb,var(--c-primary)_30%,white)] bg-white" :
                    "border-border bg-muted/40 opacity-80",
                  )}
                >
                  <button onClick={() => openSession(s.id)} className="flex-1 min-w-0 text-start">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        "nk-num text-center rounded-xl py-1.5 px-2.5 text-sm font-extrabold border",
                        running ? "bg-emerald-500 text-white border-transparent" : "bg-white border-border",
                      )} dir="ltr">
                        {formatTime12(s.startTime)}
                      </span>
                      <span className="font-extrabold text-[15px]">{s.subject} — {s.grade} {s.groupName}</span>
                      {running && <span className="text-[11px] font-extrabold text-emerald-700">🟢 الحصة شغالة</span>}
                      {s.status === "CLOSED" && <span className="text-[11px] font-bold text-muted-foreground inline-flex items-center gap-1"><DoorClosed className="w-3.5 h-3.5" /> مقفولة</span>}
                    </div>
                    <p className="text-xs font-bold text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                      <span>{s.teacher}</span>
                      {s.room && <span className="nk-brand-text font-extrabold">{s.room}</span>}
                      <span className="nk-num">{fmt(s.price)} ج · حضر {s.presentCount}</span>
                      {s.status === "CLOSED" && s.closedAggregates && (
                        <span className="nk-num text-emerald-700 font-extrabold">إيراد {fmt(s.closedAggregates.totalRevenue)} ج</span>
                      )}
                    </p>
                  </button>
                  {isOpen && (
                    <button
                      onClick={() => goScanForSession(s.id)}
                      className="shrink-0 rounded-xl px-4 py-3 font-extrabold text-sm flex items-center gap-2 active:scale-[0.98] transition shadow nk-brand-bg text-white"
                    >
                      <Zap className="w-4.5 h-4.5" />
                      امسح الحضور
                    </button>
                  )}
                </div>
              );
            })}

            {/* حصص مخططة من الجدول — لسه مش مفتوحة */}
            {planned.map((p) => {
              const phase = sessionPhase(p.startTime, p.endTime);
              return (
                <div key={`plan-${p.scheduleId}`} className="rounded-2xl border-2 border-dashed border-border bg-white p-4 flex items-center gap-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="nk-num text-center rounded-xl py-1.5 px-2.5 text-sm font-extrabold border border-dashed bg-muted/60 text-muted-foreground" dir="ltr">
                        {formatTime12(p.startTime)}
                      </span>
                      <span className="font-extrabold text-[15px]">{p.subject} — {p.grade} {p.groupName}</span>
                      {phase === "now" && <span className="text-[11px] font-extrabold text-amber-600">الوقت شغال</span>}
                    </div>
                    <p className="text-xs font-bold text-muted-foreground mt-1.5 flex items-center gap-2 flex-wrap">
                      <span>{p.teacher}</span>
                      {p.room && <span className="nk-brand-text font-extrabold">{p.room}</span>}
                      <span className="nk-num">{fmt(p.price)} ج · {p.students} طالب</span>
                    </p>
                  </div>
                  <button
                    onClick={() => openLesson(p.scheduleId)}
                    disabled={opening === p.scheduleId}
                    className="shrink-0 rounded-xl px-4 py-3 font-extrabold text-sm flex items-center gap-2 active:scale-[0.98] transition shadow border-2 border-[color-mix(in_srgb,var(--c-primary)_35%,white)] bg-white nk-brand-text disabled:opacity-60"
                  >
                    {opening === p.scheduleId ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <LockOpen className="w-4.5 h-4.5" />}
                    فتح الحصة
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
'''

with open(PATH, "r", encoding="utf-8") as f:
    lines = f.readlines()

# lines are 0-indexed; replace file lines 134..141 (1-indexed 134..241 inclusive)
start_idx = 133  # line 134 (0-indexed)
end_idx = 241    # replaces 1-indexed lines 134..241 → indices 133..240

# sanity checks
assert "Now / next session hero" in lines[start_idx], lines[start_idx]
assert lines[end_idx - 1].strip().startswith("</SectionCard>"), lines[end_idx - 1]
assert "Manager: cash + teachers" in lines[end_idx + 1], lines[end_idx + 1]

new_lines = lines[:start_idx] + [NEW_SECTION] + lines[end_idx:]
with open(PATH, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print("OK — dashboard section replaced")
print("".join(new_lines[start_idx - 2:start_idx + 3]))
