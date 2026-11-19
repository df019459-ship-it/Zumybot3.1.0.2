import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const pasta = resolve(process.argv[2] || '.');
const files = ['server.js', 'grupos.js', 'menu.js'];
const [server, grupos, menu] = await Promise.all(files.map(file => readFile(join(pasta, file), 'utf8')));
function alter(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Estrutura diferente no trecho ' + before.slice(0, 100) + '. Nenhum arquivo foi gravado.');
  return source.replace(before, () => after);
}
if (server.includes('registraParaLimpeza') || grupos.includes('ativar: async')) throw Error('Esta atualização já foi aplicada ou há um comando !ativar. Confira a versão atual.');

let g = alter(grupos, "const ownerCommands = new Set(['reiniciar',", "const ownerCommands = new Set(['ativar', 'reiniciar',");
g = alter(g, "  'marcar', 'linkgp', 'add',", "  'limpar', 'marcar', 'linkgp', 'add',");
g = alter(g, 'folder, logger = console, downloadMedia, restart,', 'folder, logger = console, downloadMedia, restart, activate, bulkDelete,');
g = alter(g,
  "if (arg !== 'confirmar') return reply('Para reiniciar o processo, use !reiniciar confirmar.');",
  "if (!/^(?:bot\\s+)?confirmar$/i.test(arg.trim())) return reply('Para reiniciar o ZUMY, envie !reiniciar bot confirmar.');");
g = alter(g, '    p: integrations.play,', String.raw`    p: integrations.play,
    ativar: async ({ arg, reply }) => {
      if (arg && arg.toLowerCase() !== 'bot') return reply('Use !ativar bot.');
      if (typeof activate !== 'function') return reply('O servidor não disponibilizou a função de ativação.');
      activate();
      return reply('✅ ZUMY ativo. Os comandos disponíveis já podem ser usados.');
    },
    zumy: ({ arg, reply }) => {
      const now = new Date();
      const zone = env.BOT_TIMEZONE || 'America/Fortaleza';
      const parts = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
        timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(now).map(part => [part.type, part.value]));
      const hour = Number(parts.hour);
      const greeting = /^bom\s*dia$/i.test(arg) ? 'Bom dia!' :
        hour < 5 ? 'Boa madrugada!' : hour < 12 ? 'Bom dia!' : hour < 18 ? 'Boa tarde!' : 'Boa noite!';
      return reply('💖 ' + greeting + ' Sou a Zumy.\n⌚ ' + parts.hour + ':' + parts.minute +
        '\n📅 ' + parts.day + '/' + parts.month + '/' + parts.year);
    },`);
g = alter(g, '  for (const name of declared) {', String.raw`  const limparAnterior = handlers.limpar;
  handlers.limpar = async context => {
    const { arg, sock, jid, botAdmin, commandKey, quotedKey, reply } = context;
    if (arg.trim().toLowerCase() !== 'tudo confirmar') {
      if (!arg && limparAnterior) return limparAnterior(context);
      if (!arg && quotedKey) return sock.sendMessage(jid, { delete: quotedKey });
      return reply('Responda a uma mensagem com !limpar ou use !limpar tudo confirmar para solicitar a exclusão das mensagens recentes que o ZUMY registrou.');
    }
    if (botAdmin !== true) return reply('O ZUMY precisa ser administrador do grupo para fazer a limpeza.');
    if (typeof bulkDelete !== 'function') return reply('O servidor ainda não fornece o histórico recente para limpeza.');
    const result = await bulkDelete(sock, jid, commandKey?.id);
    if (result.busy) return reply('Já existe uma limpeza em andamento neste grupo.');
    if (!result.sent && !result.failed) return reply('Não há mensagens recentes registradas para limpar neste grupo.');
    return reply('🧹 Pedidos de exclusão enviados: ' + result.sent + ' · falharam: ' + result.failed + '. O WhatsApp aplica suas próprias regras de exclusão.');
  };
  for (const name of declared) {`);
let m = alter(menu, "'menu|ajuda|dono|meuid|ping|", "'menu|ajuda|dono|meuid|zumy|ping|");
m = alter(m, "'reiniciar|bloquear|desbloquear|broadcast|grupos'", "'ativar|reiniciar|bloquear|desbloquear|broadcast|grupos'");
if (!m.includes('|limpar|') && !/\|limpar'/.test(m)) m = alter(m, "'b|d|ban|kick|", "'b|d|limpar|ban|kick|");

let s = alter(server, 'const handleGroup = createGroupHandler({', String.raw`const limpeza = new Map();
const limpando = new Set();
const janelaLimpeza = 24 * 60 * 60_000;
function registraParaLimpeza(msg, now) {
  const { remoteJid, id, participant } = msg.key;
  const sentAt = Number(msg.messageTimestamp) * 1000;
  if (!id || !participant || !Number.isFinite(sentAt) || sentAt > now + 10_000 || now - sentAt > janelaLimpeza) return;
  if (msg.message.protocolMessage || msg.message.reactionMessage || msg.message.senderKeyDistributionMessage &&
      Object.keys(msg.message).length === 1) return;
  let recent = limpeza.get(remoteJid);
  if (!recent) {
    if (limpeza.size >= 150) limpeza.delete(limpeza.keys().next().value);
    recent = new Map();
    limpeza.set(remoteJid, recent);
  }
  if (recent.size >= 100) recent.delete(recent.keys().next().value);
  recent.set(id, { at: sentAt, key: msg.key });
}

async function limparRecentes(socket, jid, comando) {
  if (limpando.has(jid)) return { busy: true };
  const recent = limpeza.get(jid);
  if (!recent) return { sent: 0, failed: 0 };
  const entries = [...recent.entries()].filter(([id, item]) => id !== comando && Date.now() - item.at <= janelaLimpeza);
  let sent = 0, failed = 0;
  limpando.add(jid);
  try {
    for (const [id, item] of entries) {
      if (socket !== sock || status !== 'conectado') {
        failed += entries.length - sent - failed;
        break;
      }
      try {
        await socket.sendMessage(jid, { delete: item.key });
        recent.delete(id);
        sent++;
      } catch { failed++; }
    }
    return { sent, failed };
  } finally { limpando.delete(jid); }
}
const handleGroup = createGroupHandler({`);
s = alter(s, '  restart: () => process.exit(1),', '  restart: () => process.exit(1),\n  activate: () => { paused = false; },\n  bulkDelete: limparRecentes,');
s = alter(s, "    if (paused || current !== sock || !['notify', 'append'].includes(type)) return;",
  "    if (current !== sock || !['notify', 'append'].includes(type)) return;");
s = alter(s, '      if (paused || current !== sock) break;', '      if (current !== sock) break;');
s = alter(s, '      if (!group && !identityRequest) continue;',
  '      if (!group && !identityRequest) continue;\n      const control = group && new RegExp("^" + prefix + "ativar(?:\\\\s+bot)?$", "i").test(text);\n      if (paused && !control) continue;');
s = alter(s, "      if (isCommand) logger.info(", "      if (group && type === 'notify' && !fromMe) registraParaLimpeza(msg, now);\n      if (isCommand) logger.info(");
s = alter(s, '  const processed = new Map();', String.raw`  const connectWatchdog = setTimeout(() => {
    if (current !== sock || status !== 'conectando') return;
    logger.warn('Conexão demorou mais de 75 segundos; tentando novamente com a sessão salva');
    sock = null;
    qr = null;
    status = 'aguardando_reconexao';
    scheduleReconnect();
    try { current.end(new Error('Tempo limite para conexão')); }
    catch (error) { logger.warn({ name: error.name }, 'Falha ao fechar conexão travada'); }
  }, 75000);
  connectWatchdog.unref();
  const processed = new Map();`);
s = alter(s, '    if(current!==sock)return;\n    if(nextQr)', '    if(current!==sock)return;\n    if(nextQr || connection === "open" || connection === "close") clearTimeout(connectWatchdog);\n    if(nextQr)');
if ((s.match(/revisao:'[^']+'/g) || []).length !== 1) throw Error('Não encontrei a revisão no endpoint /health.');
s = s.replace(/revisao:'[^']+'/g, "revisao:'controle-v11'");

if (process.argv.includes('--check')) console.log('Compatível. Nenhum arquivo foi alterado.');
else {
  const replacements = [s, g, m];
  for (let i = 0; i < files.length; i++) await writeFile(join(pasta, files[i]), replacements[i]);
  console.log('Atualizados server.js, grupos.js e menu.js. Revise as alterações antes de publicar.');
}
