# Treino

App web de musculação baseado em evidência: programas de 5 dias (masculino e
feminino), biblioteca de exercícios com imagens e descrição, registro de
séries com sugestão automática de carga (dupla progressão), timer de
descanso, gráficos de evolução (1RM estimado, séries por músculo na semana,
frequência), peso e medidas corporais, calculadora de calorias/proteína e um
guia com as regras e as referências.

Vários perfis (cada pessoa com seu programa e histórico).

## Rodar

Só precisa de Python 3 (nenhuma dependência):

```bash
python server.py            # http://localhost:8790
```

Variáveis: `TREINO_PORTA` (8790), `TREINO_DB` (dados/treino.db),
`TREINO_PEER` (URL do outro servidor para sincronizar), `TREINO_SYNC_S` (60).

## Duas máquinas (Ryzen principal, Arch reserva)

Os dois servidores ficam ligados e trocam registros a cada minuto
("última escrita vence" por registro). Use o endereço do Ryzen; se ele estiver
desligado, use o do Arch. Quando o Ryzen voltar, tudo se junta sozinho.

| Máquina | Endereço (Tailscale) | Instalação |
|---|---|---|
| Ryzen (Windows) | http://100.98.151.43:8790 | `deploy\instalar-windows.ps1` (como admin) |
| Arch | http://100.109.141.7:8790 | `cp deploy/treino.service ~/.config/systemd/user/ && systemctl --user enable --now treino` |

O app também guarda uma cópia no navegador: registrar séries sem conexão
funciona, e o que ficou pendente é enviado quando o servidor responder.

No celular: abra o endereço e use "Adicionar à tela inicial".

## Créditos

Imagens dos exercícios: [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
(Unlicense, domínio público). Gráficos: Chart.js (MIT).
