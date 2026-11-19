import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const NOME_ZUMY = /(?<![\p{L}\p{N}_])zumy(?![\p{L}\p{N}_])/iu;

const LIMITE_FILA = 8;
const LIMITE_CACHE = 32;
const LIMITE_AVISOS = 500;

function normalizar(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

export function chamouZumy(texto) {
  return typeof texto === 'string' && NOME_ZUMY.test(texto);
}

export const estilosVoz = Object.freeze({
  anime: {
    voice: 'shimmer',
    style: 'Voz original com estilo de personagem feminina de anime. Alegre, expressiva e brincalhona, com entonação natural e ritmo leve.',
  },
  doce: {
    voice: 'coral',
    style: 'Fale com voz suave, acolhedora e sorridente, como numa conversa entre amigos.',
  },
  calma: {
    voice: 'marin',
    style: 'Fale em tom calmo e gentil, com ritmo tranquilo e pausas naturais.',
  },
  grave: {
    voice: 'cedar',
    style: 'Use tom mais grave e descontraído, com entonação natural.',
  },
});

export function periodoDoDia(
  data = new Date(),
  timeZone = 'America/Fortaleza',
) {
  const hora = Number(new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(data));

  if (hora < 5) return 'Boa madrugada!';
  if (hora < 12) return 'Bom dia!';
  if (hora < 18) return 'Boa tarde!';
  return 'Boa noite!';
}

function prepararResposta(texto, saudacao) {
  const fala = texto
    .replace(new RegExp(NOME_ZUMY.source, 'giu'), ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const limpa = normalizar(fala)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b(tudo bem|como (voce )?(esta|ta|vai)|como ce (ta|esta)|voce (esta|ta) bem|e ai tudo certo)\b/.test(limpa)) {
    return { resposta: 'Tô bem, sim! Obrigada por perguntar. E você, como tá?' };
  }

  if (/\b(quem (e|eh) voce|qual (e )?(o )?seu nome|se apresent[ae])\b/.test(limpa)) {
    return { resposta: 'Eu sou a Zumy, a assistente virtual do grupo. Pode falar comigo pelo meu nome.' };
  }

  if (!limpa || /^(oi|ola|opa|e ai|ei|bom dia|boa tarde|boa noite|boa madrugada|salve)( (a )?todos)?$/.test(limpa)) {
    return { resposta: `${saudacao} Oi, aqui é a Zumy. Tô te ouvindo!` };
  }

  if (/\b(toca|tocar|mande|manda|envie|envia)\b.*\b(musica|audio)\b/.test(limpa)) {
    return { resposta: 'Pra escolher uma música, digite exclamação play lista no grupo.' };
  }

  if (/\b(ajuda|me ajuda|comandos|como funciona)\b/.test(limpa) && limpa.split(' ').length <= 5) {
    return { resposta: 'Claro! Você pode me fazer uma pergunta ou digitar exclamação menu para ver o que posso fazer.' };
  }

  return { pergunta: fala.replace(/^[,!.?;: ]+/, '').slice(0, 500) };
}

async function gerarAudio(texto, estilo, chave, consultar) {
  const response = await consultar('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chave}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: estilo.voice,
      input: texto,
      response_format: 'wav',
      instructions: `Fale em português brasileiro. Pronuncie Zumy como Zumi. ${estilo.style}`,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const erro = await response.json().catch(() => ({}));

    throw Object.assign(new Error('Falha no serviço de voz'), {
      status: response.status,
      code: erro?.error?.code,
    });
  }

  const wav = Buffer.from(await response.arrayBuffer());
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' ||
      wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('A API não retornou um arquivo WAV válido.');
  }

  const pasta = await mkdtemp(join(tmpdir(), 'zumy-voz-'));

  try {
    const entrada = join(pasta, 'fala.wav');
    const saida = join(pasta, 'fala.ogg');

    await writeFile(entrada, wav);
    await exec('ffmpeg', [
      '-nostdin', '-v', 'error',
      '-i', entrada,
      '-c:a', 'libopus',
      '-ac', '1',
      '-ar', '48000',
      '-application', 'voip',
      saida,
    ], { timeout: 10000 });

    return await readFile(saida);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

export function criarVoz({
  env = process.env,
  logger = console,
  consultar = fetch,
  gerar = gerarAudio,
  perguntar,
} = {}) {
  const timeZone = env.BOT_TIMEZONE || 'America/Fortaleza';
  const chave = env.OPENAI_API_KEY?.trim();
  const temVoz = Boolean(chave) || gerar !== gerarAudio;

  const audios = new Map();
  const filas = new Map();
  const avisos = new Set();

  function registrarErro(erro, mensagem = 'Falha na voz do ZUMY') {
    logger.warn({
      status: erro?.status,
      code: erro?.code,
      name: erro?.name,
    }, mensagem);
  }

  function obterAudio(nome, texto) {
    const chaveCache = JSON.stringify([nome, texto]);
    const existente = audios.get(chaveCache);
    if (existente) return existente;

    if (audios.size >= LIMITE_CACHE) {
      audios.delete(audios.keys().next().value);
    }

    const tarefa = Promise.resolve()
      .then(() => gerar(texto, estilosVoz[nome], chave, consultar))
      .catch(erro => {
        if (audios.get(chaveCache) === tarefa) {
          audios.delete(chaveCache);
        }
        throw erro;
      });

    audios.set(chaveCache, tarefa);
    return tarefa;
  }

  async function falar({ settings, update, send, jid }, texto) {
    if (!temVoz) {
      throw new Error('Configure OPENAI_API_KEY no Render.');
    }

    const estilo = settings?.voiceStyle;
    const nome = Object.hasOwn(estilosVoz, estilo) ? estilo : 'anime';
    const audio = await obterAudio(nome, texto);

    if (!settings?.voiceDisclosed && !avisos.has(jid)) {
      await send(
        { text: '🎙️ A voz da Zumy é gerada por inteligência artificial.' },
        { citar: false },
      );

      if (avisos.size >= LIMITE_AVISOS) {
        avisos.delete(avisos.values().next().value);
      }
      avisos.add(jid);

      try {
        await update({ voiceDisclosed: true });
      } catch (erro) {
        registrarErro(erro, 'Falha ao salvar o aviso de voz do ZUMY');
      }
    }

    return send({
      audio,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
    });
  }

  function enfileirar(jid, executar) {
    const fila = filas.get(jid) ?? { ultima: Promise.resolve(), total: 0 };
    if (fila.total >= LIMITE_FILA) return;

    filas.set(jid, fila);
    fila.total++;

    const tarefa = fila.ultima.then(executar).finally(() => {
      fila.total--;
      if (fila.total === 0) filas.delete(jid);
    });

    fila.ultima = tarefa.catch(() => {});
    return tarefa;
  }

  function responderFilaCheia(contexto) {
    return contexto.reply(
      'Estou respondendo às mensagens anteriores. Tente novamente em instantes.',
    );
  }

  function narrar(contexto, texto) {
    if (typeof texto !== 'string' || !texto.trim() || !temVoz) return;

    return enfileirar(contexto.jid, async () => {
      try {
        await falar(contexto, texto.trim());
      } catch (erro) {
        registrarErro(erro);
      }
    });
  }

  function conversar(contexto) {
    const texto = contexto.text;
    if (typeof texto !== 'string' || !texto.trim()) return;

    const tarefa = enfileirar(contexto.jid, async () => {
      const pedido = prepararResposta(texto, periodoDoDia(new Date(), timeZone));
      let resposta = pedido.resposta;

      if (!resposta && typeof perguntar === 'function') {
        try {
          const resultado = await perguntar(pedido.pergunta);
          if (typeof resultado === 'string') resposta = resultado.trim();
        } catch (erro) {
          registrarErro(erro, 'Falha na consulta à IA do ZUMY');
        }
      }

      const fala = (
        resposta || 'Minha conexão com a inteligência artificial está indisponível agora.'
      ).slice(0, 650);

      if (!temVoz) return contexto.reply(fala);

      try {
        return await falar(contexto, fala);
      } catch (erro) {
        registrarErro(erro);
        return contexto.reply(fala);
      }
    });

    return tarefa ?? responderFilaCheia(contexto);
  }

  function testar(contexto) {
    const tarefa = enfileirar(contexto.jid, async () => {
      if (!temVoz) {
        return contexto.reply('Voz indisponível. Configure OPENAI_API_KEY no Render.');
      }

      try {
        return await falar(contexto, 'Oi! Aqui é a Zumy. Minha voz está funcionando!');
      } catch (erro) {
        registrarErro(erro);

        if (erro?.code === 'insufficient_quota') {
          return contexto.reply('Voz indisponível. A API da OpenAI está sem cota.');
        }

        if (erro?.status === 401) {
          return contexto.reply('Voz indisponível. A OpenAI recusou a chave configurada no Render.');
        }

        if (erro?.status) {
          return contexto.reply(`Voz indisponível. OpenAI retornou HTTP ${erro.status}.`);
        }

        return contexto.reply('Voz indisponível. Confira “Falha na voz do ZUMY” nos logs do Render.');
      }
    });

    return tarefa ?? responderFilaCheia(contexto);
  }

  return { narrar, conversar, testar };
      }
