# ZUMY BOT · v12 pronta para publicar

A cópia de `grupos.js` foi recuperada do histórico do seu repositório e recebeu as mudanças de controle, agenda e convite. Os arquivos deste ZIP já são o resultado da atualização. Basta extrair e enviar os arquivos à raiz do repositório. Preserve os áudios e os demais arquivos do projeto que já estão no GitHub.

1. Extraia o ZIP.
2. Abra https://github.com/df019459-ship-it/Zumybot3.1.0/upload/main e envie todos os arquivos extraídos. Os nomes devem permanecer exatamente como estão no ZIP. Toque em **Commit changes**.
3. No Render, abra o serviço `zumybot3-1-0` e escolha **Manual Deploy → Deploy latest commit**.
4. Confira https://zumybot3-1-0.onrender.com/health. A revisão esperada é `agenda-v12`. Quando o status estiver `conectado`, teste `!ping`, `!linkgp` e `!programar`.

## Comandos incluídos

- `!linkgp` mostra o convite atual, a descrição e a foto quando disponível.
- `!programar fechamento 23:00` e `!programar abertura 07:00` definem horários diários.
- `!mensagem fechamento Boa noite!` e `!mensagem abertura Bom dia!` definem os avisos.
- `!antifanta 0` pausa os lembretes de inatividade. `!antifanta 1` volta a permiti-los.
- `!reações 1` ativa reações aos comandos. Responda a uma mensagem com `!reações 👍` para reagir a ela.
- `!ativar bot` e `!reiniciar bot confirmar` exigem a conta do dono cadastrada.
- `!zumy bomdia` envia uma saudação com data e hora.
- `!limpar tudo confirmar` solicita exclusão das mensagens recentes registradas pelo bot.

O Dockerfile verifica a sintaxe dos arquivos JavaScript antes de iniciar. O pacote preserva o painel e a configuração de sessão existentes.
