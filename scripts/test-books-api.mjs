// API smoke test for /api/books + fix verification for /api/schedule
const BASE = "http://127.0.0.1:3000";
let cookie = "";
const results = [];
const log = (k, v) => { results.push(`${k}: ${JSON.stringify(v)}`); console.log(k + ":", v); };

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function main() {
  // 1) login manager
  const login = await call("POST", "/api/auth", { username: "manager", password: "nokhba123" });
  log("login", login.status);

  // 2) schedule 500 FIXED?
  const sched = await call("GET", "/api/schedule");
  log("schedule_status", sched.status);
  log("schedule_rooms", sched.data?.rooms?.map((r) => r.name));

  // 3) empty inventory initially
  const initial = await call("GET", "/api/books");
  log("books_initial_count", initial.data?.books?.length);
  log("stats_initial", initial.data?.stats);

  // 4) create a book
  const created = await call("POST", "/api/books", {
    name: "كتاب الفيزياء — الأول الثانوي", price: 150, stock: 20, notes: "الطبعة الجديدة",
  });
  log("create_book", created.status);
  const bookId = created.data?.book?.id;

  // 5) duplicate name blocked
  const dup = await call("POST", "/api/books", { name: "كتاب الفيزياء — الأول الثانوي", price: 100, stock: 5 });
  log("duplicate_blocked", dup.status === 409 ? "YES" : `NO (${dup.status})`);

  // invalid price
  const badPrice = await call("POST", "/api/books", { name: "كتاب تاني", price: 0, stock: 1 });
  log("zero_price_blocked", badPrice.status === 400 ? "YES" : `NO (${badPrice.status})`);

  // 6) sell to a student — lookup first
  const lookup = await call("GET", "/api/lookup?q=" + encodeURIComponent("محمد"));
  const student = lookup.data?.students?.[0];
  log("lookup_student", student ? `${student.name} (${student.code})` : "NONE");

  const sale = await call("PUT", "/api/books", { bookId, qty: 2, studentId: student?.id, method: "CASH" });
  log("sell_to_student", sale.status);
  log("sale_msg", sale.data?.message);

  // 7) sell to walk-in
  const sale2 = await call("PUT", "/api/books", { bookId, qty: 1, buyerName: "أستاذ خالد — من بره", method: "INSTAPAY" });
  log("sell_walkin", sale2.status);

  // 8) oversell blocked (available = 17, try 18)
  const oversell = await call("PUT", "/api/books", { bookId, qty: 50, buyerName: "زبون" });
  log("oversell_blocked", oversell.status === 400 ? "YES" : `NO (${oversell.status})`);

  // 9) GET reflects stock + stats + sales
  const after = await call("GET", "/api/books");
  const b = after.data?.books?.find((x: any) => x.id === bookId);
  log("stock_after_2_sales", b?.stock);
  log("sold_today", `${after.data?.stats?.soldTodayQty} نسخة / ${after.data?.stats?.soldTodayTotal / 100} جنيه`);
  log("sales_log_len", after.data?.sales?.length);
  log("first_sale_buyer", after.data?.sales?.[0]?.buyerName);

  // 10) restock +5
  const restock = await call("PATCH", "/api/books", { id: bookId, addStock: 5 });
  log("restock_status", restock.status);

  // 11) edit price
  const edit = await call("PATCH", "/api/books", { id: bookId, price: 175 });
  log("edit_price_status", edit.status);

  // 12) journal contains BOOK_SALE
  const acc = await call("GET", "/api/accounting?section=journal");
  const bookEntries = (acc.data?.journal ?? []).filter((j: any) => j.type === "BOOK_SALE");
  log("journal_book_sale_entries", bookEntries.length);
  log("journal_entry_note", bookEntries[0]?.note);

  // 13) receptionist can sell but not create
  await call("POST", "/api/auth", { username: "reception", password: "nokhba123" });
  const receptionSell = await call("PUT", "/api/books", { bookId, qty: 1, buyerName: "زبون استقبال" });
  log("reception_sell", receptionSell.status);
  const receptionCreate = await call("POST", "/api/books", { name: "كتاب موظف", price: 50, stock: 1 });
  log("reception_create_blocked", receptionCreate.status === 403 ? "YES" : `NO (${receptionCreate.status})`);

  // 14) delete book with sales → archived
  await call("POST", "/api/auth", { username: "manager", password: "nokhba123" });
  const del = await call("DELETE", `/api/books?id=${bookId}`);
  log("delete_with_sales", del.status === 200 && del.data?.archived === true ? "ARCHIVED (sales kept)" : del.data);

  // cleanup: archived book stays in DB — check it's off the shelf
  const final = await call("GET", "/api/books");
  log("books_after_delete", final.data?.books?.length);

  console.log("\n=== RESULTS ===\n" + results.join("\n"));
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
