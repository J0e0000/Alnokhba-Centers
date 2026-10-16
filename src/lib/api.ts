import "server-only";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap a route handler: converts ApiError → Arabic JSON error, logs unexpected ones */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.message, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api-error]", msg);
      // TEMP-DIAG-REVERT-ME: تفاصيل الخطأ في الاستجابة مؤقتًا لتشخيص 500 الإنتاج — يتشال فور الانتهاء
      const diag =
        e instanceof Error
          ? `${e.name}|${(e as { code?: string }).code ?? "-"}|${msg.slice(0, 240)}`
          : String(e).slice(0, 240);
      if (/unique constraint/i.test(msg)) {
        return fail("القيمة دي موجودة قبل كده — مش هنعملها تاني.", 409);
      }
      return NextResponse.json({ error: "حصل خطأ غير متوقع في السيرفر — جرب تاني.", diag }, { status: 500 });
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError("البيانات المتبعتة مش مظبوطة.", 400);
  }
}
