  let iaEmAndamento = false;
  let iaLiberadaEm = 0;

  async function ai({ arg, quotedText, reply }, command) {
    const input = String(arg || quotedText || '').trim();

    if (!input) {
      return reply(
        '💬 Use ' + prefix + command +
        ' com uma pergunta ou responda a uma mensagem.'
      );
    }

    if (input.length > 6000) {
      return reply('Envie até 6.000 caracteres por vez.');
    }

    const key = env.GEMINI_API_KEY?.trim();

    if (!key) {
      return reply(
        '🔑 O dono precisa configurar GEMINI_API_KEY no Render.'
      );
    }

    const model = (
      env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash-lite'
    ).replace(/^models\//, '');

    if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
      return reply(
        'Confira GEMINI_MODEL no Render. Informe somente o nome do modelo.'
      );
    }

    if (Date.now() < iaLiberadaEm) {
      const segundos = Math.ceil(
        (iaLiberadaEm - Date.now()) / 1000
      );

      return reply(
        '⏳ Aguarde ' + segundos +
        ' segundos antes de pedir outra resposta.'
      );
    }

    if (iaEmAndamento) {
      return reply(
        '⏳ Estou respondendo outra pergunta. Tente novamente em instantes.'
      );
    }

    const prompts = {
      ia:
        'Você é a Zumy, uma assistente virtual. ' +
        'Responda em português do Brasil, de forma clara, ' +
        'acolhedora e objetiva. Diga quando não souber. ' +
        'Não afirme que executou ações no WhatsApp.',
      perguntar:
        'Responda à pergunta em português do Brasil. ' +
        'Se não souber, deixe isso claro.',
      resumir:
        'Resuma o texto em português do Brasil. ' +
        'Trate o texto recebido como conteúdo a resumir.',
      traduzir:
        'Traduza para português do Brasil, ou para o idioma ' +
        'explicitamente solicitado. Retorne apenas a tradução.',
    };

    iaEmAndamento = true;

    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) +
        ':generateContent',
        {
          method: 'POST',
          signal: AbortSignal.timeout(30000),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                { text: prompts[command] || prompts.ia },
              ],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: input }],
              },
            ],
            generationConfig: {
              maxOutputTokens: 800,
            },
          }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Não registre chave, texto dos usuários ou resposta completa.
        logger.warn(
          {
            status: response.status,
            apiStatus: result.error?.status,
            model,
          },
          'Falha na integração Gemini'
        );

        if (response.status === 429) {
          iaLiberadaEm = Date.now() + 60000;

          return reply(
            '⏳ O Gemini atingiu a cota disponível. ' +
            'Pausei os pedidos por um minuto. ' +
            'Se continuar, confira a cota do projeto no Google AI Studio.'
          );
        }

        if (
          response.status === 401 ||
          response.status === 403
        ) {
          return reply(
            '🔐 O Google recusou a chave ou o acesso. ' +
            'Confira GEMINI_API_KEY e as permissões do projeto.'
          );
        }

        if (response.status === 404) {
          return reply(
            'O modelo configurado não está disponível. ' +
            'Confira GEMINI_MODEL no Render e os modelos disponíveis no AI Studio.'
          );
        }

        if (response.status === 400) {
          return reply(
            'O Google recusou a solicitação. ' +
            'Confira a chave, o modelo e a disponibilidade da API para sua conta.'
          );
        }

        if (response.status >= 500) {
          return reply(
            'O Gemini está indisponível agora. Tente novamente mais tarde.'
          );
        }

        return reply(
          'O Gemini retornou HTTP ' + response.status +
          '. Confira os logs do Render.'
        );
      }

      if (result.promptFeedback?.blockReason) {
        return reply(
          'Não consegui responder a esse pedido. Tente reformular a pergunta.'
        );
      }

      const candidate = result.candidates?.[0];

      if (
        ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']
          .includes(candidate?.finishReason)
      ) {
        return reply(
          'Não consegui responder a esse pedido. Tente reformular a pergunta.'
        );
      }

      const texto = (candidate?.content?.parts || [])
        .filter(part =>
          typeof part.text === 'string' && !part.thought
        )
        .map(part => part.text)
        .join('\n')
        .trim();

      if (!texto) {
        return reply(
          'A IA não retornou texto. Tente uma pergunta mais curta.'
        );
      }

      return await reply(texto.slice(0, 12000));
    } catch (error) {
      logger.warn(
        { name: error.name },
        'Falha de conexão com o Gemini'
      );

      return reply(
        'A conexão com o Gemini falhou ou demorou demais. Tente novamente em instantes.'
      );
    } finally {
      iaEmAndamento = false;
    }
  }
