"use client";

import { useEffect, useMemo, useState } from "react";
import { mapZakiRobotState, type ZakiRobotState, type ZakiStatusInput } from "./zaki-status";

/* ============================================================
   useZakiRobotState — محوّل حالة الوكيل الحقيقية لحالة الروبوت.
   بيدير الحالات العابرة (نجاح/فشل) بمؤقتات نظيفة وبرجع للحالة
   المحايدة تلقائيًا — الروبوت عمره ما يعلق في حالة خاطئة:
   - طلب جديد → أي transient بيتلغي فورًا (طلبات متداخلة/ملغاة).
   - النجاح يظهر بس بعد تأكيده، والفشل كذلك (§5 rules 4/5/6/7).
   الاشتقاق بيتعمل أثناء الرسم (النمط الرسمي في React لاشتقاق
   الحالة من Props) والمؤقتات بس بتحدّث الحالة بشكل async.
============================================================ */

const CELEBRATE_MS = 2400;
const FAILURE_MS = 2800;

export interface UseZakiRobotStateInput {
  /** حالة الـ orchestrator السيرفرية الخام */
  agentState: string;
  running: boolean;
  listening: boolean;
  transcribing: boolean;
  speaking: boolean;
  /** عدّاد بيزيد مرة واحدة لكل نجاح مؤكد (done → COMPLETED) */
  successTick: number;
  /** عدّاد بيزيد مرة واحدة لكل فشل مؤكد (error event / done → FAILED) */
  failureTick: number;
}

export function useZakiRobotState(input: UseZakiRobotStateInput): ZakiRobotState {
  const [transient, setTransient] = useState<{ kind: "celebrate" | "fail"; seq: number } | null>(null);
  const [prev, setPrev] = useState({ success: 0, failure: 0 });

  /* اشتقاق أثناء الرسم (React: "adjusting state when a prop changes"):
     tick جديد → transient جديد. لو نجاح وفشل حصلوا مع بعض — الفشل أحدث. */
  const successChanged = input.successTick !== prev.success;
  const failureChanged = input.failureTick !== prev.failure;
  if (successChanged || failureChanged) {
    setPrev({ success: input.successTick, failure: input.failureTick });
    if (failureChanged) setTransient({ kind: "fail", seq: input.failureTick });
    else setTransient({ kind: "celebrate", seq: input.successTick });
  }
  // طلب جديد شغال → أي transient قديم بيتلغي فورًا (طلبات متداخلة/ملغاة)
  if (input.running && transient) setTransient(null);

  /* انتهاء صلاحية الـ transient — التحديث جوه callback بتوقيت (async) مش جسم الـ effect */
  useEffect(() => {
    if (!transient) return;
    const ms = transient.kind === "celebrate" ? CELEBRATE_MS : FAILURE_MS;
    const id = window.setTimeout(() => setTransient(null), ms);
    return () => window.clearTimeout(id);
  }, [transient]);

  return useMemo(
    () =>
      mapZakiRobotState({
        agentState: input.agentState,
        running: input.running,
        listening: input.listening,
        transcribing: input.transcribing,
        speaking: input.speaking,
        celebrate: transient?.kind === "celebrate",
        fail: transient?.kind === "fail",
      } satisfies ZakiStatusInput),
    [input.agentState, input.running, input.listening, input.transcribing, input.speaking, transient],
  );
}
