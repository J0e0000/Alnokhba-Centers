import "server-only";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth";

export function acaOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

/** Wrap academia route handlers: ApiError → proper status + Arabic JSON,
 *  unexpected errors → 500 (never leak stack traces). */
export function acaHandler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[academia-api-error]", msg);
      if (/unique constraint/i.test(msg)) {
        return NextResponse.json({ error: "القيمة دي موجودة قبل كده — مش هنعملها تاني." }, { status: 409 });
      }
      return NextResponse.json({ error: "حصل خطأ غير متوقع في السيرفر — جرب تاني." }, { status: 500 });
    }
  };
}
