#!/bin/sh
set -eu

client="${1:-${AGENTROOM_CLIENT:-all}}"
project_name="${2:-${AGENTROOM_NAME:-$(basename "$PWD")}}"
package_spec="${AGENTROOM_PACKAGE:-github:VentureIA/Agent-Room#main}"
mcp_package_spec="${AGENTROOM_MCP_PACKAGE:-github:VentureIA/Agent-Room#main}"

case "$client" in
  all|claude|codex) ;;
  *)
    echo "AgentRoom install error: client must be all, claude, or codex." >&2
    echo "Example: curl -fsSL https://agent-room.venture-ia.com/install.sh | sh -s -- claude MyProject" >&2
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "AgentRoom install error: Node.js >=20.11 is required." >&2
  echo "Install Node.js first, then run this command again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "AgentRoom install error: npm is required." >&2
  echo "Install npm first, then run this command again." >&2
  exit 1
fi

echo "Installing AgentRoom for $project_name ($client)..."
npx -y "$package_spec" init "$client" --name "$project_name" --package "$mcp_package_spec"
echo "AgentRoom install complete."
