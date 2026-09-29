#!/usr/bin/env python3
"""Fully detached server launcher (double-fork daemon).

The Bash tool kills its process group when the call ends, which kills
`npm run dev` / plain `node`. Double-fork + setsid detaches the server into
its own session reparented to init, so it survives.

Usage:
  python3 scripts/dev_daemon.py        # next dev  (development, port 3000)
  python3 scripts/dev_daemon.py prod   # node .next/standalone/server.js (production)
"""
import os
import sys

ROOT = "/home/z/my-project"


def fork_off() -> None:
    pid = os.fork()
    if pid > 0:
        sys.exit(0)  # parent exits immediately

    os.setsid()  # new session, escape the tool's process group

    pid2 = os.fork()
    if pid2 > 0:
        os._exit(0)  # intermediate parent exits; child reparented to init

    # --- grandchild: the actual daemon ---
    os.chdir(ROOT)
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    os.close(devnull)
    if len(sys.argv) > 1 and sys.argv[1] == "prod":
        os.environ["NODE_ENV"] = "production"
        os.execvp("node", ["node", ".next/standalone/server.js"])
    os.execvp("npm", ["npm", "run", "dev"])


if __name__ == "__main__":
    fork_off()
