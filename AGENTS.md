# Treino

## O que é
App web de musculação baseado em evidência (programas de 5 dias, biblioteca de exercícios,
registro de séries com sugestão de carga, gráficos, medidas). Em uso pelo Gustavo e por outras
pessoas, cada uma com seu perfil. Criado em 03/11/2026. Python só com a stdlib + SQLite; front-end
estático em `static/`.

## Comandos
- Rodar:            `python3 server.py` (http://localhost:8790)
- Check rápido:     `python3 -m py_compile server.py && node --check static/app.js && node --check static/data.js`
                    (não há testes ainda)
- Serviço no Arch:  `systemctl --user status treino` (unidade em `deploy/treino.service`)
- Deploy no Ryzen:  `deploy\instalar-windows.ps1` como admin (instalado em `%USERPROFILE%\treino-app`,
                    tarefa "Treino" como SYSTEM na inicialização, firewall 8790)

## Mapa
- `server.py`        servidor HTTP: estáticos + `/api/registros` (GET `?desde=`, POST), `/api/info`;
                     sincroniza com o par a cada `TREINO_SYNC_S` s ("última escrita vence" por registro)
- `static/`          `app.js` (interface), `data.js` (programas e exercícios), `img/` (free-exercise-db),
                     `vendor/chart.umd.min.js` (Chart.js)
- `deploy/`          unidade systemd --user do Arch e instalador do Windows
- `dados/treino.db`  banco local, fora do git

## Regras deste projeto
- O repo é PÚBLICO: `dados/` e `*.db` nunca entram (já no `.gitignore`); são dados das pessoas que usam.
- Duas máquinas ligadas ao mesmo tempo, Ryzen (100.98.151.43) e Arch (100.109.141.7), pelo
  Tailscale, cada uma com `TREINO_PEER` apontando para a outra.
- Variáveis: `TREINO_PORTA` (8790), `TREINO_DB`, `TREINO_PEER`, `TREINO_SYNC_S` (60), `TREINO_NO`.

## Armadilhas conhecidas
- Porta 8770 é do painel da extrusora no Arch: o treino usa 8790.

## Fontes de verdade
- Imagens: free-exercise-db (Unlicense). Gráficos: Chart.js (MIT). Referências de treino: guia dentro do app.

## Onde procurar o que já foi feito
- docs/pesquisas/            (não existe ainda)
- git log --grep=<palavra>
- Estado e bastão: `mem contexto treino-app` (ai-memory)

## Checklist ao terminar algo
- [ ] teste que falhou antes e passa depois
- [ ] check rápido verde no commit exato
- [ ] docs/pesquisas atualizado se houve decisão ou pesquisa
- [ ] duplicação ou arquivo crescendo? → propor refatoração (commit separado)
- [ ] risco de segurança notado? → apontar em uma linha
