"use client";

import { toast } from "sonner";

/* papi — مساعد طلبات البورتال (مستخرج من portal.tsx عشان تاني شاشات البورتال تستخدمه) */

export type PapiError = Error & { status?: number };

export async function papi<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown; silent?: boolean } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    // الشبكة وقعت (نت مقطوع/سيرفر بيحمّل) — دي غلطة مؤقتة، مش خروج
    const err = new Error("مفيش اتصال بالسيرفر دلوقتي — جرب تاني.") as PapiError;
    err.status = 0;
    if (!opts.silent) toast.error(err.message);
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? "حصلت مشكلة مؤقتة — جرب مرة تانية.";
    const err = new Error(msg) as PapiError;
    err.status = res.status;
    if (!opts.silent) toast.error(msg);
    throw err;
  }
  return data as T;
}
