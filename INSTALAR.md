# Zumybot · Controle e reconexão

## Comandos

| Comando | Uso |
|---|---|
| `!ativar bot` | Somente o dono. Tira o bot do estado de pausa enquanto houver conexão com o WhatsApp. Os comandos continuam sujeitos às permissões do grupo e às integrações configuradas. |
| `!reiniciar bot` | Somente o dono. Mostra a instrução de confirmação. Use `!reiniciar bot confirmar` para reiniciar. A forma anterior `!reiniciar confirmar` também funciona. |
| `!zumy` | Envia saudação com data e hora. Use `!zumy bomdia` para pedir especificamente “Bom dia”. Usa `BOT_TIMEZONE`, com padrão Fortaleza. |
| `!limpar` | Responda à mensagem que deseja apagar. |
| `!limpar tudo confirmar` | Solicita a exclusão das mensagens recentes recebidas naquele grupo que o bot registrou desde que iniciou. Exige administrador e bot como administrador. |

A limpeza em lote mantém apenas identificadores em memória, sem guardar o texto. O limite é de até 100 mensagens por grupo nas últimas 24 horas, e a sessão inicia sem histórico de limpeza. O WhatsApp aplica suas regras de exclusão. A limpeza do histórico inteiro para todos não está disponível pelo bot.

## Dono e sessão

Se o bot já tem o painel v9 ou posterior, confira a seção **Dono do bot** em `/parear`. Salve o número da conta responsável com DDI e DDD. Se preciso, a mesma conta usa `!meuid` e preenche o LID recebido em privado. Nas versões que ainda usam variáveis de ambiente, configure `OWNER_NUMBER` e, quando necessário, `OWNER_LID` no Render.

Se a conexão ficar travada em `conectando` por 75 segundos, o bot encerra a tentativa e abre outra com as credenciais existentes. Para preservar essas credenciais entre reinícios e deploys, `SESSION_DIR` precisa ficar no disco persistente do Render. Mantenha apenas uma instância usando a sessão. Se o WhatsApp revogar o vínculo, será necessário parear novamente.

## Instalar na versão atual

Use a cópia mais recente do Zumybot. A agenda foi preparada para a estrutura da v10, que já tem rankings com imagem e a rotina de inatividade.

1. Execute primeiro `node /caminho/aplicar-controle.mjs /caminho/Zumybot3.1.0 --check` e depois sem `--check`. Se você já instalou o controle, pule esse script.
2. Execute `node /caminho/aplicar-agenda.mjs /caminho/Zumybot3.1.0 --check` e depois sem `--check`.
3. Envie ao GitHub apenas `grupos.js`, `menu.js`, `server.js`, `config-grupo.js` e `integracoes.js`. Publique o último commit no Render.
4. Confira `"revisao":"agenda-v12"` em `/health`.

### Agenda, antifanta e reações

| Comando | O que faz |
|---|---|
| `!programar` | Mostra os horários do grupo. |
| `!programar fechamento 23:00` | Fecha o grupo todos os dias às 23h. |
| `!programar abertura 07:00` | Abre o grupo todos os dias às 7h. |
| `!mensagem fechamento Boa noite, grupo!` | Salva o aviso de fechamento. |
| `!mensagem abertura Bom dia, galera!` | Salva o aviso de abertura. |
| `!programar fechamento 23:00` seguido de ` \| Boa noite!` | Salva o horário e o aviso na mesma mensagem. |
| `!programar abertura off` | Cancela o horário de abertura. Para fechar, use `!programar fechamento off`. |
| `!antifanta 1` / `!antifanta 0` | Permite ou pausa os lembretes de inatividade. `!sync` ativa o registro de atividade. `!atifanta 0` também é aceito. |
| `!reações 1` / `!reações 0` | Liga ou desliga a reação 👀 aos comandos do menu. |
| `!reações 👍` | Responda à mensagem de outro participante para o bot reagir a ela. |

Os horários usam `BOT_TIMEZONE` (Fortaleza por padrão). O bot precisa estar conectado e ser administrador no horário programado. Os cartões dos rankings usam o título e as porcentagens da categoria, com cores e elementos gráficos gerados para cada comando.
