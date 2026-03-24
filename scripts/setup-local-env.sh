#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="${ROOT_DIR}/.keys"
PRIVATE_KEY_FILE="${KEY_DIR}/main_sub_signing_private.pem"
PUBLIC_KEY_OPENSSH_FILE="${KEY_DIR}/main_sub_signing_public.openssh"
PUBLIC_KEY_PEM_FILE="${KEY_DIR}/main_sub_signing_public.pem"
ENV_FILE="${ROOT_DIR}/.env.local"

mkdir -p "${KEY_DIR}"

if [[ ! -f "${PRIVATE_KEY_FILE}" ]]; then
  ssh-keygen -t rsa -b 4096 -m PEM -f "${PRIVATE_KEY_FILE}" -N "" -C "main-sub-key-signing" >/dev/null
  mv "${PRIVATE_KEY_FILE}.pub" "${PUBLIC_KEY_OPENSSH_FILE}"
  ssh-keygen -e -m PKCS8 -f "${PUBLIC_KEY_OPENSSH_FILE}" > "${PUBLIC_KEY_PEM_FILE}"
fi

KEY_SIGNING_SECRET="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"

PRIVATE_ESCAPED="$(awk '{printf "%s\\n", $0}' "${PRIVATE_KEY_FILE}" | sed 's/\\n$//')"
PUBLIC_ESCAPED="$(awk '{printf "%s\\n", $0}' "${PUBLIC_KEY_PEM_FILE}" | sed 's/\\n$//')"

cat > "${ENV_FILE}" <<EOF
TURSO_DATABASE_URL=""
TURSO_AUTH_TOKEN=""
KEY_SIGNING_SECRET="${KEY_SIGNING_SECRET}"
KEY_PRIVATE_KEY_PEM="${PRIVATE_ESCAPED}"
KEY_PUBLIC_KEY_PEM="${PUBLIC_ESCAPED}"
EOF

echo ".env.local created at ${ENV_FILE}"
echo "Fill TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, then run: npm run dev"
