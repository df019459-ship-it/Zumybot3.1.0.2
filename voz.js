import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const NOME = /(?<![\p{L}\p{N}_])zumy(?![\p{L}\p{N}_])/iu;
export const chamouZumy = text => typeof text === 'string' && NOME.test(text);
export const estilosVoz = Object.freeze({
  anime: { voice: 'Kore', style: 'Português brasileiro. Interpretação feminina adulta original inspirada em anime, alegre, expressiva e natural. Sem imitar uma personagem específica.' },
  doce: { voice: 'Kore', style: 'Português brasileiro. Voz feminina doce, acolhedora, suave e sorridente, ritmo natural.' },
  calma: { voice: 'Kore', style: 'Português brasileiro. Voz feminina calma e gentil, com ritmo tranquilo e pausas naturais.' },
  brava: { voice: 'Kore', style: 'Português brasileiro. Voz feminina firme e séria, com leve indignação teatral, sem gritar e sem acrescentar ofensas.' },
});
export function periodoDoDia(data = new Date(), timeZone = 'America/Fortaleza') {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(data));
  return hour < 5 ? 'Boa madrugada!' : hour < 12 ? 'Bom dia!' : hour < 18 ? 'Boa tarde!' : 'Boa noite!';
}

async function lerJsonLimitado(response) {
  if (!response.body) throw Error('Resposta vazia');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 20 * 1024 * 1024) throw Error('Resposta de voz muito grande');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

async function gerarAudio(texto, estilo, chave, consultar, modelo) {
  const response = await consultar('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: modelo,
      input: [{ type: 'user_input', content: [{
        type: 'text', text: texto,
        annotations: [{ type: 'speech_metadata', style: estilo.style }],
      }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: estilo.voice }] },
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(Error('Serviço de voz recusou a solicitação'), { status: response.status });
  }
  const result = await lerJsonLimitado(response);
  const blocks = (Array.isArray(result.steps) ? result.steps : [])
    .filter(step => step.type === 'model_output')
    .flatMap(step => Array.isArray(step.content) ? step.content : [])
    .filter(block => block.type === 'audio' && typeof block.data === 'string');
  const block = blocks.at(-1);
  if (!block?.data || block.data.length > 17 * 1024 * 1024) throw Error('A API não retornou áudio válido');
  const audio = Buffer.from(block.data, 'base64');
  if (!audio.length || audio.length > 12 * 1024 * 1024) throw Error('Áudio vazio ou muito grande');
  const wav = audio.length >= 12 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
  const mime = String(block.mime_type || block.mimeType || '').toLowerCase();
  if (!wav && !/^audio\/(?:l16|pcm)(?:;|$)/.test(mime)) throw Error('Formato de áudio não reconhecido');
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] || 24000);
  if (!wav && ![16000, 22050, 24000, 44100, 48000].includes(rate)) throw Error('Taxa de áudio não reconhecida');
  const folder = await mkdtemp(join(tmpdir(), 'zumy-voz-'));
  try {
    const input = join(folder, wav ? 'fala.wav' : 'fala.pcm');
    const output = join(folder, 'fala.ogg');
    await writeFile(input, audio, { mode: 0o600 });
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1'];
    if (!wav) args.push('-f', 's16le', '-ar', String(rate), '-ac', '1');
    args.push('-i', input, '-t', '90', '-c:a', 'libopus', '-b:a', '48k', '-ac', '1', '-ar', '48000', '-application', 'voip', output);
    await exec('ffmpeg', args, { timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 8192 });
    const ogg = await readFile(output);
    if (!ogg.length || ogg.length > 2 * 1024 * 1024 || ogg.toString('ascii', 0, 4) !== 'OggS') throw Error('Conversão de voz inválida');
    return ogg;
  } finally { await rm(folder, { recursive: true, force: true }); }
}

export function criarVoz({ env = process.env, logger = console, consultar = fetch, gerar = gerarAudio, perguntar } = {}) {
  const filas = new Map();
  const audios = new Map();
  const avisos = new Set();
  let pendentes = 0;
  let ocupado = false;
  let liberarEm = 0;
  let ultimoErro;
  function log(error) {
    ultimoErro = error;
    if (error.status === 429) liberarEm = Date.now() + 60000;
    logger.warn({ name: error.name, status: error.status, code: error.code === 'ENOENT' ? 'ENOENT' : undefined }, 'Falha na voz Gemini da Zumy');
  }
  async function falar(contexto, texto) {
    const chave = env.GEMINI_API_KEY?.trim();
    if (!chave && gerar === gerarAudio) throw Object.assign(Error('Falta GEMINI_API_KEY'), { code: 'MISSING_KEY' });
    if (Date.now() < liberarEm) throw Object.assign(Error('Aguarde a cota'), { status: 429 });
    if (ocupado) throw Object.assign(Error('Voz ocupada'), { code: 'BUSY' });
    ocupado = true;
    try {
      const settings = contexto.settings || {};
      const nome = Object.hasOwn(estilosVoz, settings.voiceStyle) ? settings.voiceStyle : 'anime';
      const modelo = (env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.8-flash-lite-tts').replace(/^models\//, '');
      if (!/^[a-zA-Z0-9._-]+$/.test(modelo)) throw Error('GEMINI_TTS_MODEL inválido');
      const key = JSON.stringify([modelo, nome, texto]);
      let audio = audios.get(key);
      if (!audio) {
        audio = await gerar(texto, estilosVoz[nome], chave, consultar, modelo);
        if (!Buffer.isBuffer(audio) || !audio.length || audio.length > 2 * 1024 * 1024) throw Error('Áudio inválido');
        if (audios.size >= 8) audios.delete(audios.keys().next().value);
        audios.set(key, audio);
      }
      if (!settings.voiceDisclosed && !avisos.has(contexto.jid)) {
        await contexto.send({ text: '🎙️ A voz da Zumy é gerada por inteligência artificial.' }, { citar: false, narrar: false });
        if (avisos.size >= 500) avisos.delete(avisos.values().next().value);
        avisos.add(contexto.jid);
        try { await contexto.update?.({ voiceDisclosed: true }); }
        catch (error) { log(error); }
      }
      await contexto.send({ audio, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { narrar: false });
      return true;
    } finally { ocupado = false; }
  }
  function enfileirar(contexto, texto) {
    if (typeof texto !== 'string' || !texto.trim()) return Promise.resolve(false);
    if (contexto.settings?.voiceEnabled === false) return Promise.resolve(false);
    const fila = filas.get(contexto.jid) || { ultima: Promise.resolve(), total: 0 };
    if (fila.total >= 3 || pendentes >= 12) return Promise.resolve(false);
    filas.set(contexto.jid, fila);
    fila.total++; pendentes++;
    const task = fila.ultima.then(async () => {
      try { return await falar(contexto, texto.trim().slice(0, 650)); }
      catch (error) { log(error); return false; }
    }).finally(() => {
      fila.total--; pendentes--;
      if (!fila.total) filas.delete(contexto.jid);
    });
    fila.ultima = task;
    return task;
  }
  function narrar(contexto, texto) { return enfileirar(contexto, texto); }
  async function conversar(contexto) {
    const pergunta = String(contexto.text || '').replace(new RegExp(NOME.source, 'giu'), ' ').replace(/^[,!.?;: ]+/, '').trim();
    let resposta;
    if (!pergunta) resposta = periodoDoDia(new Date(), env.BOT_TIMEZONE || 'America/Fortaleza') + ' Sou a Zumy. Como posso ajudar?';
    else {
      try { resposta = await perguntar?.(pergunta.slice(0, 6000)); }
      catch (error) { log(error); }
    }
    const texto = typeof resposta === 'string' && resposta.trim() ? resposta.trim() : 'Minha conexão com a inteligência artificial está indisponível agora.';
    if (!await enfileirar(contexto, texto)) return contexto.reply(texto);
  }
  async function testar(contexto) {
    ultimoErro = undefined;
    const ok = await enfileirar({ ...contexto, settings: { ...contexto.settings, voiceEnabled: true } }, 'Olá! Eu sou a Zumy. Minha voz feminina está funcionando.');
    if (ok) return;
    const error = ultimoErro;
    if (error?.code === 'MISSING_KEY') return contexto.reply('Configure GEMINI_API_KEY na Discloud.');
    if (error?.code === 'ENOENT') return contexto.reply('Não encontrei FFmpeg. Confira APT=tools, ffmpeg no discloud.config.');
    if (error?.status === 404) return contexto.reply('O modelo de voz não está disponível. Confira GEMINI_TTS_MODEL na Discloud.');
    if (error?.status === 429) return contexto.reply('A voz atingiu a cota do Gemini. Aguarde ou confira os limites do projeto.');
    if ([401, 403].includes(error?.status)) return contexto.reply('O Google recusou o acesso à voz. Confira a chave e as permissões do projeto.');
    return contexto.reply(error?.status ? 'Voz indisponível. Google retornou HTTP ' + error.status + '.' : 'Voz indisponível ou ocupada. Confira os logs e tente novamente.');
  }
  return { narrar, conversar, testar };
}
