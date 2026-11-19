import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const pasta = resolve(process.argv[2] || '.');
const files = ['grupos.js','server.js','menu.js','config-grupo.js','integracoes.js'];
const [grupos, server, menu, config, integracoes] = await Promise.all(files.map(file => readFile(join(pasta,file),'utf8')));
function alter(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Trecho incompatível: ' + before.slice(0,80) + '. Nenhum arquivo foi gravado.');
  return source.replace(before, () => after);
}
if (grupos.includes('const agendaDiaria =')) throw Error('Agenda já instalada.');

let g = alter(grupos, "'marcar', 'linkgp', 'add',", "'programar', 'mensagem', 'antifanta', 'reacoes', 'marcar', 'linkgp', 'add',");
if (!g.includes('ids: () => Object.keys(data)')) {
  g = alter(g, '    get: jid => data[jid] || {},', '    get: jid => data[jid] || {},\n    ids: () => Object.keys(data),');
  if (g.includes('get: () => ({}), save: () => {} };')) {
    g = alter(g, 'get: () => ({}), save: () => {} };', 'get: () => ({}), save: () => {}, ids: () => [] };');
  }
}
g = alter(g, '  const config = readSettings(folder);', String.raw`  const config = readSettings(folder);
  const scheduleFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: env.BOT_TIMEZONE || 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function horaAgenda(at = new Date()) {
    const p = Object.fromEntries(scheduleFmt.formatToParts(at).map(x => [x.type, x.value]));
    return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
  }
  const agendaDiaria = {
    async tick(sock, at = new Date()) {
      const { date, time } = horaAgenda(at);
      for (const jid of config.ids()) {
        const agenda = config.get(jid).agenda || {};
        for (const action of ['fechamento', 'abertura']) {
          const entry = agenda[action];
          if (entry?.time !== time || entry.last === date) continue;
          try {
            await sock.groupSettingUpdate(jid, action === 'fechamento' ? 'announcement' : 'not_announcement');
            const current = config.get(jid);
            const saved = current.agenda?.[action];
            if (!saved || saved.time !== time) continue;
            config.save(jid, { ...current, agenda: { ...current.agenda, [action]: { ...saved, last: date } } });
            const text = saved.message || (action === 'fechamento'
              ? '🔒 O grupo foi fechado no horário programado.' : '🔓 O grupo foi aberto no horário programado.');
            await sock.sendMessage(jid, { text });
          } catch (error) {
            logger.warn({ status: error.output?.statusCode, code: error.code }, 'Falha na agenda diária do grupo');
          }
        }
      }
    },
    async programar({ arg, settings, update, reply }) {
      const input = /^\s*(abertura|fechamento)\s+(\d{2}:\d{2}|off|0)(?:\s*\|\s*([\s\S]*))?\s*$/i.exec(arg);
      const agenda = settings.agenda || {};
      if (!arg.trim()) {
        return reply('📅 Fechamento: ' + (agenda.fechamento?.time || 'desligado') + '\nAbertura: ' +
          (agenda.abertura?.time || 'desligada') + '\nUse !programar fechamento 23:00 ou !programar abertura 07:00.');
      }
      if (!input || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^(?:off|0)$/i.test(input[2]) || (input[3] || '').length > 500) {
        return reply('Exemplo: !programar fechamento 23:00 | Boa noite! Para cancelar: !programar fechamento off.');
      }
      const action = input[1].toLowerCase();
      const time = input[2].toLowerCase();
      const previous = agenda[action] || {};
      const other = action === 'abertura' ? 'fechamento' : 'abertura';
      if (time === agenda[other]?.time) return reply('Escolha horários diferentes para abrir e fechar.');
      const off = ['off', '0'].includes(time);
      update({ agenda: { ...agenda, [action]: { ...previous, time: off ? '' : time,
        message: input[3]?.trim() || previous.message, last: previous.time === time ? previous.last : undefined } } });
      return reply(off ? 'Agendamento de ' + action + ' cancelado.' :
        'Agendamento diário salvo: ' + action + ' às ' + time + '. O bot precisa estar conectado e ser admin.');
    },
    mensagem({ arg, settings, update, reply }) {
      const input = /^(abertura|fechamento)\s+([\s\S]+)$/i.exec(arg.trim());
      if (!input || input[2].length > 500) return reply('Use !mensagem abertura Bom dia, pessoal! ou !mensagem fechamento Boa noite!');
      const action = input[1].toLowerCase();
      const agenda = settings.agenda || {};
      update({ agenda: { ...agenda, [action]: { ...agenda[action], message: input[2].trim() } } });
      return reply('Mensagem de ' + action + ' salva.');
    },
  };`);
g = alter(g, '    p: integrations.play,', String.raw`    p: integrations.play,
    programar: agendaDiaria.programar,
    mensagem: agendaDiaria.mensagem,
    antifanta: ({ arg, settings, update, reply }) => {
      if (!['0','1'].includes(arg)) return reply('Antifanta: ' + (settings.antifanta === false ? '0' : '1') + '. Use !antifanta 1 ou !antifanta 0.');
      update({ antifanta: arg === '1' });
      return reply(arg === '1'
        ? 'Lembretes de inatividade permitidos. Ative !sync para registrar atividade.'
        : 'Lembretes de inatividade desativados.');
    },
    reacoes: async ({ arg, settings, update, sock, jid, quotedKey, reply }) => {
      if (arg === '1' || arg === '0') {
        update({ reactCommands: arg === '1' });
        return reply(arg === '1' ? 'Reações aos comandos ativadas.' : 'Reações aos comandos desativadas.');
      }
      if (quotedKey && /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u.test(arg)) {
        return sock.sendMessage(jid, { react: { text: arg, key: quotedKey } });
      }
      return reply('Reações automáticas: ' + (settings.reactCommands ? '1' : '0') +
        '. Use !reações 1 ou !reações 0. Para reagir, responda a uma mensagem com !reações 👍.');
    },`);
if (g.includes("listanranca: 'listabranca',")) {
  g = alter(g, "listanranca: 'listabranca',", "listanranca: 'listabranca', atifanta: 'antifanta',");
} else {
  if (!/    const command = match \? normalizeCommand\(match\[1\]\) : '';/m.test(g)) throw Error('Roteamento incompatível.');
  g = g.replace("    const command = match ? normalizeCommand(match[1]) : '';",
    "    const rawCommand = match ? normalizeCommand(match[1]) : '';\n    const command = rawCommand === 'atifanta' ? 'antifanta' : rawCommand;");
}
g = alter(g, '    const menuInfo =', "    if (settings.reactCommands && command && declared.has(command) && command !== 'reacoes' && msg.key.id) {\n      void sock.sendMessage(jid, { react: { text: '👀', key: msg.key } }).catch(() => {});\n    }\n    const menuInfo =");
g = alter(g, '  return handleGroup;', '  handleGroup.runAgenda = agendaDiaria.tick;\n  return handleGroup;');

let c = config;
if (c.includes('const waiting = Object.entries(activity).filter')) {
  c = alter(c, 'const waiting = Object.entries(activity).filter', 'const waiting = settings.antifanta === false ? [] : Object.entries(activity).filter');
} else {
  throw Error('O arquivo de configuração ainda não tem a rotina de inatividade da v10. Nenhum arquivo foi alterado.');
}

let i = integracoes;
i = alter(i, "toImage = false, color = '151827' })", "toImage = false, color = '151827', decoration = '' })");
i = alter(i, "      args.push('-vf', filter);", "      args.push('-vf', decoration ? decoration + ',' + filter : filter);");
i = alter(i, "    return convert({ text: 'ZUMY · RANKING", String.raw`    const accent = palette[(hash + 3) % palette.length];
    const bars = 2 + (hash % 6);
    const decoration = [
      'drawbox=x=16:y=16:w=480:h=480:color=0x' + accent + ':t=6',
      ...Array.from({ length: bars }, (_, n) =>
        'drawbox=x=' + (42 + n * 49) + ':y=' + (72 + ((hash >>> (n + 1)) % 18)) +
        ':w=35:h=5:color=white@0.5:t=fill'),
      'drawbox=x=42:y=420:w=' + Math.max(8, Math.round(428 * score / 100)) + ':h=12:color=white@0.7:t=fill',
    ].join(',');
    return convert({ text: 'ZUMY · RANKING`);
i = alter(i, 'toImage: true, color: palette[hash % palette.length] });', 'toImage: true, color: palette[hash % palette.length], decoration });');

let m = alter(menu, "'configurar|sync|", "'configurar|sync|programar|mensagem|antifanta|reacoes|");
let s = server;
const anchor = 'void startConnection();';
const position = s.lastIndexOf(anchor);
if (position < 0) throw Error('Não encontrei a inicialização do servidor.');
s = s.slice(0,position) + String.raw`let agendaRunning = false;
const agendaTimer = setInterval(async () => {
  if (agendaRunning || paused || status !== 'conectado' || !sock) return;
  agendaRunning = true;
  try { await handleGroup.runAgenda(sock); }
  catch (error) { logger.warn({ name: error.name }, 'Falha ao verificar a agenda dos grupos'); }
  finally { agendaRunning = false; }
}, 20000);
agendaTimer.unref();
` + s.slice(position);
if ((s.match(/revisao:'[^']+'/g) || []).length !== 1) throw Error('Revisão não encontrada.');
s = s.replace(/revisao:'[^']+'/g, "revisao:'agenda-v12'");
if (process.argv.includes('--check')) console.log('Compatível. Nenhum arquivo alterado.');
else {
  for (const [index, contents] of [g,s,m,c,i].entries()) await writeFile(join(pasta,files[index]),contents);
  console.log('Agenda, reações, antifanta e imagens aplicados.');
}
