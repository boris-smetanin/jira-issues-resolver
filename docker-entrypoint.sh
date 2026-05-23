#!/bin/sh
set -e

# Claude Code's CLI refuses --dangerously-skip-permissions when invoked as
# root (security guard). Sandcastle requires that flag for non-interactive
# runs, so the server must drop to a non-root user before exec'ing.
#
# The node base image ships with a `node` user (uid 1000). We chown the
# writable mount points to node and drop privileges via gosu. Paths that
# don't exist in a given env (e.g. anon volumes not mounted in prod) are
# skipped silently.

if [ "$(id -u)" = "0" ]; then
  # Slice 11: container-mode orchestrator shells out `docker` against
  # the host daemon via the bind-mounted socket. The socket is owned
  # by root:root (srw-rw----) but we drop to `node` below, which has
  # no access. Open it up to the group while we're still root.
  # Best effort: socket may be absent in host-only setups, or
  # un-chmod-able on some Docker Desktop versions.
  if [ -S /var/run/docker.sock ]; then
    chmod 666 /var/run/docker.sock 2>/dev/null || true
  fi

  # /home/agent is hardcoded by Sandcastle's SessionPaths as the sandbox
  # Claude projects dir. For our localProcess provider (host == sandbox)
  # we make the agent subprocess use HOME=/home/agent so its session
  # files land where Sandcastle's copyFileOut step expects them.
  mkdir -p /home/node/.config /home/node/.cache /home/agent /tmp/jir-agent

  for d in /data /home/node /home/agent /tmp/jir-agent \
           /app/node_modules /app/server/node_modules \
           /app/web/node_modules /app/shared/node_modules; do
    if [ -e "$d" ]; then
      chown -R node:node "$d" 2>/dev/null || true
    fi
  done

  # gosu doesn't switch HOME; export it so node sees the right home dir
  # for ~/.npm, etc. (The agent subprocess gets HOME=/home/agent set
  # separately by the localProcess provider.)
  export HOME=/home/node
  exec gosu node "$@"
fi

exec "$@"
