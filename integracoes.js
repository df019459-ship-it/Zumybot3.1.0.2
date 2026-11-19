  const downloadsAtivos = new Set();

  async function playAudio({ arg, reply, send, jid }) {
    arg = String(arg || '').trim();

    if (!arg || trackName(arg) === 'lista') {
      return reply(
        '🎵 *ZUMY • MÚSICAS*\n\n' +
        'Pesquisar: !play Morena | Luan Santana\n' +
        'Também aceito links do YouTube e de músicas do Apple Music.\n\n' +
        '*Áudios locais:*\n' +
        localTracks.map(
          ([, [name]]) => '!play ' + name
        ).join('\n')
      );
    }

    const localFile = fileByName.get(trackName(arg));

    if (localFile) {
      return playLocal({ reply, send }, localFile);
    }

    // Mantém o catálogo antigo apenas quando solicitado.
    if (/^jamendo\s+/i.test(arg)) {
      return playByName({
        arg: arg.replace(/^jamendo\s+/i, ''),
        reply,
        send,
      });
    }

    if (/^archive(?:\s|$)/i.test(arg)) {
      return playArchive({
        arg: arg.slice(7).trim(),
        reply,
        send,
      });
    }

    const archiveId = archiveLink(arg);

    if (archiveId) {
      return playArchive(
        { arg, reply, send },
        archiveId
      );
    }

    if (!jid) {
      return reply(
        'Não consegui identificar o chat para iniciar o download.'
      );
    }

    // Um download por vez no servidor para reduzir a carga.
    if (downloadsAtivos.size) {
      return reply(
        '⏳ Já estou baixando uma música. Aguarde terminar.'
      );
    }

    if (arg.length > 500) {
      return reply(
        'Envie uma pesquisa ou link com até 500 caracteres.'
      );
    }

    downloadsAtivos.add(jid);

    let pasta;
    let etapa = 'preparação';

    try {
      let consulta;

      const entrada = arg.replace(
        /^(?:yt|youtube)\s+/i,
        ''
      ).trim();

      if (/^https?:\/\//i.test(entrada)) {
        let endereco;

        try {
          endereco = new URL(entrada);
        } catch {
          return await reply('O link enviado é inválido.');
        }

        if (
          endereco.protocol !== 'https:' ||
          endereco.username ||
          endereco.password ||
          endereco.port
        ) {
          return await reply(
            'Use um link HTTPS válido, sem usuário ou senha.'
          );
        }

        const hostsYouTube = [
          'youtube.com',
          'www.youtube.com',
          'm.youtube.com',
          'music.youtube.com',
          'youtu.be',
        ];

        if (hostsYouTube.includes(endereco.hostname)) {
          consulta = endereco.href;
        } else if (endereco.hostname === 'music.apple.com') {
          etapa = 'consulta ao Apple Music';

          const partes = endereco.pathname
            .split('/')
            .filter(Boolean);

          const id = endereco.searchParams.get('i') ||
            (
              partes[1] === 'song'
                ? partes.at(-1)
                : ''
            );

          if (!/^\d{1,20}$/.test(id || '')) {
            return await reply(
              'Envie o link de uma música específica da Apple, ' +
              'com ?i=ID, ou use !play NOME | ARTISTA.'
            );
          }

          const country = /^[a-z]{2}$/i.test(partes[0] || '')
            ? partes[0].toUpperCase()
            : 'BR';

          const parametros = new URLSearchParams({
            id,
            country,
            entity: 'song',
          });

          const resultado = await requestJson(
            'https://itunes.apple.com/lookup?' + parametros
          );

          const faixa = (
            Array.isArray(resultado.results)
              ? resultado.results
              : []
          ).find(item =>
            item.kind === 'song' &&
            String(item.trackId) === id &&
            typeof item.trackName === 'string' &&
            typeof item.artistName === 'string'
          );

          if (!faixa) {
            return await reply(
              'Não encontrei essa faixa na Apple. ' +
              'Use !play NOME DA MÚSICA | ARTISTA.'
            );
          }

          const busca = (
            faixa.trackName + ' ' + faixa.artistName
          ).replace(/\s+/g, ' ').trim();

          if (busca.length > 200) {
            return await reply(
              'O título é muito longo. Use !play com uma busca mais curta.'
            );
          }

          await reply(
            '🍎 Identificada: ' +
            faixa.trackName.slice(0, 120) +
            ' — ' +
            faixa.artistName.slice(0, 80) +
            '\nVou procurar essa faixa no YouTube.'
          );

          consulta = 'ytsearch1:' + busca;
        } else {
          const origemPermitida = audioOrigin(
            env.MUSIC_AUDIO_ORIGIN
          );

          if (
            !origemPermitida ||
            endereco.origin !== origemPermitida
          ) {
            return await reply(
              'Use o nome da música, um link do YouTube ' +
              'ou de uma faixa do Apple Music.'
            );
          }

          etapa = 'áudio direto';

          const resposta = await fetch(endereco, {
            redirect: 'error',
            signal: AbortSignal.timeout(20000),
          });

          if (!resposta.ok) {
            await resposta.body?.cancel();

            return await reply(
              'O servidor de áudio retornou HTTP ' +
              resposta.status + '.'
            );
          }

          const audio = await readAudio(resposta, {
            allowGenericMp3: true,
            allowVideo: true,
          });

          etapa = 'envio';

          return await send(audio);
        }
      } else {
        if (!entrada || entrada.length > 200) {
          return await reply(
            'Use !play NOME DA MÚSICA | ARTISTA, com até 200 caracteres.'
          );
        }

        consulta = 'ytsearch1:' +
          entrada.replace(/\|/g, ' ')
            .replace(/\s+/g, ' ');
      }

      pasta = await mkdtemp(
        join(tmpdir(), 'zumy-play-')
      );

      const comuns = [
        '--ignore-config',
        '--no-playlist',
        '--js-runtimes', 'node',
        '--no-warnings',
        '--socket-timeout', '15',
        '--retries', '1',
        '--fragment-retries', '1',
      ];

      const caminhoCookies =
        env.YOUTUBE_COOKIES_FILE?.trim();

      if (caminhoCookies) {
        try {
          const info = await stat(caminhoCookies);

          if (
            !info.isFile() ||
            !info.size ||
            info.size > 1024 * 1024
          ) {
            throw new Error('Arquivo inválido');
          }

          const conteudo = (
            await readFile(caminhoCookies, 'utf8')
          ).replace(/^\uFEFF/, '');

          const cabecalho = conteudo
            .split(/\r?\n/)[0]
            .trim();

          if (
            !/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)$/.test(
              cabecalho
            )
          ) {
            throw new Error('Formato inválido');
          }

          const copia = join(pasta, 'cookies.txt');

          await writeFile(copia, conteudo, {
            mode: 0o600,
          });

          comuns.push('--cookies', copia);
        } catch {
          return await reply(
            '🔐 Confira YOUTUBE_COOKIES_FILE e o arquivo Netscape ' +
            'nos Secret Files do Render.'
          );
        }
      }

      const executar = (parametros, timeout) =>
        ffmpeg(
          'yt-dlp',
          [...comuns, ...parametros],
          {
            timeout,
            killSignal: 'SIGKILL',
            maxBuffer: 4 * 1024 * 1024,
          }
        );

      etapa = 'pesquisa';

      await reply('🔎 Buscando sua música no YouTube…');

      const { stdout } = await executar(
        [
          '--skip-download',
          '--dump-single-json',
          '--',
          consulta,
        ],
        45000
      );

      const dados = JSON.parse(stdout);

      const video = Array.isArray(dados?.entries)
        ? dados.entries.find(item => item?.id)
        : dados;

      if (!/^[A-Za-z0-9_-]{11}$/.test(video?.id || '')) {
        return await reply(
          'Não encontrei essa música. Tente informar título e artista.'
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
          '⏱️ Escolha uma gravação disponível de até 12 minutos.'
        );
      }

      const link =
        'https://www.youtube.com/watch?v=' + video.id;

      etapa = 'download';

      await executar(
        [
          '--extract-audio',
          '--audio-format', 'mp3',
          '--audio-quality', '128K',
          '--format', 'bestaudio/best',
          '--max-filesize', '24M',
          '--concurrent-fragments', '1',
          '--output', join(pasta, 'musica.%(ext)s'),
          '--',
          link,
        ],
        120000
      );

      etapa = 'verificação';

      const arquivo = join(pasta, 'musica.mp3');
      const info = await stat(arquivo);

      if (
        !info.isFile() ||
        !info.size ||
        info.size > 8 * 1024 * 1024
      ) {
        return await reply(
          'O MP3 ficou vazio ou ultrapassou 8 MB. ' +
          'Escolha uma faixa mais curta.'
        );
      }

      const audio = await readFile(arquivo);

      const titulo = String(
        video.title || 'Produção DJ TK'
      ).replace(/\s+/g, ' ').trim().slice(0, 150);

      const artista = String(
        video.artist ||
        video.creator ||
        video.uploader ||
        video.channel ||
        'Artista não informado'
      ).replace(/\s+/g, ' ').trim().slice(0, 100);

      const minutos = Math.floor(video.duration / 60);
      const segundos = Math.floor(video.duration % 60);

      const mensagem = [
        '🎶 *ZUMY • MÚSICA ENCONTRADA*',
        '',
        '🎵 *Título:* ' + titulo,
        '👤 *Artista/canal:* ' + artista,
        '⏱️ *Duração:* ' +
          minutos + ':' + String(segundos).padStart(2, '0'),
        '',
        '🔗 ' + link,
      ].join('\n');

      etapa = 'envio';

      let capaEnviada = false;

      try {
        const resposta = await fetch(
          'https://i.ytimg.com/vi/' +
          video.id +
          '/hqdefault.jpg',
          {
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          }
        );

        const tipo = resposta.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase();

        if (
          !resposta.ok ||
          !resposta.body ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(tipo)
        ) {
          await resposta.body?.cancel();
          throw new Error('Capa indisponível');
        }

        if (
          Number(resposta.headers.get('content-length')) >
          2 * 1024 * 1024
        ) {
          await resposta.body.cancel();
          throw new Error('Capa muito grande');
        }

        const partes = [];
        let total = 0;

        for await (const parte of resposta.body) {
          total += parte.byteLength;

          if (total > 2 * 1024 * 1024) {
            throw new Error('Capa muito grande');
          }

          partes.push(parte);
        }

        if (!total) throw new Error('Capa vazia');

        await send({
          image: Buffer.concat(partes, total),
          caption: mensagem,
        });

        capaEnviada = true;
      } catch {
        // A capa é opcional.
      }

      if (!capaEnviada) {
        await reply(mensagem);
      }

      const nomeArquivo = titulo
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
        .trim()
        .slice(0, 100) || 'Produção DJ TK';

      return await send({
        audio,
        mimetype: 'audio/mpeg',
        fileName: nomeArquivo + '.mp3',
        ptt: false,
      });
    } catch (error) {
      // Evita expor cookies ou outros dados de sessão.
      logger.warn(
        {
          etapa,
          name: error.name,
          code: typeof error.code === 'number'
            ? error.code
            : undefined,
          signal: error.signal,
        },
        'Falha no play YouTube'
      );

      if (etapa === 'envio') {
        return await reply(
          'O áudio foi preparado, mas o envio falhou. ' +
          'Confira a conexão do WhatsApp.'
        );
      }

      if (error.code === 'ENOENT') {
        return await reply(
          'Não encontrei o yt-dlp ou a saída MP3. ' +
          'Confira a instalação do yt-dlp e FFmpeg no servidor.'
        );
      }

      if (etapa === 'consulta ao Apple Music') {
        return await reply(
          'Não consegui consultar a Apple agora. ' +
          'Use !play NOME DA MÚSICA | ARTISTA.'
        );
      }

      if (
        error.killed ||
        error.signal === 'SIGKILL' ||
        error.name === 'TimeoutError'
      ) {
        return await reply(
          '⏳ A operação demorou demais. Tente novamente mais tarde.'
        );
      }

      return await reply(
        'Não consegui concluir o download. ' +
        'O YouTube pode ter recusado o acesso ou a sessão pode ter expirado. ' +
        'Tente outra faixa para comparar.'
      );
    } finally {
      try {
        if (pasta) {
          await rm(pasta, {
            recursive: true,
            force: true,
          });
        }
      } catch {
        logger.warn(
          'Falha ao limpar arquivos temporários do play'
        );
      }

      downloadsAtivos.delete(jid);
    }
        }
