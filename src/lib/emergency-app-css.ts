// CSS نظام الطوارئ الأوفلاين — نفس هوية النظام الأساسي (كحلي 143159 / ذهبي D5A134)
// بلا أي مورد خارجي: الخطوط مدمجة base64 واللوجو مدمج data-URL.

export const APP_CSS = `
:root{
  --navy:#143159; --navy-2:#1D4477; --navy-soft:#EDF1F7; --navy-50:#F5F7FA;
  --gold:#D5A134; --gold-deep:#A8761F; --gold-soft:#FBF3E0;
  --bg:#F5F7FA; --card:#FFFFFF; --border:#E3E9F0; --text:#1B2635; --muted:#64748B;
  --ok:#16A34A; --ok-soft:#EAF7EF; --warn:#EA580C; --warn-soft:#FEF2EC;
  --bad:#DC2626; --bad-soft:#FDECEC; --amber:#B45309; --amber-soft:#FFF8E8;
  --r:16px; --r-sm:12px;
  --shadow:0 10px 24px -14px rgba(20,49,89,.22);
  --shadow-sm:0 4px 14px -8px rgba(20,49,89,.18);
}
*{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
html,body{margin:0;padding:0;}
body{background:var(--bg); color:var(--text); font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif; font-size:15px; line-height:1.6;}
button{font-family:inherit;}
::selection{background:rgba(20,49,89,.18);}
.mono{font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:embed;}
.hidden{display:none !important;}
.dim{opacity:.55;}

/* ===== الهيدر ===== */
.nk-top{position:sticky; top:0; z-index:40; background:rgba(255,255,255,.92); backdrop-filter:blur(10px); border-bottom:1px solid var(--border);}
.nk-top-in{max-width:1080px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:12px;}
.nk-logo{width:44px;height:44px;border-radius:12px;background:#fff;border:1px solid var(--border);box-shadow:var(--shadow-sm);object-fit:contain;padding:4px;}
.nk-top-txt{min-width:0;flex:1;}
.nk-top-txt b{display:block;font-size:15px;font-weight:800;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nk-top-txt span{display:block;font-size:11px;font-weight:700;color:var(--gold-deep);letter-spacing:.4px;}
.nk-emg-badge{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;font-size:11px;font-weight:800;padding:6px 12px;border-radius:999px;box-shadow:inset 0 -2px 0 rgba(213,161,52,.55);white-space:nowrap;}
.nk-dot{width:7px;height:7px;border-radius:50%;background:var(--gold);animation:nkpulse 1.8s infinite;}
@keyframes nkpulse{0%,100%{opacity:.5}50%{opacity:1}}
.nk-days{font-size:11px;font-weight:800;color:var(--muted);text-align:center;line-height:1.3;white-space:nowrap;}
.nk-days b{display:block;color:var(--navy);font-size:15px;}

/* ===== شريط التحذير ===== */
.nk-warn{background:linear-gradient(90deg,#FFF8E8,#FBF3E0);border-block:1px solid #EEDFB8;color:var(--amber);}
.nk-warn-in{max-width:1080px;margin:0 auto;padding:8px 16px;display:flex;gap:8px;align-items:flex-start;font-size:12px;font-weight:700;}
.nk-warn svg{width:15px;height:15px;flex-shrink:0;margin-top:3px;color:var(--gold-deep);}

/* ===== التنقل ===== */
.nk-tabs{position:sticky;top:57px;z-index:30;background:rgba(245,247,250,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);}
.nk-tabs-in{max-width:1080px;margin:0 auto;display:flex;gap:4px;padding:8px 12px;overflow-x:auto;}
.nk-tab{flex:1;min-width:86px;border:1px solid transparent;background:transparent;border-radius:var(--r-sm);padding:8px 10px 6px;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:12px;font-weight:800;color:var(--muted);cursor:pointer;position:relative;transition:all .15s;}
.nk-tab svg{width:20px;height:20px;}
.nk-tab:hover{background:#fff;color:var(--navy);}
.nk-tab.on{background:#fff;border-color:var(--border);color:var(--navy);box-shadow:var(--shadow-sm);}
.nk-tab.on::after{content:"";position:absolute;bottom:-1px;inset-inline:14px;height:3px;border-radius:3px 3px 0 0;background:linear-gradient(90deg,var(--gold),var(--navy));}
.nk-tab[disabled]{opacity:.4;pointer-events:none;}

/* ===== الحاوية ===== */
.nk-main{max-width:1080px;margin:0 auto;padding:16px 16px 96px;}
.nk-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow-sm);padding:16px;}
.nk-card.brand{position:relative;overflow:hidden;}
.nk-card.brand::before{content:"";position:absolute;inset-inline:0;top:0;height:4px;background:linear-gradient(90deg,var(--gold),var(--navy) 60%);}
.nk-sec-title{font-size:16px;font-weight:800;color:var(--navy);margin:0 0 4px;}
.nk-sec-sub{font-size:12px;color:var(--muted);font-weight:700;margin:0 0 12px;}
.nk-gate{width:64px;height:5px;border-radius:4px;background:linear-gradient(90deg,var(--gold) 0 38%,var(--navy) 38% 100%);margin:6px 0 14px;}

/* ===== شبكة الإحصائيات ===== */
.nk-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;}
.nk-stat{background:linear-gradient(135deg,var(--navy),var(--navy-2));border-radius:var(--r);color:#fff;padding:14px;position:relative;overflow:hidden;box-shadow:var(--shadow);min-height:84px;}
.nk-stat::after{content:"";position:absolute;inset-block:0;inset-inline-start:0;width:4px;background:var(--gold);}
.nk-stat .v{font-size:22px;font-weight:800;line-height:1.2;}
.nk-stat .l{font-size:11px;font-weight:700;color:rgba(255,255,255,.75);margin-top:2px;}
.nk-stat.ghost{background:#fff;color:var(--navy);border:1px solid var(--border);box-shadow:none;}
.nk-stat.ghost::after{background:var(--navy-soft);}
.nk-stat.ghost .l{color:var(--muted);}

/* ===== الأزرار ===== */
.nk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--border);background:#fff;color:var(--navy);font-weight:800;font-size:14px;border-radius:var(--r-sm);padding:10px 16px;cursor:pointer;transition:all .15s;min-height:44px;}
.nk-btn:hover{box-shadow:var(--shadow-sm);border-color:color-mix(in srgb,var(--navy) 30%,#fff);}
.nk-btn:active{transform:scale(.985);}
.nk-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.nk-btn svg{width:18px;height:18px;}
.nk-btn.primary{background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;border-color:transparent;box-shadow:inset 0 -3px 0 rgba(213,161,52,.45),var(--shadow);border:1px solid transparent;}
.nk-btn.primary:hover{filter:brightness(1.07);}
.nk-btn.gold{background:linear-gradient(135deg,var(--gold),#C08F27);color:#fff;border-color:transparent;box-shadow:inset 0 -3px 0 rgba(20,49,89,.4),var(--shadow);}
.nk-btn.ghost-ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,#fff);background:var(--ok-soft);}
.nk-btn.danger{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,#fff);background:var(--bad-soft);}
.nk-btn.sm{min-height:36px;padding:6px 12px;font-size:12px;border-radius:10px;}
.nk-btn.sm svg{width:15px;height:15px;}
.nk-btn.wide{width:100%;}

/* ===== البحث ===== */
.nk-search{display:flex;gap:8px;align-items:center;}
.nk-input{width:100%;border:1.5px solid var(--border);border-radius:var(--r-sm);padding:12px 14px;font-family:inherit;font-size:16px;font-weight:700;color:var(--text);background:#fff;min-height:48px;outline:none;transition:border .15s, box-shadow .15s;}
.nk-input:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(20,49,89,.12);}
.nk-input::placeholder{color:#9CA8B5;font-weight:600;}
textarea.nk-input{min-height:70px;resize:vertical;}
.nk-chip{display:inline-flex;align-items:center;gap:4px;background:var(--navy-soft);color:var(--navy);border:1px solid color-mix(in srgb,var(--navy) 18%,#fff);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:800;cursor:pointer;}
.nk-chip:hover{background:#fff;box-shadow:var(--shadow-sm);}
.nk-chip.gold{background:var(--gold-soft);color:var(--gold-deep);border-color:#EBD9AC;}
.nk-hint{font-size:11.5px;color:var(--muted);font-weight:700;}

/* ===== نتايج البحث ===== */
.nk-results{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
.nk-res{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;cursor:pointer;transition:all .12s;text-align:start;width:100%;}
.nk-res:hover{border-color:var(--navy);box-shadow:var(--shadow-sm);transform:translateY(-1px);}
.nk-res .av{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;display:grid;place-items:center;font-weight:800;font-size:15px;flex-shrink:0;}
.nk-res .nm{flex:1;min-width:0;}
.nk-res .nm b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nk-res .nm span{font-size:11px;color:var(--muted);font-weight:700;}
.nk-bal{font-weight:800;font-size:14px;white-space:nowrap;}
.nk-bal.pos{color:var(--ok);} .nk-bal.neg{color:var(--warn);} .nk-bal.zero{color:var(--muted);}

/* ===== المودال ===== */
.nk-modal-bg{position:fixed;inset:0;background:rgba(20,32,53,.45);backdrop-filter:blur(3px);z-index:60;display:flex;align-items:flex-end;justify-content:center;animation:nkfade .18s ease;}
@keyframes nkfade{from{opacity:0}to{opacity:1}}
.nk-modal{background:#fff;width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;box-shadow:0 -12px 48px rgba(20,49,89,.35);animation:nkslide .22s cubic-bezier(.2,.8,.2,1);padding:0;}
@keyframes nkslide{from{transform:translateY(36px);opacity:.4}to{transform:none;opacity:1}}
@media(min-width:640px){
  .nk-modal-bg{align-items:center;padding:24px;}
  .nk-modal{border-radius:22px;max-height:86vh;}
}
.nk-modal-head{position:sticky;top:0;background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;padding:14px 16px;display:flex;gap:10px;align-items:center;z-index:5;}
.nk-modal-head .tt{flex:1;min-width:0;}
.nk-modal-head .tt b{display:block;font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nk-modal-head .tt span{font-size:12px;color:rgba(255,255,255,.75);font-weight:700;}
.nk-modal-head .x{background:rgba(255,255,255,.14);border:none;color:#fff;width:36px;height:36px;border-radius:10px;cursor:pointer;display:grid;place-items:center;flex-shrink:0;}
.nk-modal-body{padding:16px;}

/* ===== صفوف المعلومات ===== */
.nk-kv{display:flex;justify-content:space-between;gap:10px;padding:9px 2px;border-bottom:1px dashed var(--border);font-size:13px;}
.nk-kv:last-child{border-bottom:none;}
.nk-kv .k{color:var(--muted);font-weight:700;}
.nk-kv .v{font-weight:800;text-align:end;}

/* ===== البادجات ===== */
.nk-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;padding:4px 10px;border-radius:999px;}
.nk-badge.g{background:var(--ok-soft);color:var(--ok);} .nk-badge.o{background:var(--warn-soft);color:var(--warn);}
.nk-badge.n{background:var(--navy-soft);color:var(--navy);} .nk-badge.r{background:var(--bad-soft);color:var(--bad);}
.nk-badge.a{background:var(--amber-soft);color:var(--amber);} .nk-badge.m{background:#EEF2F6;color:var(--muted);}
.nk-badge.gold{background:var(--gold-soft);color:var(--gold-deep);}

/* ===== الجداول ===== */
.nk-table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--r-sm);background:#fff;}
table.nk-tb{width:100%;border-collapse:collapse;min-width:560px;font-size:13px;}
.nk-tb thead th{background:var(--navy-soft);color:var(--navy);font-weight:800;padding:9px 10px;text-align:start;font-size:12px;border-bottom:1px solid var(--border);white-space:nowrap;}
.nk-tb tbody td{padding:9px 10px;border-bottom:1px solid var(--border);font-weight:700;}
.nk-tb tbody tr:last-child td{border-bottom:none;}
.nk-tb tbody tr:hover{background:#FAFBFD;}
.nk-tb .num{direction:ltr;text-align:end;font-variant-numeric:tabular-nums;}

/* ===== شريط الأيام ===== */
.nk-days-strip{display:flex;gap:6px;overflow-x:auto;padding:4px 0 8px;}
.nk-day{min-width:74px;background:#fff;border:1.5px solid var(--border);border-radius:var(--r-sm);padding:8px 6px;text-align:center;cursor:pointer;flex-shrink:0;transition:all .12s;}
.nk-day b{display:block;font-size:13px;font-weight:800;color:var(--text);}
.nk-day span{font-size:10.5px;color:var(--muted);font-weight:700;}
.nk-day.on{border-color:var(--navy);background:var(--navy);color:#fff;box-shadow:var(--shadow-sm);}
.nk-day.on b,.nk-day.on span{color:#fff;}
.nk-day.today{border-color:var(--gold);}

/* ===== الحصص ===== */
.nk-ses{background:#fff;border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;display:flex;align-items:center;gap:10px;}
.nk-ses .tm{background:var(--navy-soft);color:var(--navy);border-radius:10px;padding:8px 6px;text-align:center;min-width:64px;font-weight:800;font-size:13px;line-height:1.3;}
.nk-ses .tm small{display:block;font-size:10px;font-weight:700;opacity:.7;}
.nk-ses .info{flex:1;min-width:0;}
.nk-ses .info b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nk-ses .info span{font-size:11.5px;color:var(--muted);font-weight:700;}
.nk-ses.live{border-color:color-mix(in srgb,var(--ok) 45%,#fff);background:linear-gradient(90deg,var(--ok-soft),#fff 60%);}

/* ===== العمليات (سجل) ===== */
.nk-txn{display:flex;gap:10px;background:#fff;border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 12px;align-items:flex-start;}
.nk-txn .ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;font-size:15px;}
.nk-txn .bd{flex:1;min-width:0;}
.nk-txn .bd b{font-size:13px;}
.nk-txn .bd .sub{font-size:11px;color:var(--muted);font-weight:700;word-wrap:break-word;}

/* ===== شاشات الحالة ===== */
.nk-boot{min-height:100vh;display:grid;place-items:center;background:var(--bg);padding:24px;}
.nk-boot-card{background:#fff;border:1px solid var(--border);border-radius:20px;box-shadow:var(--shadow);padding:32px;text-align:center;max-width:420px;width:100%;}
.nk-boot-logo{width:76px;height:76px;margin:0 auto 12px;border-radius:20px;background:#fff;border:1px solid var(--border);padding:8px;object-fit:contain;}
.nk-spin{width:34px;height:34px;margin:14px auto;border:3.5px solid var(--navy-soft);border-top-color:var(--navy);border-radius:50%;animation:nkrot .8s linear infinite;}
@keyframes nkrot{to{transform:rotate(360deg)}}
.nk-status-hero{border-radius:20px;padding:20px;text-align:center;}
.nk-status-hero.bad{background:var(--bad-soft);border:1.5px solid #F3C1C1;}
.nk-status-hero.warn{background:var(--amber-soft);border:1.5px solid #EBD9AC;}
.nk-status-hero.ok{background:var(--ok-soft);border:1.5px solid #C8E9D4;}

/* ===== التصدير ===== */
.nk-export-card{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--border);border-radius:var(--r);padding:16px;background:#fff;}
.nk-export-card .ic{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;flex-shrink:0;}
.nk-flow{display:flex;flex-direction:column;gap:0;align-items:center;margin:14px 0;}
.nk-flow .step{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:8px 18px;font-size:13px;font-weight:800;box-shadow:var(--shadow-sm);z-index:1;}
.nk-flow .step .n{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;display:grid;place-items:center;font-size:12px;box-shadow:inset 0 -2px 0 rgba(213,161,52,.5);}
.nk-flow .arrow{width:2.5px;height:22px;background:linear-gradient(var(--gold),var(--navy));border-radius:2px;}

/* ===== تاب سفلي للموبايل ===== */
@media(max-width:719px){
  .nk-tabs{display:none;}
  .nk-bnav{display:flex !important;}
  .nk-main{padding-bottom:110px;}
}
.nk-bnav{display:none;position:fixed;bottom:0;inset-inline:0;z-index:50;background:rgba(255,255,255,.96);backdrop-filter:blur(10px);border-top:1px solid var(--border);padding:6px 8px calc(6px + env(safe-area-inset-bottom));}
.nk-bnav-in{max-width:560px;margin:0 auto;display:flex;}
.nk-bnav .nk-tab{flex:1;min-width:0;padding:7px 4px 5px;font-size:10.5px;}

/* ===== متنوع ===== */
.nk-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.nk-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;}
.nk-subttl{font-size:13px;font-weight:800;color:var(--navy);margin:14px 0 8px;display:flex;align-items:center;gap:6px;}
.nk-subttl::after{content:"";flex:1;height:1px;background:var(--border);}
.nk-empty{text-align:center;padding:26px 14px;color:var(--muted);font-weight:700;font-size:13px;}
.nk-empty .big{font-size:34px;margin-bottom:6px;}
.nk-toast{position:fixed;bottom:76px;inset-inline:0;display:flex;justify-content:center;z-index:90;pointer-events:none;}
.nk-toast-in{background:var(--navy);color:#fff;font-weight:800;font-size:13px;padding:10px 18px;border-radius:999px;box-shadow:var(--shadow);animation:nktoast .25s ease;max-width:90vw;text-align:center;}
@keyframes nktoast{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.nk-toast-in.err{background:var(--bad);} .nk-toast-in.ok{background:var(--ok);}
.nk-scan{position:fixed;inset:0;background:#0B1526;z-index:80;display:flex;flex-direction:column;}
.nk-scan video{flex:1;object-fit:cover;width:100%;}
.nk-scan-bar{position:absolute;inset-inline:15%;top:34%;height:3px;background:var(--gold);border-radius:3px;box-shadow:0 0 18px rgba(213,161,52,.9);animation:nkscan 2.2s ease-in-out infinite;}
@keyframes nkscan{0%,100%{top:30%}50%{top:62%}}
.nk-scan-ui{padding:14px;display:flex;gap:10px;background:rgba(11,21,38,.85);backdrop-filter:blur(6px);color:#fff;align-items:center;}
.nk-scan-title{flex:1;font-weight:800;font-size:14px;}
.nk-locked{background:var(--amber-soft);border:1.5px solid #EBD9AC;color:var(--amber);border-radius:var(--r-sm);padding:10px 14px;font-size:12.5px;font-weight:800;display:flex;gap:8px;align-items:center;margin-bottom:12px;}
.nk-ro-banner{background:linear-gradient(135deg,#7A1E1E,#9B2C2C);color:#fff;border-radius:var(--r);padding:16px;display:flex;gap:10px;align-items:flex-start;font-weight:700;font-size:13px;box-shadow:var(--shadow);margin-bottom:14px;}
.nk-ro-banner svg{flex-shrink:0;margin-top:2px;}
@media print{ .nk-top,.nk-tabs,.nk-bnav,.nk-warn{display:none;} }
@media (prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important;}}
`;
