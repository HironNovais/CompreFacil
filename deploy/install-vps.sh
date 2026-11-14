#!/usr/bin/env bash
set -euo pipefail

# Executar como root apenas para instalar esta aplicação acadêmica.
# Não altera proxy, redes, arquivos ou serviços da Sala Privada.
app_root=/opt/compre-facil-distribuido
release_dir=$(realpath "${1:?Informe o diretório de release já extraído}")
case "$release_dir" in
  "$app_root"/releases/*) ;;
  *) echo 'Diretório fora da área reservada ao CompreFácil' >&2; exit 1 ;;
esac
test -f "$release_dir/deploy/vps-compose.yml"
mkdir -p "$app_root/shared"
env_file="$app_root/shared/runtime.env"
if [ ! -s "$env_file" ]; then
  umask 077
  {
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)"
    printf 'RABBITMQ_PASSWORD=%s\n' "$(openssl rand -hex 24)"
    printf 'WEB_BIND=127.0.0.1\nWEB_PORT=8088\n'
  } > "$env_file"
fi
chmod 600 "$env_file"
compose=(docker compose --project-name compre-facil-demo --env-file "$env_file" -f "$release_dir/deploy/vps-compose.yml")
"${compose[@]}" config --quiet
COMPOSE_PARALLEL_LIMIT=1 "${compose[@]}" up --build -d --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:8088/api/payment/health
curl --fail --silent --show-error http://127.0.0.1:8088/api/notification/health
ln -s "$release_dir" "$app_root/current.new"
mv -Tf "$app_root/current.new" "$app_root/current"
"${compose[@]}" ps
