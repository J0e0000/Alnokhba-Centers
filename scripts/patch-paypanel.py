#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Add payExact to PaymentPanel + fix onClick={pay} → onClick={() => pay()}"""

PATH = "/home/z/my-project/src/components/nokhba/scan.tsx"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

# 1) add payExact right after the pay() function's closing (the block ends with
#    `    } catch { /* toast */ } finally { setBusy(false); }\n  }\n\n  return (\n    <div className={cn("rounded-2xl bg-white/85 border border-border p-4 space-y-3"`)
anchor = '''    } catch { /* toast */ } finally { setBusy(false); }
  }

  return (
    <div className={cn("rounded-2xl bg-white/85 border border-border p-4 space-y-3", compact ? "" : "shadow-sm")}>'''

replacement = '''    } catch { /* toast */ } finally { setBusy(false); }
  }

  // رجّع الباقي: نسجل بس المطلوب بالظبط — الفرق بيترد كاش للطالب
  function payExact() {
    return pay(suggestedDue / 100);
  }

  return (
    <div className={cn("rounded-2xl bg-white/85 border border-border p-4 space-y-3", compact ? "" : "shadow-sm")}>'''

assert content.count(anchor) == 1, f"anchor count = {content.count(anchor)}"
content = content.replace(anchor, replacement)

# 2) fix onClick={pay} (passes MouseEvent as exactEGP!) — only in PaymentPanel region (both are)
content = content.replace("onClick={pay}\n", "onClick={() => pay()}\n")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

import re
n = len(re.findall(r"onClick=\{\(\) => pay\(\)\}", content))
print(f"OK — payExact added, onClick fixed ({n} occurrences)")
