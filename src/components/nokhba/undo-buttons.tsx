"use client";

import { useCallback, useEffect, useState } from "react";
import { Undo2, Redo2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "./lib";

/* تراجع/إعادة (spec §13) — أزرار سريعة في الهيدر.
   بتنفّذ آخر عملية قابلة للعكس بتاعة المستخدم الحالي، وبعدها تحديث الصفحة
   عشان كل الشاشات تظهر آخر حالة — نفس سلوك انتهاء الجلسة. */

type UndoData = {
  undoable: { id: string; label: string }[];
  redoable: { id: string; label: string }[];
};

export function UndoRedoButtons() {
  const [data, setData] = useState<UndoData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<UndoData>("/api/undo", { silent: true }).then(setData).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(op: "undo" | "redo") {
    if (busy) return;
    const latest = op === "undo" ? data?.undoable?.[0] : data?.redoable?.[0];
    if (!latest) {
      toast.info(op === "undo" ? "مفيش حاجة تتراجع." : "مفيش حاجة تتلفظ تاني.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ label: string }>("/api/undo", { method: "POST", body: { op } });
      toast.success(op === "undo" ? `تم التراجع: ${res.label}` : `تمت الإعادة: ${res.label}`);
      // إعادة تحميل خفيفة — كل الشاشات بتتجهز من السيرفر
      setTimeout(() => window.location.reload(), 450);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "مينفعش التراجع على العملية دي.");
    } finally {
      setBusy(false);
    }
  }

  const canUndo = !!data?.undoable?.length;
  const canRedo = !!data?.redoable?.length;

  return (
    <div className="flex items-center gap-1 print:hidden" role="group" aria-label="تراجع وإعادة">
      <button
        onClick={() => run("undo")}
        disabled={busy || !canUndo}
        title={canUndo ? `تراجع: ${data?.undoable[0]?.label}` : "مفيش حاجة تتراجع"}
        aria-label="تراجع"
        className={cn("w-9 h-9 rounded-xl grid place-items-center border border-border bg-card transition",
          canUndo ? "text-muted-foreground hover:text-foreground hover:bg-muted/60" : "opacity-40 cursor-not-allowed")}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
      </button>
      <button
        onClick={() => run("redo")}
        disabled={busy || !canRedo}
        title={canRedo ? `إعادة: ${data?.redoable[0]?.label}` : "مفيش حاجة تتلفظ"}
        aria-label="إعادة"
        className={cn("w-9 h-9 rounded-xl grid place-items-center border border-border bg-card transition",
          canRedo ? "text-muted-foreground hover:text-foreground hover:bg-muted/60" : "opacity-40 cursor-not-allowed")}
      >
        <Redo2 className="w-4 h-4" />
      </button>
    </div>
  );
}
