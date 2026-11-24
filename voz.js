import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const NOME_ZUMY =
  /(?<![\p{L}\p{N}_])zumy(?![\p{L}\p{N}_])/iu;

const MAX_TEXTO = 650;
const MAX_CACHE = 8;
const MAX_FILA_GRUPO = 3;
const MAX_PENDENTES = 12;
const MAX_AUDIO = 2 * 1024 * 1024;
const MAX_RESPOSTA = 20 * 1024 * 1024;

function erroVoz(code, message, status) {
  return Object.assign(new Error(message), {
    code,
    status,
  });
}

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function chamouZumy(texto) {
  return (
    typeof texto === 'string' &&
    NOME_ZUMY.test(texto)
  );
}

export const estilosVoz = Object.freeze({
  anime: {
    voice: 'Kore',
    style:
      'Português brasileiro. Voz feminina adulta, ' +
      'original, inspirada em anime. Alegre, expressiva, ' +
      'brincalhona e natural. Sem imitar personagem específica.',
  },

  doce: {
    voice: 'Kore',
    style:
      'Português brasileiro. Voz feminina doce, ' +
      'suave, acolhedora e sorridente. Ritmo natural.',
  },

  calma: {
    voice: 'Kore',
    style:
      'Português brasileiro. Voz feminina calma, ' +
      'gentil e tranquila. Pausas naturais.',
  },

  brava: {
    voice: 'Kore',
    style:
      'Português brasileiro. Voz feminina firme e séria, ' +
      'com leve indignação teatral. Sem gritar ' +
      'e sem acrescentar ofensas.',
  },

  grave: {
    voice: 'Kore',
    style:
      'Português brasileiro. Voz feminina com tom ' +
      'mais encorpado, descontraído e natural.',
  },
});

export function periodoDoDia(
  data = new Date(),
  timeZone = 'America/Fortaleza',
) {
  const hora = Number(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(data)
  );

  if (hora < 5) return 'Boa madrugada!';
  if (hora < 12) return 'Bom dia!';
  if (hora < 18) return 'Boa tarde!';

  return 'Boa noite!';
}

function prepararResposta(texto, saudacao) {
  const fala = String(texto || '')
    .replace(
      new RegExp(NOME_ZUMY.source, 'giu'),
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  const limpa = normalizar(fala)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    /\b(tudo bem|como (voce )?(esta|ta|vai)|como ce (ta|esta)|voce (esta|ta) bem|e ai tudo certo)\b/
      .test(limpa)
  ) {
    return {
      resposta:
        'Tô bem, sim! Obrigada por perguntar. ' +
        'E você, como tá?',
    };
  }

  if (
    /\b(quem (e|eh) voce|qual (e )?(o )?seu nome|se apresent[ae])\b/
      .test(limpa)
  ) {
    return {
      resposta:
        'Eu sou a Zumy, a assistente virtual do grupo. ' +
        'Pode falar comigo pelo meu nome.',
    };
  }

  if (
    !limpa ||
    /^(oi|ola|opa|e ai|ei|bom dia|boa tarde|boa noite|boa madrugada|salve)( (a )?todos)?$/
      .test(limpa)
  ) {
    return {
      resposta:
        saudacao + ' Oi, aqui é a Zumy. Como posso ajudar?',
    };
  }

  if (
    /\b(toca|tocar|mande|manda|envie|envia)\b.*\b(musica|audio)\b/
      .test(limpa)
  ) {
    return {
      resposta:
        'Para escolher uma música, digite ' +
        'exclamação play e o nome da música no grupo.',
    };
  }

  if (
    /\b(ajuda|me ajuda|comandos|como funciona)\b/.test(limpa) &&
    limpa.split(' ').length <= 5
  ) {
    return {
      resposta:
        'Claro! Você pode me fazer uma pergunta ' +
        'ou digitar exclamação menu.',
    };
  }

  return {
    pergunta: fala
      .replace(/^[,!.?;: ]+/, '')
      .slice(0, 500),
  };
}

async function lerJsonLimitado(response) {
  if (!response.body) {
    throw erroVoz(
      'EMPTY_RESPONSE',
      'O Google retornou uma resposta vazia.'
    );
  }

  const partes = [];
  let tamanho = 0;

  for await (const parte of response.body) {
    tamanho += parte.byteLength;

    if (tamanho > MAX_RESPOSTA) {
      throw erroVoz(
        'RESPONSE_LIMIT',
        'A resposta de voz ultrapassou o limite.'
      );
    }

    partes.push(parte);
  }

  try {
    return JSON.parse(
      Buffer.concat(partes, tamanho).toString('utf8')
    );
  } catch {
    throw erroVoz(
      'INVALID_JSON',
      'O Google retornou uma resposta inválida.'
    );
  }
}

async function gerarAudio(
  texto,
  estilo,
  chave,
  consultar,
  modelo,
) {
  const response = await consultar(
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': chave,
      },

      signal: AbortSignal.timeout(45000),

      body: JSON.stringify({
        model: modelo,

        input: [
          {
            type: 'user_input',

            content: [
              {
                type: 'text',
                text: texto,

                annotations: [
                  {
                    type: 'speech_metadata',
                    style: estilo.style,
                  },
                ],
              },
            ],
          },
        ],

        response_format: {
          type: 'audio',
        },

        generation_config: {
          speech_config: [
            {
              voice: estilo.voice,
            },
          ],
        },
      }),
    }
  );

  if (!response.ok) {
    await response.body?.cancel();

    throw erroVoz(
      'GOOGLE_HTTP',
      'O Google recusou a solicitação de voz.',
      response.status
    );
  }

  const resultado = await lerJsonLimitado(response);

  const blocos = (
    Array.isArray(resultado.steps)
      ? resultado.steps
      : []
  )
    .filter(item => item.type === 'model_output')
    .flatMap(item =>
      Array.isArray(item.content)
        ? item.content
        : []
    )
    .filter(item =>
      item.type === 'audio' &&
      typeof item.data === 'string'
    );

  const bloco = blocos.at(-1);

  if (
    !bloco?.data ||
    bloco.data.length > 17 * 1024 * 1024
  ) {
    throw erroVoz(
      'NO_AUDIO',
      'O Google não retornou um bloco de áudio válido.'
    );
  }

  const audio = Buffer.from(bloco.data, 'base64');

  if (
    !audio.length ||
    audio.length > 12 * 1024 * 1024
  ) {
    throw erroVoz(
      'AUDIO_LIMIT',
      'O áudio está vazio ou ultrapassou o limite.'
    );
  }

  const wav =
    audio.length >= 12 &&
    audio.toString('ascii', 0, 4) === 'RIFF' &&
    audio.toString('ascii', 8, 12) === 'WAVE';

  const mime = String(
    bloco.mime_type ||
    bloco.mimeType ||
    ''
  ).toLowerCase();

  const pcm = /^audio\/(?:l16|pcm)(?:;|$)/.test(mime);

  if (!wav && !pcm) {
    throw erroVoz(
      'AUDIO_FORMAT',
      'O formato de áudio retornado não foi reconhecido.'
    );
  }

  const taxa = Number(
    /rate=(\d+)/.exec(mime)?.[1] || 24000
  );

  if (
    !wav &&
    ![16000, 22050, 24000, 44100, 48000].includes(taxa)
  ) {
    throw erroVoz(
      'AUDIO_FORMAT',
      'A taxa do áudio não foi reconhecida.'
    );
  }

  const pasta = await mkdtemp(
    join(tmpdir(), 'zumy-voz-')
  );

  try {
    const entrada = join(
      pasta,
      wav ? 'fala.wav' : 'fala.pcm'
    );

    const saida = join(pasta, 'fala.ogg');

    await writeFile(entrada, audio, {
      mode: 0o600,
    });

    const argumentos = [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-threads', '1',
    ];

    if (!wav) {
      argumentos.push(
        '-f', 's16le',
        '-ar', String(taxa),
        '-ac', '1'
      );
    }

    argumentos.push(
      '-i', entrada,
      '-t', '90',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ac', '1',
      '-ar', '48000',
      '-application', 'voip',
      saida
    );

    try {
      await exec(
        'ffmpeg',
        argumentos,
        {
          timeout: 20000,
          killSignal: 'SIGKILL',
          maxBuffer: 16384,
        }
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw erroVoz(
          'FFMPEG_MISSING',
          'FFmpeg não está instalado.'
        );
      }

      throw erroVoz(
        'FFMPEG_FAILED',
        'FFmpeg não conseguiu converter o áudio.'
      );
    }

    const ogg = await readFile(saida);

    if (
      !ogg.length ||
      ogg.length > MAX_AUDIO ||
      ogg.toString('ascii', 0, 4) !== 'OggS'
    ) {
      throw erroVoz(
        'OGG_INVALID',
        'A conversão não gerou um áudio OGG válido.'
      );
    }

    return ogg;
  } finally {
    await rm(pasta, {
      recursive: true,
      force: true,
    });
  }
}

export function criarVoz({
  env = process.env,
  logger = console,
  consultar = fetch,
  gerar = gerarAudio,
  perguntar,
} = {}) {
  const audios = new Map();
  const filas = new Map();
  const avisos = new Set();

  let pendentes = 0;
  let liberarEm = 0;
  let filaGlobal = Promise.resolve();

  function registrarErro(
    erro,
    mensagem = 'Falha na voz Gemini da Zumy',
  ) {
    if (erro?.status === 429) {
      liberarEm = Date.now() + 60000;
    }

    logger.warn(
      {
        name: erro?.name,
        status: erro?.status,
        code: erro?.code,
      },
      mensagem
    );
  }

  function descreverErro(erro) {
    if (erro?.code === 'MISSING_KEY') {
      return 'Configure GEMINI_API_KEY nas variáveis da Zumy na Discloud.';
    }

    if (erro?.code === 'MODEL_INVALID') {
      return 'Confira GEMINI_TTS_MODEL. Use somente o nome do modelo.';
    }

    if (erro?.code === 'FFMPEG_MISSING') {
      return 'FFmpeg não foi encontrado. Confira APT=tools, ffmpeg no discloud.config e recompile.';
    }

    if (erro?.status === 429) {
      return 'A voz atingiu a cota do Gemini. Aguarde um minuto e confira os limites do projeto.';
    }

    if ([401, 403].includes(erro?.status)) {
      return 'O Google recusou o acesso à voz. Confira a chave e as permissões do projeto.';
    }

    if (erro?.status === 404) {
      return 'O modelo de voz não está disponível para esta solicitação. Confira GEMINI_TTS_MODEL e o acesso do projeto.';
    }

    if (erro?.status === 400) {
      return 'O Google recusou a solicitação de voz com HTTP 400. Confira o modelo configurado.';
    }

    if (
      erro?.name === 'TimeoutError' ||
      erro?.name === 'AbortError'
    ) {
      return 'A geração de voz demorou demais. Tente novamente.';
    }

    if (erro?.status) {
      return 'O Google retornou HTTP ' + erro.status + '.';
    }

    if (erro?.code === 'SEND_FAILED') {
      return 'O áudio foi preparado, mas o WhatsApp não confirmou o envio.';
    }

    return (
      'Falha na voz' +
      (erro?.code ? ' (' + erro.code + ')' : '') +
      '. Confira “Falha na voz Gemini da Zumy” nos logs.'
    );
  }

  async function falar(contexto, texto) {
    const chave = env.GEMINI_API_KEY?.trim();

    if (!chave && gerar === gerarAudio) {
      throw erroVoz(
        'MISSING_KEY',
        'GEMINI_API_KEY não foi configurada.'
      );
    }

    if (Date.now() < liberarEm) {
      throw erroVoz(
        'COOLDOWN',
        'Aguarde a cota.',
        429
      );
    }

    const modelo = (
      env.GEMINI_TTS_MODEL?.trim() ||
      'gemini-3.8-flash-lite-tts'
    ).replace(/^models\//, '');

    if (!/^[a-zA-Z0-9._-]+$/.test(modelo)) {
      throw erroVoz(
        'MODEL_INVALID',
        'Nome do modelo inválido.'
      );
    }

    const settings = contexto.settings || {};

    const nome = Object.hasOwn(
      estilosVoz,
      settings.voiceStyle
    )
      ? settings.voiceStyle
      : 'anime';

    const chaveCache = JSON.stringify([
      modelo,
      nome,
      texto,
    ]);

    let audio = audios.get(chaveCache);

    if (!audio) {
      audio = await gerar(
        texto,
        estilosVoz[nome],
        chave,
        consultar,
        modelo
      );

      if (
        !Buffer.isBuffer(audio) ||
        !audio.length ||
        audio.length > MAX_AUDIO
      ) {
        throw erroVoz(
          'AUDIO_INVALID',
          'Áudio gerado inválido.'
        );
      }

      if (audios.size >= MAX_CACHE) {
        audios.delete(
          audios.keys().next().value
        );
      }

      audios.set(chaveCache, audio);
    }

    if (
      !settings.voiceDisclosed &&
      !avisos.has(contexto.jid)
    ) {
      await contexto.send(
        {
          text:
            '🎙️ A voz da Zumy é gerada por inteligência artificial.',
        },
        {
          citar: false,
          narrar: false,
        }
      );

      if (avisos.size >= 500) {
        avisos.delete(
          avisos.values().next().value
        );
      }

      avisos.add(contexto.jid);

      try {
        await contexto.update?.({
          voiceDisclosed: true,
        });
      } catch (erro) {
        registrarErro(
          erro,
          'Falha ao salvar aviso da voz Gemini'
        );
      }
    }

    try {
      await contexto.send(
        {
          audio,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        },
        {
          narrar: false,
        }
      );
    } catch {
      throw erroVoz(
        'SEND_FAILED',
        'Falha ao enviar voz no WhatsApp.'
      );
    }

    return true;
  }

  function enfileirar(contexto, executar) {
    const jid = contexto.jid;

    const total = filas.get(jid) || 0;

    if (
      total >= MAX_FILA_GRUPO ||
      pendentes >= MAX_PENDENTES
    ) {
      return;
    }

    filas.set(jid, total + 1);
    pendentes++;

    const tarefa = filaGlobal
      .then(executar)
      .finally(() => {
        const restante = (filas.get(jid) || 1) - 1;

        if (restante > 0) {
          filas.set(jid, restante);
        } else {
          filas.delete(jid);
        }

        pendentes--;
      });

    filaGlobal = tarefa.catch(() => {});

    return tarefa;
  }

  function filaCheia(contexto) {
    return contexto.reply(
      'Estou preparando outras respostas de voz. ' +
      'Tente novamente em instantes.'
    );
  }

  function narrar(contexto, texto) {
    if (
      contexto.settings?.voiceEnabled === false ||
      typeof texto !== 'string' ||
      !texto.trim()
    ) {
      return Promise.resolve(false);
    }

    const tarefa = enfileirar(
      contexto,
      async () => {
        try {
          return await falar(
            contexto,
            texto.trim().slice(0, MAX_TEXTO)
          );
        } catch (erro) {
          registrarErro(erro);
          return false;
        }
      }
    );

    return tarefa || Promise.resolve(false);
  }

  function conversar(contexto) {
    if (
      typeof contexto.text !== 'string' ||
      !contexto.text.trim()
    ) {
      return Promise.resolve(false);
    }

    const tarefa = enfileirar(
      contexto,
      async () => {
        const pedido = prepararResposta(
          contexto.text,
          periodoDoDia(
            new Date(),
            env.BOT_TIMEZONE || 'America/Fortaleza'
          )
        );

        let resposta = pedido.resposta;

        if (
          !resposta &&
          typeof perguntar === 'function'
        ) {
          try {
            const resultado = await perguntar(
              pedido.pergunta
            );

            if (typeof resultado === 'string') {
              resposta = resultado.trim();
            }
          } catch (erro) {
            registrarErro(
              erro,
              'Falha na consulta à IA da Zumy'
            );
          }
        }

        const texto = resposta ||
          'Minha conexão com a inteligência artificial está indisponível agora.';

        if (
          contexto.settings?.voiceEnabled === false
        ) {
          return contexto.reply(texto);
        }

        try {
          return await falar(
            contexto,
            texto.slice(0, MAX_TEXTO)
          );
        } catch (erro) {
          registrarErro(erro);
          return contexto.reply(texto);
        }
      }
    );

    return tarefa || filaCheia(contexto);
  }

  function testar(contexto) {
    const tarefa = enfileirar(
      contexto,
      async () => {
        try {
          return await falar(
            contexto,
            'Oi! Aqui é a Zumy. Minha voz feminina pelo Gemini está funcionando!'
          );
        } catch (erro) {
          registrarErro(erro);

          return contexto.reply(
            'Voz indisponível. ' +
            descreverErro(erro)
          );
        }
      }
    );

    return tarefa || filaCheia(contexto);
  }

  return {
    narrar,
    conversar,
    testar,
  };
      }
