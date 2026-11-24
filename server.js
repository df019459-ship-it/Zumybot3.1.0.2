import {
  mkdir,
  writeFile,
  chmod,
  rename,
  rm,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executar = promisify(execFile);

async function instalar() {
  if (process.platform !== 'linux') {
    throw new Error(
      'Este instalador é para Linux.'
    );
  }

  const arquivos = {
    x64: 'yt-dlp_linux',
    arm64: 'yt-dlp_linux_aarch64',
  };

  const arquivo = arquivos[process.arch];

  if (!arquivo) {
    throw new Error(
      'Arquitetura não suportada: ' +
      process.arch
    );
  }

  const pasta = resolve(
    'node_modules',
    '.bin'
  );

  const destino = join(pasta, 'yt-dlp');
  const temporario = destino + '.download';

  await mkdir(pasta, { recursive: true });

  try {
    console.log(
      'Baixando yt-dlp oficial para ' +
      process.arch + '...'
    );

    const resposta = await fetch(
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' +
      arquivo,
      {
        signal: AbortSignal.timeout(120000),
      }
    );

    if (!resposta.ok) {
      throw new Error(
        'Download retornou HTTP ' +
        resposta.status
      );
    }

    const dados = Buffer.from(
      await resposta.arrayBuffer()
    );

    if (
      dados.length < 4 ||
      dados[0] !== 0x7f ||
      dados.toString('ascii', 1, 4) !== 'ELF'
    ) {
      throw new Error(
        'O download não retornou um executável Linux válido.'
      );
    }

    await writeFile(temporario, dados);
    await chmod(temporario, 0o755);

    const { stdout } = await executar(
      temporario,
      ['--version'],
      {
        timeout: 30000,
        maxBuffer: 65536,
      }
    );

    await rename(temporario, destino);

    console.log(
      'yt-dlp instalado: ' +
      stdout.trim()
    );
  } finally {
    await rm(temporario, {
      force: true,
    });
  }
}

instalar().catch(error => {
  console.error(
    'Falha ao instalar yt-dlp:',
    error.message
  );

  process.exitCode = 1;
});
