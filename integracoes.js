import { execFile } from 'node:child_process';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prefix } from './menu.js';

const executar = promisify(execFile);

const maxMediaBytes = 8 * 1024 * 1024;
const maxAudioBytes = 12 * 1024 * 1024;

const pastaProjeto = fileURLToPath(
  new URL('.', import.meta.url)
);

const trackName = value => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/\.(mp3|m4a)$/i, '')
  .replace(/[_|–—-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function ocultarSegredos(valor, env) {
  let texto = String(valor || '');

  for (const segredo of [
    env.GEMINI_API_KEY,
    env.ADMIN_TOKEN,
    env.YOUTUBE_COOKIES_FILE,
  ]) {
    if (
      typeof segredo === 'string' &&
      segredo.length > 3
    ) {
      texto = texto.split(segredo).join('[OCULTO]');
    }
  }

  return texto
    .split(/\r?\n/)
    .filter(linha => !linha.includes('\t'))
    .join('\n')
    .replace(
      /https?:\/\/[^\s"'<>]+/gi,
      '[URL OCULTA]'
    )
    .replace(
      /\b(cookie|authorization|token|api[_-]?key)\s*[:=][^\r\n]*/gi,
      '$1=[OCULTO]'
    )
    .replace(
      /[A-Za-z0-9_+/=-]{40,}/g,
      '[DADO OCULTO]'
    )
    .slice(-2000);
}

async function convert({
  data,
  text,
  animated = false,
  toImage = false,
  color = '151827',
  decoration = '',
}) {
  const folder = await mkdtemp(
    join(tmpdir(), 'zumy-')
  );

  try {
    const output = join(
      folder,
      toImage ? 'out.png' : 'out.webp'
    );

    const input = join(folder, 'input');

    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel', 'error',
      '-threads', '1',
      '-filter_threads', '1',
    ];

    if (text) {
      await writeFile(input, text);

      args.push(
        '-f', 'lavfi',
        '-i', 'color=c=0x' + color + ':s=512x512:r=10'
      );

      const draw =
        'drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:' +
        'textfile=input:expansion=none:fontsize=41:' +
        'line_spacing=8:x=(w-tw)/2:y=(h-th)/2:fontcolor=';

      const colors = [
        'f6d365',
        '84fab0',
        '99ccff',
        'ff92ae',
      ];

      const filter = animated
        ? colors.map((item, index) =>
          draw + item +
          ":enable='between(t," +
          index / 2 + ',' +
          (index / 2 + 0.49) +
          ")'"
        ).join(',')
        : draw + 'ffffff';

      args.push(
        '-vf',
        decoration
          ? decoration + ',' + filter
          : filter
      );
    } else {
      await writeFile(input, data);

      args.push(
        '-protocol_whitelist', 'file',
        '-i', input
      );

      if (!toImage) {
        args.push(
          '-vf',
          (animated ? 'fps=10,' : '') +
          'scale=512:512:force_original_aspect_ratio=decrease,' +
          'format=rgba,' +
          'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000'
        );
      }
    }

    if (toImage || !animated) {
      args.push('-frames:v', '1');
    } else {
      args.push(
        '-t', text ? '2' : '5',
        '-loop', '0'
      );
    }

    if (!toImage) {
      args.push(
        '-c:v',
        animated ? 'libwebp_anim' : 'libwebp',
        '-quality', '65'
      );
    }

    await executar(
      'ffmpeg',
      [...args, '-an', output],
      {
        cwd: folder,
        timeout: 20000,
        maxBuffer: 65536,
      }
    );

    const buffer = await readFile(output);

    if (!buffer.length) {
      throw new Error(
        'FFmpeg não gerou um arquivo de saída.'
      );
    }

    return buffer;
  } finally {
    await rm(folder, {
      recursive: true,
      force: true,
    });
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    await response.body?.cancel();

    throw new Error(
      'Serviço externo retornou HTTP ' +
      response.status
    );
  }

  return response.json();
}

const audioTypes = new Map([
  ['audio/mpeg', 'audio/mpeg'],
  ['audio/mp3', 'audio/mpeg'],
  ['audio/x-mp3', 'audio/mpeg'],
  ['audio/mp4', 'audio/mp4'],
  ['audio/x-m4a', 'audio/mp4'],
]);

const genericDownloadTypes = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/force-download',
  'application/download',
  'application/x-download',
]);

async function confirmMp3(audio) {
  const folder = await mkdtemp(
    join(tmpdir(), 'zumy-audio-')
  );

  try {
    const file = join(folder, 'track.mp3');

    await writeFile(file, audio);

    const { stdout } = await executar(
      'ffprobe',
      [
        '-v', 'error',
        '-protocol_whitelist', 'file',
        '-f', 'mp3',
        '-i', file,
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
      ],
      {
        timeout: 5000,
        maxBuffer: 8192,
      }
    );

    if (stdout.trim() !== 'mp3') {
      throw new Error('Codec diferente de MP3.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw error;

    throw new Error(
      'O arquivo recebido não contém áudio MP3 válido.'
    );
  } finally {
    await rm(folder, {
      recursive: true,
      force: true,
    });
  }
}

async function readAudio(
  response,
  {
    allowGenericMp3 = false,
    allowVideo = false,
  } = {}
) {
  const contentType =
    response.headers.get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase() || '';

  const knownType =
    allowVideo && contentType === 'video/mp4'
      ? contentType
      : audioTypes.get(contentType);

  const checkMp3 =
    !knownType &&
    allowGenericMp3 &&
    genericDownloadTypes.has(contentType);

  if ((!knownType && !checkMp3) || !response.body) {
    await response.body?.cancel();

    throw new Error(
      'O endereço precisa fornecer um arquivo ' +
      (allowVideo ? 'MP3, M4A ou MP4' : 'MP3 ou M4A') +
      '. Tipo recebido: ' +
      (contentType.slice(0, 80) || 'não informado') +
      '.'
    );
  }

  if (
    Number(response.headers.get('content-length')) >
    maxAudioBytes
  ) {
    await response.body.cancel();
    throw new Error('O áudio pode ter até 12 MB.');
  }

  const chunks = [];
  let length = 0;

  for await (const chunk of response.body) {
    length += chunk.byteLength;

    if (length > maxAudioBytes) {
      throw new Error('O áudio pode ter até 12 MB.');
    }

    chunks.push(chunk);
  }

  if (!length) {
    throw new Error('O arquivo de áudio está vazio.');
  }

  const audio = Buffer.concat(chunks, length);

  if (checkMp3) {
    await confirmMp3(audio);
  }

  if (knownType === 'video/mp4') {
    return {
      video: audio,
      mimetype: knownType,
    };
  }

  return {
    audio,
    mimetype: knownType || 'audio/mpeg',
    ptt: false,
  };
}

function audioOrigin(value) {
  try {
    const url = new URL(value);

    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password
    ) {
      return url.origin;
    }
  } catch {
    return undefined;
  }
}

function jamendoMediaUrl(value) {
  if (!audioOrigin(value)) return false;

  const url = new URL(value);

  return (
    !url.port &&
    /(?:^|\.)jamendo\.com$/i.test(url.hostname)
  );
}

async function downloadJamendo(url) {
  const signal = AbortSignal.timeout(20000);

  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!jamendoMediaUrl(url)) {
      throw new Error(
        'Origem de áudio do catálogo não reconhecida.'
      );
    }

    const response = await fetch(url, {
      redirect: 'manual',
      signal,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');

      await response.body?.cancel();

      if (!location) {
        throw new Error(
          'Redirecionamento do catálogo sem endereço.'
        );
      }

      url = new URL(location, url).href;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();

      throw new Error(
        'O catálogo retornou HTTP ' +
        response.status
      );
    }

    return readAudio(response, {
      allowGenericMp3: true,
    });
  }

  throw new Error(
    'O catálogo retornou muitos redirecionamentos.'
  );
}

const archiveOrigin = 'https://archive.org';

const archiveItem =
  /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,149}$/;

const archiveLicensePath =
  /^\/(?:licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/[a-z-]+)?|publicdomain\/zero\/1\.0)\/?$/i;

function licensedArchiveItem(record) {
  const licenses = [
    record?.metadata?.licenseurl,
  ].flat();

  if (licenses.length !== 1 || !licenses[0]) {
    return;
  }

  try {
    const url = new URL(licenses[0]);

    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.hostname !== 'creativecommons.org' ||
      url.port ||
      url.username ||
      url.password ||
      !archiveLicensePath.test(url.pathname)
    ) {
      return;
    }

    return (
      'https://creativecommons.org' +
      url.pathname
    );
  } catch {
    return;
  }
}

function archiveLink(arg) {
  try {
    const url = new URL(arg);

    if (
      url.origin !== archiveOrigin ||
      url.username ||
      url.password
    ) {
      return;
    }

    const [, route, id, ...rest] = url.pathname
      .replace(/\/$/, '')
      .split('/');

    if (
      route !== 'details' ||
      !archiveItem.test(id) ||
      rest.length
    ) {
      return;
    }

    return id;
  } catch {
    return;
  }
}

async function downloadArchive(url, video) {
  const signal = AbortSignal.timeout(20000);

  for (let redirects = 0; redirects <= 3; redirects++) {
    const next = new URL(url);

    if (
      next.protocol !== 'https:' ||
      next.port ||
      next.username ||
      next.password ||
      !/(?:^|\.)archive\.org$/i.test(next.hostname)
    ) {
      throw new Error(
        'O Archive redirecionou para fora do catálogo.'
      );
    }

    const response = await fetch(next, {
      redirect: 'manual',
      signal,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');

      await response.body?.cancel();

      if (!location) {
        throw new Error(
          'Redirecionamento do Archive sem endereço.'
        );
      }

      url = new URL(location, next).href;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();

      throw new Error(
        'Download do Archive retornou HTTP ' +
        response.status
      );
    }

    const media = await readAudio(response, {
      allowGenericMp3: !video,
      allowVideo: video,
    });

    if (video && !media.video) {
      throw new Error(
        'O item não retornou um vídeo MP4.'
      );
    }

    if (!video && media.mimetype !== 'audio/mpeg') {
      throw new Error('O item não retornou MP3.');
    }

    return media;
  }

  throw new Error(
    'O Archive retornou muitos redirecionamentos.'
  );
}

function chooseArchiveFile(
  record,
  extension,
  query,
  strictTitle
) {
  const files = (
    Array.isArray(record.files)
      ? record.files
      : []
  ).filter(file => {
    const size = Number(file?.size);

    return (
      typeof file?.name === 'string' &&
      !/[\\/]/.test(file.name) &&
      file.name.toLowerCase().endsWith(
        '.' + extension
      ) &&
      Number.isSafeInteger(size) &&
      size > 0 &&
      size <= maxAudioBytes &&
      !file.private
    );
  });

  if (!query) return files[0];

  const title = trackName(query);

  const match = files.find(file =>
    trackName(
      file.title || file.name
    ).includes(title)
  );

  if (
    match ||
    !strictTitle ||
    trackName(
      record.metadata?.title
    ).includes(title)
  ) {
    return match || files[0];
  }
}

const localTracks = [
  [
    'opera_o_anti_z_gavi_o.mp3',
    ['opera', 'opera o anti z gavi o'],
  ],
  [
    'estou_apaixonado.m4a',
    ['estou apaixonado', 'daniel', 'estoy enamorado'],
  ],
  [
    'interrogacoes.m4a',
    ['interrogacoes', 'all star brasil'],
  ],
  [
    'AUD-20261016-WA0254.mp3',
    ['produção dj tk', 'wa0254', 'aud 20261016 wa0254'],
  ],
  [
    'viu_mulher_mudou_o_tom.mp3',
    ['viu mulher mudou o tom'],
  ],
  [
    'minha_princesa_complicada.mp3',
    ['minha princesa complicada'],
  ],
  [
    'lunes_que_sabe_a_viernes.mp3',
    ['lunes que sabe a viernes'],
  ],
  [
    'la_diabla_mexicana.mp3',
    ['la diabla mexicana'],
  ],
];

const fileByName = new Map(
  localTracks.flatMap(([file, aliases]) =>
    [file, ...aliases].map(alias => [
      trackName(alias),
      file,
    ])
  )
);

export function createIntegrations({
  downloadMedia,
  logger = console,
  env = process.env,
} = {}) {
  async function media(context, command) {
    const {
      arg,
      download,
      reply,
      send,
    } = context;

    const source = context.source || {};

    const toImage = command === 'toimg';
    const fromText =
      command === 'ttp' ||
      command === 'attp';

    const mediaType =
      source.stickerMessage ||
      source.imageMessage ||
      source.videoMessage;

    if (
      fromText &&
      (!arg || [...arg].length > 60)
    ) {
      return reply(
        'Use ' + prefix + command +
        ' com até 60 caracteres.'
      );
    }

    if (
      !fromText &&
      (
        toImage
          ? !source.stickerMessage
          : !mediaType
      )
    ) {
      return reply(
        toImage
          ? 'Responda a uma figurinha com !toimg.'
          : 'Envie uma imagem ou vídeo curto com !fig, ou responda à mídia.'
      );
    }

    if (
      !fromText &&
      Number(mediaType?.fileLength) > maxMediaBytes
    ) {
      return reply('A mídia pode ter até 8 MB.');
    }

    try {
      const data = fromText
        ? undefined
        : await download(downloadMedia);

      if (data && data.length > maxMediaBytes) {
        return reply('A mídia pode ter até 8 MB.');
      }

      const text = fromText
        ? (
          arg.replace(/\s+/g, ' ')
            .match(/.{1,14}/gu) || []
        ).join('\n')
        : undefined;

      const buffer = await convert({
        data,
        text,
        toImage,
        animated:
          command === 'attp' ||
          (!toImage && Boolean(source.videoMessage)),
      });

      if (
        !toImage &&
        buffer.length > 500 * 1024
      ) {
        return reply(
          'A figurinha ficou muito grande. Tente uma mídia mais curta.'
        );
      }

      return await send(
        toImage
          ? {
            image: buffer,
            mimetype: 'image/png',
          }
          : { sticker: buffer }
      );
    } catch (error) {
      logger.warn(
        {
          name: error.name,
          code: error.code,
          command,
        },
        'Falha ao converter mídia'
      );

      return reply(
        'Não consegui converter essa mídia. Tente outra imagem, vídeo ou figurinha.'
      );
    }
  }

  async function playByName({ arg, reply, send }) {
    const clientId = env.JAMENDO_CLIENT_ID?.trim();

    if (!clientId) {
      return reply(
        'Configure JAMENDO_CLIENT_ID na Discloud para usar o catálogo Jamendo.'
      );
    }

    if (arg.length > 150) {
      return reply(
        'Busque um título de até 150 caracteres.'
      );
    }

    const [title, artist] = arg
      .split('|', 2)
      .map(piece => piece.trim());

    if (!title) {
      return reply(
        'Use !play jamendo NOME | ARTISTA.'
      );
    }

    const query = new URLSearchParams({
      client_id: clientId,
      format: 'json',
      namesearch: title,
      limit: '10',
      type: 'single albumtrack',
    });

    if (artist) {
      query.set('artist_name', artist);
    }

    try {
      const data = await requestJson(
        'https://api.jamendo.com/v3.0/tracks/?' +
        query
      );

      if (data.headers?.status !== 'success') {
        return reply(
          'O catálogo não aceitou a busca. Confira a configuração do Jamendo.'
        );
      }

      const tracks = (
        Array.isArray(data.results)
          ? data.results
          : []
      ).filter(track =>
        track.audiodownload_allowed === true &&
        /^\d+$/.test(String(track.id))
      );

      const track = tracks.find(item =>
        trackName(item.name) === trackName(title)
      ) || tracks[0];

      if (!track) {
        return reply(
          'Nenhuma faixa com download autorizado nesse catálogo.'
        );
      }

      const downloadQuery = new URLSearchParams({
        client_id: clientId,
        id: String(track.id),
        action: 'download',
        audioformat: 'mp32',
      });

      const audio = await downloadJamendo(
        'https://api.jamendo.com/v3.0/tracks/file/?' +
        downloadQuery
      );

      const source = jamendoMediaUrl(track.shareurl)
        ? '\n' + track.shareurl
        : '';

      const license =
        /^https:\/\/creativecommons\.org\//.test(
          track.license_ccurl || ''
        )
          ? '\nLicença: ' + track.license_ccurl
          : '';

      await reply(
        '🎵 ' + track.name +
        ' — ' + track.artist_name +
        source + license
      );

      return await send(audio);
    } catch (error) {
      logger.warn(
        { name: error.name },
        'Falha ao buscar áudio no Jamendo'
      );

      return reply(
        'Não consegui baixar essa faixa do catálogo agora.'
      );
    }
  }

  async function playLocal({ reply, send }, filename) {
    const file = new URL(
      './' + filename,
      import.meta.url
    );

    try {
      const info = await stat(file);

      if (
        !info.isFile() ||
        !info.size ||
        info.size > maxAudioBytes
      ) {
        return reply(
          'O arquivo local precisa ser um MP3 ou M4A de até 12 MB.'
        );
      }

      const audio = await readFile(file);

      return await send({
        audio,
        mimetype: filename.endsWith('.m4a')
          ? 'audio/mp4'
          : 'audio/mpeg',
        ptt: false,
      });
    } catch (error) {
      logger.warn(
        { code: error.code },
        'Falha ao enviar áudio local'
      );

      return reply(
        'Não consegui enviar o áudio local. Confira se ele está na raiz do projeto publicado.'
      );
    }
  }

  async function playArchive(
    { arg, reply, send },
    requestedId
  ) {
    const [, extension, term] =
      /^(?:(mp3|mp4)\s+)?([\s\S]+)$/i.exec(
        arg.trim()
      ) || [];

    const format =
      extension?.toLowerCase() || 'mp3';

    const id =
      requestedId ||
      (term && archiveLink(term));

    const apenasArtista =
      /^artista(?:\s|$)/i.test(term || '');

    const entrada = (term || '').replace(
      /^artista(?:\s+|$)/i,
      ''
    );

    const limpar = value => value
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const [primeira, segunda] = entrada
      .split('|', 2)
      .map(limpar);

    const titulo = apenasArtista ? '' : primeira;
    const artista = apenasArtista
      ? primeira
      : segunda || '';

    if (
      !id &&
      (
        (!titulo && !artista) ||
        titulo.length + artista.length > 120
      )
    ) {
      return reply(
        'Use !play archive MÚSICA | ARTISTA. Para vídeo, use !play archive mp4 NOME.'
      );
    }

    const buscaExterna =
      'https://www.youtube.com/results?search_query=' +
      encodeURIComponent(
        [titulo, artista].filter(Boolean).join(' ')
      );

    const getItem = identifier => requestJson(
      archiveOrigin +
      '/metadata/' +
      encodeURIComponent(identifier)
    );

    try {
      let ids = id ? [id] : [];

      if (!id) {
        const search = new URL(
          '/advancedsearch.php',
          archiveOrigin
        );

        const filtro = artista
          ? (
            titulo
              ? ' AND title:"' + titulo + '"'
              : ''
          ) + ' AND creator:"' + artista + '"'
          : ' AND (title:"' + titulo +
            '" OR creator:"' + titulo + '")';

        search.searchParams.set(
          'q',
          'mediatype:' +
          (format === 'mp4' ? 'movies' : 'audio') +
          filtro +
          ' AND licenseurl:*'
        );

        search.searchParams.set('fl[]', 'identifier');
        search.searchParams.set('output', 'json');
        search.searchParams.set('rows', '4');

        const data = await requestJson(search);

        ids = (
          Array.isArray(data.response?.docs)
            ? data.response.docs
            : []
        )
          .map(doc => doc.identifier)
          .filter(value =>
            archiveItem.test(value || '')
          );
      }

      const results = await Promise.allSettled(
        ids.map(getItem)
      );

      let lastError = results.find(
        result => result.status === 'rejected'
      )?.reason;

      for (let i = 0; i < ids.length; i++) {
        if (results[i].status !== 'fulfilled') {
          continue;
        }

        const record = results[i].value;

        if (
          !record ||
          record.is_dark ||
          record.metadata?.['access-restricted-item']
        ) {
          continue;
        }

        const license = licensedArchiveItem(record);

        if (!license) continue;

        const creator = [
          record.metadata?.creator,
        ]
          .flat()
          .filter(Boolean)
          .join(', ')
          .slice(0, 180);

        if (
          !id &&
          artista &&
          !trackName(creator).includes(
            trackName(artista)
          )
        ) {
          continue;
        }

        const file = chooseArchiveFile(
          record,
          format,
          id ? '' : titulo,
          Boolean(!id && artista && titulo)
        );

        if (!file) continue;

        const page =
          archiveOrigin +
          '/details/' +
          encodeURIComponent(ids[i]);

        const raw =
          archiveOrigin +
          '/download/' +
          encodeURIComponent(ids[i]) +
          '/' +
          encodeURIComponent(file.name);

        let media;

        try {
          media = await downloadArchive(
            raw,
            format === 'mp4'
          );
        } catch (error) {
          lastError = error;
          continue;
        }

        const title = String(
          file.title ||
          record.metadata?.title ||
          file.name
        ).slice(0, 180);

        const credit =
          title +
          (creator ? ' — ' + creator : '') +
          '\nFonte: ' + page +
          '\nLicença: ' + license;

        if (media.video) {
          return await send({
            ...media,
            caption: credit,
          });
        }

        await reply(credit);
        return await send(media);
      }

      if (lastError) {
        logger.warn(
          { name: lastError.name },
          'Falha no Internet Archive'
        );

        return reply(
          'O Internet Archive não entregou o arquivo agora.'
        );
      }

      return reply(
        'Não encontrei um ' +
        format.toUpperCase() +
        ' de até 12 MB com licença de compartilhamento confirmada no Internet Archive.' +
        (
          id
            ? '\n' + archiveOrigin +
              '/details/' + encodeURIComponent(id)
            : '\nBuscar no YouTube: ' + buscaExterna
        )
      );
    } catch (error) {
      logger.warn(
        { name: error.name },
        'Falha na busca do Internet Archive'
      );

      return reply(
        'O Internet Archive está indisponível para esta busca.'
      );
    }
  }

  const youtubeActive = new Set();

  async function localizarYtDlp() {
    const configurado = env.YTDLP_PATH?.trim();

    if (configurado) {
      return configurado;
    }

    const local = join(
      pastaProjeto,
      'node_modules',
      '.bin',
      'yt-dlp'
    );

    try {
      await access(local, constants.X_OK);
      return local;
    } catch {
      return 'yt-dlp';
    }
  }

  function diagnosticarPlay(error, etapa) {
    const detalhe = String(
      error.stderr || ''
    ).toLowerCase();

    if (etapa === 'envio') {
      return [
        'PLAY-11',
        'O áudio foi preparado, mas o envio ao WhatsApp falhou.',
      ];
    }

    if (error.code === 'ENOENT') {
      return etapa === 'verificação'
        ? [
          'PLAY-12',
          'O downloader terminou sem criar musica.mp3.',
        ]
        : [
          'PLAY-13',
          'yt-dlp não foi encontrado. Confira o instalador e o build da Discloud.',
        ];
    }

    if (
      error.code === 'EACCES' ||
      /permission denied/.test(detalhe)
    ) {
      return [
        'PLAY-14',
        'O servidor não tem permissão para executar o downloader ou gravar os arquivos.',
      ];
    }

    if (
      error.code === 'ENOEXEC' ||
      /exec format error|error while loading shared libraries|glibc_|pyinstaller|failed to load python shared library/.test(detalhe)
    ) {
      return [
        'PLAY-15',
        'O executável instalado é incompatível ou está sem uma biblioteca necessária.',
      ];
    }

    if (
      error.killed ||
      error.signal === 'SIGKILL' ||
      error.name === 'TimeoutError'
    ) {
      return [
        'PLAY-02',
        'A pesquisa ou download ultrapassou o tempo limite.',
      ];
    }

    if (
      /cookies.*(expired|invalid)|failed to load cookies|does not look like a netscape/.test(detalhe)
    ) {
      return [
        'PLAY-04',
        'O downloader recusou o arquivo de cookies.',
      ];
    }

    if (
      /sign in|confirm you.re not a bot|login required/.test(detalhe)
    ) {
      return [
        'PLAY-03',
        'O YouTube exigiu autenticação ou recusou o acesso do servidor.',
      ];
    }

    if (
      /ffmpeg.*not found|ffprobe.*not found/.test(detalhe)
    ) {
      return [
        'PLAY-05',
        'FFmpeg ou FFprobe não foi encontrado no servidor.',
      ];
    }

    if (
      /requested format.*not available|no video formats/.test(detalhe)
    ) {
      return [
        'PLAY-06',
        'O YouTube não disponibilizou um formato para download.',
      ];
    }

    if (
      /unsupported url|no such option|unrecognized arguments/.test(detalhe)
    ) {
      return [
        'PLAY-09',
        'O downloader recusou o link ou uma opção configurada.',
      ];
    }

    if (
      /javascript|js runtime|challenge|ejs/.test(detalhe)
    ) {
      return [
        'PLAY-07',
        'Falhou o processamento JavaScript exigido pelo YouTube.',
      ];
    }

    if (
      /http error 403|http error 429|too many requests/.test(detalhe)
    ) {
      return [
        'PLAY-08',
        'O servidor de mídia recusou ou limitou o acesso.',
      ];
    }

    if (
      /name or service not known|temporary failure in name resolution|certificate verify failed|unable to download|network is unreachable|connection refused/.test(detalhe)
    ) {
      return [
        'PLAY-16',
        'Falha de rede, certificado ou comunicação com o serviço de mídia.',
      ];
    }

    if (error.name === 'SyntaxError') {
      return [
        'PLAY-10',
        'A pesquisa não retornou dados JSON válidos.',
      ];
    }

    return [
      'PLAY-01',
      'A pesquisa falhou. O detalhe técnico foi registrado em “Diagnóstico do play” nos logs da Discloud.',
    ];
  }

  async function playYoutube({
    arg,
    reply,
    send,
    jid,
  }) {
    arg = String(arg || '').trim();

    if (!jid) {
      return reply(
        'Não consegui identificar este chat.'
      );
    }

    if (!arg || arg.length > 500) {
      return reply(
        'Use !play NOME DA MÚSICA | ARTISTA ou um link, com até 500 caracteres.'
      );
    }

    if (youtubeActive.size) {
      return reply(
        'Há um download em andamento. Tente novamente em instantes.'
      );
    }

    youtubeActive.add(jid);

    let folder;
    let etapa = 'preparação';
    let ferramenta;

    try {
      folder = await mkdtemp(
        join(tmpdir(), 'zumy-youtube-')
      );

      ferramenta = await localizarYtDlp();

      const common = [
        '--ignore-config',
        '--no-playlist',
        '--js-runtimes', 'node',
        '--no-warnings',
        '--socket-timeout', '15',
        '--retries', '1',
        '--fragment-retries', '1',
      ];

      const cookiePath =
        env.YOUTUBE_COOKIES_FILE?.trim();

      if (cookiePath) {
        try {
          const info = await stat(cookiePath);

          if (
            !info.isFile() ||
            !info.size ||
            info.size > 1024 * 1024
          ) {
            throw new Error('Arquivo inválido');
          }

          const content = (
            await readFile(cookiePath, 'utf8')
          ).replace(/^\uFEFF/, '');

          const header = content
            .split(/\r?\n/)[0]
            .trim();

          if (
            !/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)$/.test(
              header
            )
          ) {
            throw new Error('Formato inválido');
          }

          const privateCopy = join(
            folder,
            'cookies.txt'
          );

          await writeFile(
            privateCopy,
            content,
            { mode: 0o600 }
          );

          common.push('--cookies', privateCopy);
        } catch {
          return await reply(
            'Confira YOUTUBE_COOKIES_FILE e se o arquivo de cookies Netscape existe na Discloud.'
          );
        }
      }

      let query = 'ytsearch1:' +
        arg.replace(/\|/g, ' ')
          .replace(/\s+/g, ' ');

      if (/^https?:\/\//i.test(arg)) {
        const url = new URL(arg);

        if (
          url.protocol !== 'https:' ||
          ![
            'youtube.com',
            'www.youtube.com',
            'm.youtube.com',
            'music.youtube.com',
            'youtu.be',
          ].includes(url.hostname) ||
          url.username ||
          url.password ||
          url.port
        ) {
          return await reply(
            'Use um link HTTPS do YouTube ou o nome da música.'
          );
        }

        query = url.href;
      }

      const run = (args, timeout) =>
        executar(
          ferramenta,
          [...common, ...args],
          {
            timeout,
            killSignal: 'SIGKILL',
            maxBuffer: 4 * 1024 * 1024,
          }
        );

      etapa = 'pesquisa';

      await reply('🔎 Buscando no YouTube…');

      const { stdout } = await run(
        [
          '--skip-download',
          '--dump-single-json',
          '--',
          query,
        ],
        45000
      );

      const result = JSON.parse(stdout);

      const video = Array.isArray(result?.entries)
        ? result.entries.find(item => item?.id)
        : result;

      if (
        !/^[A-Za-z0-9_-]{11}$/.test(
          video?.id || ''
        )
      ) {
        return await reply(
          'Não encontrei essa música. Tente título e artista.'
        );
      }

      if (
        video.is_live ||
        video.is_upcoming ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0 ||
        video.duration > 720
      ) {
        return await reply(
          'Escolha uma gravação disponível de até 12 minutos.'
        );
      }

      const url =
        'https://www.youtube.com/watch?v=' +
        video.id;

      etapa = 'download';

      await run(
        [
          '--extract-audio',
          '--audio-format', 'mp3',
          '--audio-quality', '128K',
          '--format', 'bestaudio/best',
          '--max-filesize', '24M',
          '--concurrent-fragments', '1',
          '--output',
          join(folder, 'musica.%(ext)s'),
          '--',
          url,
        ],
        120000
      );

      etapa = 'verificação';

      const path = join(folder, 'musica.mp3');
      const info = await stat(path);

      if (
        !info.isFile() ||
        !info.size ||
        info.size > 8 * 1024 * 1024
      ) {
        return await reply(
          'O MP3 passou de 8 MB ou ficou vazio. Escolha uma faixa mais curta.'
        );
      }

      const audio = await readFile(path);

      const titulo = String(
        video.title || 'Produção DJ TK'
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 150);

      const artista = String(
        video.artist ||
        video.creator ||
        video.uploader ||
        video.channel ||
        'Artista não informado'
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);

      const duracao =
        Math.floor(video.duration / 60) +
        ':' +
        String(
          Math.floor(video.duration % 60)
        ).padStart(2, '0');

      const caption =
        '🎶 *ZUMY • MÚSICA ENCONTRADA*\n\n' +
        '🎵 ' + titulo +
        '\n👤 ' + artista +
        '\n⏱️ ' + duracao +
        '\n🔗 ' + url;

      etapa = 'envio';

      let capaEnviada = false;

      try {
        const response = await fetch(
          'https://i.ytimg.com/vi/' +
          video.id +
          '/hqdefault.jpg',
          {
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          }
        );

        const type = response.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase();

        if (
          !response.ok ||
          !response.body ||
          ![
            'image/jpeg',
            'image/png',
            'image/webp',
          ].includes(type) ||
          Number(
            response.headers.get('content-length')
          ) > 2 * 1024 * 1024
        ) {
          await response.body?.cancel();
          throw new Error('Capa indisponível');
        }

        const chunks = [];
        let length = 0;

        for await (const chunk of response.body) {
          length += chunk.byteLength;

          if (length > 2 * 1024 * 1024) {
            throw new Error('Capa muito grande');
          }

          chunks.push(chunk);
        }

        if (!length) {
          throw new Error('Capa vazia');
        }

        await send({
          image: Buffer.concat(chunks, length),
          caption,
        });

        capaEnviada = true;
      } catch {
        // A capa é opcional.
      }

      if (!capaEnviada) {
        await reply(caption);
      }

      const fileName = (
        titulo
          .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
          .trim()
          .slice(0, 100) ||
        'Produção DJ TK'
      ) + '.mp3';

      return await send({
        audio,
        mimetype: 'audio/mpeg',
        fileName,
        ptt: false,
      });
    } catch (error) {
      const [codigo, motivo] =
        diagnosticarPlay(error, etapa);

      logger.warn(
        {
          codigo,
          etapa,
          name: error.name,
          exitCode:
            typeof error.code === 'number'
              ? error.code
              : undefined,
          systemCode:
            typeof error.code === 'string'
              ? error.code
              : undefined,
          signal: error.signal,
          killed: Boolean(error.killed),
          ferramenta: ferramenta
            ? 'yt-dlp'
            : undefined,
          stderrSeguro: ocultarSegredos(
            error.stderr,
            env
          ),
        },
        'Diagnóstico do play'
      );

      return await reply(
        '❌ ' + codigo +
        ' • ' + etapa +
        '\n' + motivo
      );
    } finally {
      try {
        if (folder) {
          await rm(folder, {
            recursive: true,
            force: true,
          });
        }
      } catch {
        logger.warn(
          'Não foi possível limpar os temporários do play'
        );
      }

      youtubeActive.delete(jid);
    }
  }

  async function playApple({
    arg,
    reply,
    send,
    jid,
  }) {
    let url;

    try {
      url = new URL(arg);
    } catch {
      return reply(
        'Link do Apple Music inválido.'
      );
    }

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'music.apple.com' ||
      url.username ||
      url.password ||
      url.port
    ) {
      return reply(
        'Use um link HTTPS de music.apple.com.'
      );
    }

    const parts = url.pathname
      .split('/')
      .filter(Boolean);

    const country =
      /^[a-z]{2}$/i.test(parts[0] || '')
        ? parts[0].toUpperCase()
        : 'BR';

    const id = url.searchParams.get('i') ||
      (
        parts[1] === 'song'
          ? parts.at(-1)
          : ''
      );

    if (!/^\d{1,20}$/.test(id || '')) {
      return reply(
        'Envie o link de uma música específica, com ?i=ID, ou use !play NOME | ARTISTA.'
      );
    }

    let song;

    try {
      const query = new URLSearchParams({
        id,
        country,
        entity: 'song',
      });

      const data = await requestJson(
        'https://itunes.apple.com/lookup?' +
        query
      );

      song = (
        Array.isArray(data.results)
          ? data.results
          : []
      ).find(item =>
        item.kind === 'song' &&
        String(item.trackId) === id &&
        typeof item.trackName === 'string' &&
        typeof item.artistName === 'string'
      );
    } catch (error) {
      logger.warn(
        { name: error.name },
        'Falha ao identificar música do Apple Music'
      );

      return reply(
        'Não consegui consultar o Apple Music agora. Use !play NOME | ARTISTA.'
      );
    }

    if (!song) {
      return reply(
        'Essa faixa não foi encontrada. Use !play NOME | ARTISTA.'
      );
    }

    const search = (
      song.trackName + ' ' + song.artistName
    ).replace(/\s+/g, ' ').trim();

    if (search.length > 150) {
      return reply(
        'O título e artista ultrapassam 150 caracteres. Use uma busca mais curta.'
      );
    }

    await reply(
      '🍎 Identificada: ' +
      song.trackName.slice(0, 150) +
      ' — ' +
      song.artistName.slice(0, 100) +
      '\n🔎 Vou procurar no YouTube. O resultado pode ser outra gravação.'
    );

    return playYoutube({
      arg: search,
      reply,
      send,
      jid,
    });
  }

  async function playAudio({
    arg,
    reply,
    send,
    jid,
  }) {
    arg = String(arg || '').trim();

    if (/^https?:\/\//i.test(arg)) {
      let url;

      try {
        url = new URL(arg);
      } catch {
        return reply(
          'Link inválido. Confira o endereço.'
        );
      }

      if (url.hostname === 'music.apple.com') {
        return playApple({
          arg,
          reply,
          send,
          jid,
        });
      }
    }

    if (!arg || trackName(arg) === 'lista') {
      return reply(
        '🎵 Áudios cadastrados\n' +
        localTracks.map(
          ([, [name]]) => '!play ' + name
        ).join('\n') +
        '\n\nYouTube: !play MÚSICA | ARTISTA.' +
        '\nTambém aceito links do YouTube e Apple Music.'
      );
    }

    if (/^(yt|youtube)(?:\s|$)/i.test(arg)) {
      return playYoutube({
        arg: arg.replace(
          /^(yt|youtube)\s*/i,
          ''
        ),
        reply,
        send,
        jid,
      });
    }

    if (/^jamendo\s+/i.test(arg)) {
      return playByName({
        arg: arg.replace(/^jamendo\s+/i, ''),
        reply,
        send,
      });
    }

    const name = trackName(arg);
    const localFile = fileByName.get(name);

    if (localFile) {
      return playLocal(
        { reply, send },
        localFile
      );
    }

    const audiusLink =
      'https://audius.co/BellMarques/ver%C3%A3o';

    if (
      ['verao', 'verao bell marques'].includes(name) ||
      arg === audiusLink
    ) {
      return playYoutube({
        arg: 'Verão Bell Marques',
        reply,
        send,
        jid,
      });
    }

    if (/^artista(?:\s|$)/i.test(arg)) {
      return playYoutube({
        arg: arg.replace(/^artista\s*/i, ''),
        reply,
        send,
        jid,
      });
    }

    if (/^archive(?:\s|$)/i.test(arg)) {
      return playArchive({
        arg: arg.slice(7),
        reply,
        send,
      });
    }

    const item = archiveLink(arg);

    if (item) {
      return playArchive(
        { arg, reply, send },
        item
      );
    }

    if (/^https:\/\//i.test(arg)) {
      const url = new URL(arg);

      if (
        [
          'youtube.com',
          'www.youtube.com',
          'm.youtube.com',
          'music.youtube.com',
          'youtu.be',
        ].includes(url.hostname)
      ) {
        return playYoutube({
          arg,
          reply,
          send,
          jid,
        });
      }
    }

    const origin = audioOrigin(arg);

    if (!origin) {
      if (/^\w+:\/\//.test(arg)) {
        return reply(
          'Use um link HTTPS direto de um MP3, M4A ou MP4.'
        );
      }

      return playYoutube({
        arg,
        reply,
        send,
        jid,
      });
    }

    const approvedOrigin = audioOrigin(
      env.MUSIC_AUDIO_ORIGIN
    );

    if (!approvedOrigin) {
      return reply(
        'Para áudio direto de outro servidor, configure MUSIC_AUDIO_ORIGIN na Discloud.'
      );
    }

    if (origin !== approvedOrigin) {
      return reply(
        'Use um link direto do servidor de áudio cadastrado pelo dono.'
      );
    }

    try {
      const response = await fetch(arg, {
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        await response.body?.cancel();

        return reply(
          'O servidor de áudio retornou HTTP ' +
          response.status + '.'
        );
      }

      const audio = await readAudio(response, {
        allowGenericMp3: true,
        allowVideo: true,
      });

      return await send(audio);
    } catch (error) {
      logger.warn(
        { name: error.name },
        'Falha ao enviar áudio'
      );

      if (
        /^(O endereço|O áudio|O arquivo)/.test(
          error.message
        )
      ) {
        return reply(error.message);
      }

      return reply(
        'Não consegui enviar o áudio. Confira se o link é direto e tente novamente.'
      );
    }
  }

  async function music({ arg, reply }, command) {
    arg = String(arg || '').trim();

    if (!arg) {
      return reply(
        'Use ' + prefix + command +
        ' nome da música ou artista.'
      );
    }

    if (command === 'letra') {
      return reply(
        '🎵 Buscar letra: https://www.google.com/search?q=' +
        encodeURIComponent(arg + ' letra')
      );
    }

    const query = new URLSearchParams({
      term: arg,
      country: 'BR',
      entity: 'song',
      limit: command === 'buscar' ? '5' : '1',
    });

    try {
      const result = await requestJson(
        'https://itunes.apple.com/search?' +
        query
      );

      const songs = (
        Array.isArray(result.results)
          ? result.results
          : []
      ).filter(song =>
        song.trackName &&
        /^https:\/\/music\.apple\.com\//.test(
          song.trackViewUrl
        )
      );

      if (!songs.length) {
        return reply(
          'Nenhuma faixa encontrada. Tente título e artista.'
        );
      }

      return reply(
        songs.map(song =>
          '🎵 ' + song.trackName +
          ' — ' + song.artistName +
          '\n' + song.trackViewUrl
        ).join('\n\n')
      );
    } catch (error) {
      logger.warn(
        { name: error.name },
        'Falha na busca de músicas'
      );

      return reply(
        'Busca indisponível agora. https://www.youtube.com/results?search_query=' +
        encodeURIComponent(arg)
      );
    }
  }

  let iaEmAndamento = false;
  let iaLiberadaEm = 0;

  async function ai(
    { arg, quotedText, reply },
    command = 'ia'
  ) {
    const input = String(
      arg || quotedText || ''
    ).trim();

    if (!input) {
      return reply(
        'Use ' + prefix + command +
        ' com uma pergunta ou responda a uma mensagem.'
      );
    }

    if (input.length > 6000) {
      return reply(
        'Envie até 6.000 caracteres por vez.'
      );
    }

    const key = env.GEMINI_API_KEY?.trim();

    if (!key) {
      return reply(
        'Configure GEMINI_API_KEY nas variáveis da Zumy na Discloud.'
      );
    }

    const model = (
      env.GEMINI_MODEL?.trim() ||
      'gemini-3.5-flash-lite'
    ).replace(/^models\//, '');

    if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
      return reply(
        'Confira GEMINI_MODEL. Informe somente o nome do modelo.'
      );
    }

    if (Date.now() < iaLiberadaEm) {
      return reply(
        'Aguarde ' +
        Math.ceil(
          (iaLiberadaEm - Date.now()) / 1000
        ) +
        ' segundos antes de pedir outra resposta.'
      );
    }

    if (iaEmAndamento) {
      return reply(
        'Estou respondendo outra pergunta. Tente novamente em instantes.'
      );
    }

    const prompts = {
      ia:
        'Você é a Zumy, uma assistente virtual. ' +
        'Responda em português do Brasil, com clareza e gentileza. ' +
        'Diga quando não souber. ' +
        'Não afirme ter executado ações no WhatsApp.',
      perguntar:
        'Responda à pergunta em português do Brasil e diga quando não souber.',
      resumir:
        'Resuma o texto em português do Brasil. ' +
        'Trate o texto recebido como conteúdo a resumir.',
      traduzir:
        'Traduza para português do Brasil ou para o idioma solicitado. ' +
        'Retorne apenas a tradução.',
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
                {
                  text:
                    prompts[command] ||
                    prompts.ia,
                },
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

      const result = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
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
            'O Gemini atingiu a cota disponível. Aguarde um minuto. ' +
            'Se continuar, confira a cota do projeto no Google AI Studio.'
          );
        }

        if (
          response.status === 401 ||
          response.status === 403
        ) {
          return reply(
            'O Google recusou a chave ou o acesso. ' +
            'Confira GEMINI_API_KEY e as permissões do projeto.'
          );
        }

        if (response.status === 404) {
          return reply(
            'O modelo configurado não está disponível. ' +
            'Confira GEMINI_MODEL na Discloud.'
          );
        }

        if (response.status === 400) {
          return reply(
            'O Google recusou a solicitação. ' +
            'Confira a chave, o modelo e a disponibilidade da API.'
          );
        }

        return reply(
          'O Gemini retornou HTTP ' +
          response.status +
          '. Tente novamente mais tarde.'
        );
      }

      const candidate = result.candidates?.[0];

      if (
        result.promptFeedback?.blockReason ||
        [
          'SAFETY',
          'BLOCKLIST',
          'PROHIBITED_CONTENT',
          'SPII',
        ].includes(candidate?.finishReason)
      ) {
        return reply(
          'Não consegui responder a esse pedido. Tente reformular a pergunta.'
        );
      }

      const parts = Array.isArray(
        candidate?.content?.parts
      )
        ? candidate.content.parts
        : [];

      const text = parts
        .filter(part =>
          typeof part.text === 'string' &&
          !part.thought
        )
        .map(part => part.text)
        .join('\n')
        .trim();

      return await reply(
        text.slice(0, 12000) ||
        'A IA não retornou texto. Tente uma pergunta mais curta.'
      );
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

  async function rankCard(command, title, score) {
    const palette = [
      '243B53',
      '493467',
      '17665D',
      '69354F',
      '2B4168',
      '705328',
    ];

    const hash = [...command].reduce(
      (acc, char) =>
        (
          acc * 31 +
          char.codePointAt(0)
        ) >>> 0,
      0
    );

    const name = title
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim();

    const rows = [];
    let line = '';

    for (const word of name.split(/\s+/)) {
      if (
        line &&
        line.length + word.length > 18
      ) {
        rows.push(line);
        line = '';
      }

      line +=
        (line ? ' ' : '') +
        word.slice(0, 20);
    }

    if (line) rows.push(line);

    const accent =
      palette[(hash + 3) % palette.length];

    const bars = 2 + (hash % 6);

    const decoration = [
      'drawbox=x=16:y=16:w=480:h=480:color=0x' +
      accent + ':t=6',

      ...Array.from(
        { length: bars },
        (_, n) =>
          'drawbox=x=' +
          (42 + n * 49) +
          ':y=' +
          (72 + ((hash >>> (n + 1)) % 18)) +
          ':w=35:h=5:color=white@0.5:t=fill'
      ),

      'drawbox=x=42:y=420:w=' +
      Math.max(
        8,
        Math.round(428 * score / 100)
      ) +
      ':h=12:color=white@0.7:t=fill',
    ].join(',');

    return convert({
      text:
        'ZUMY · RANKING\n\n' +
        rows.join('\n') +
        '\n\nTOP 1 · ' +
        score + '%',
      toImage: true,
      color:
        palette[hash % palette.length],
      decoration,
    });
  }

  return Object.fromEntries([
    ['rankCard', rankCard],

    ...[
      'fig',
      'sticker',
      'toimg',
      'ttp',
      'attp',
    ].map(command => [
      command,
      context => media(context, command),
    ]),

    ['play', playAudio],
    ['p', playAudio],

    ...[
      'buscar',
      'musica',
      'letra',
    ].map(command => [
      command,
      context => music(context, command),
    ]),

    ...[
      'ia',
      'perguntar',
      'resumir',
      'traduzir',
    ].map(command => [
      command,
      context => ai(context, command),
    ]),
  ]);
}
