#!/usr/bin/env bash
set -euo pipefail

# Exceção somente para a porta ORIGINAL 8088 publicada pelo CompreFácil.
# Após DNAT ela vira 80; não liberar genericamente a porta de destino 80.
rule=(-p tcp -m conntrack --ctdir ORIGINAL --ctorigdstport 8088 -m comment --comment compre-facil-demo-8088 -j RETURN)
case "${1:-start}" in
  start)
    iptables -w -S DOCKER-USER >/dev/null
    iptables -w -C DOCKER-USER "${rule[@]}" 2>/dev/null || iptables -w -I DOCKER-USER 1 "${rule[@]}"
    ;;
  stop)
    if iptables -w -C DOCKER-USER "${rule[@]}" 2>/dev/null; then
      iptables -w -D DOCKER-USER "${rule[@]}"
    fi
    ;;
  *) echo 'Use start ou stop' >&2; exit 2 ;;
esac
