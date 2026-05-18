# Hybrid agent runtime — host default, container opt-in per Space

The app is distributed across team members' laptops; some have sensitive credentials and secrets reachable from the host filesystem (SSH keys, AWS creds, other repos), and some are clean dev VMs where that isn't a concern. We picked Sandcastle as the agent orchestrator specifically because its provider model lets us run host-mode and container-mode behind the same API.

Each **Space** carries `agent_runtime_mode = 'host' | 'container'` (default `host`):

- **host** uses Sandcastle's `noSandboxProvider`. The agent is a subprocess of the server with full host permissions. Fast setup. Used by default.
- **container** uses Sandcastle's bind-mount provider. The agent runs in a Docker container built from a per-Space Dockerfile stored in `spaces.dockerfile_content` (generated on Space-create by detecting the repo's existing Dockerfile and appending the Sandcastle agent layer; never committed to the user's repo).

The hybrid was chosen over either extreme because:

- **Host-only** is fast but trades isolation everywhere — including the production-facing Spaces on laptops with sensitive creds. A prompt-injected Jira comment can read `~/.ssh/`.
- **Container-only** is safe but trades speed everywhere — including throwaway dev Spaces where the per-Space Dockerfile editor is friction without benefit.
- **Hybrid** lets each team member match their actual risk per Space.

This is hard to reverse: dropping host-mode means every existing Space needs a Dockerfile generated retroactively; dropping container-mode means removing the editor UI, schema column, and the per-attempt Dockerfile-injection path. A future reader will likely wonder "why both?" — the answer is in this ADR.
