# Repositório no GitHub e entrega no AVA

Repositório escolhido pelo autor: **https://github.com/HironNovais/CompreFacil**.

Demonstração no navegador: **http://187.127.6.251:8088**.

## Obter e executar o código

```bash
git clone https://github.com/HironNovais/CompreFacil.git
cd CompreFacil
docker compose up --build -d
```

Aguarde os cinco contêineres ficarem saudáveis e abra `http://localhost:8088`. O README contém os comandos das APIs e dos testes. O repositório contém o projeto completo, documentação, arquivos Compose e evidências; credenciais reais, bancos locais, dependências instaladas e arquivos temporários ficam excluídos.

## Validação no GitHub

A workflow `.github/workflows/ci.yml` executa em pushes e pull requests: instala dependências, valida sintaxe, executa testes e inicia os contêineres em um runner Linux. Também testa o fluxo e a interface em Chromium. Consulte o resultado efetivo na [aba Actions](https://github.com/HironNovais/CompreFacil/actions); a existência da configuração não comprova aprovação de uma execução.

O push do código não atualiza automaticamente a instalação na VPS. A demonstração usa a release verificada descrita em [vps.md](vps.md).

## Entrega ao professor

O PDF do Desafio 2 pede entregar **o link do repositório remoto com código e instruções** na ferramenta indicada pelo professor-tutor no AVA. Use:

```text
Código e instruções: https://github.com/HironNovais/CompreFacil
Demonstração no navegador: http://187.127.6.251:8088
```

O endereço da demonstração complementa o repositório. A submissão no AVA deve ser feita pelo aluno. Inclua nome, turma e matrícula conforme solicitado pelo professor.
