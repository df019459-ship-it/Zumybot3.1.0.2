import { randomInt } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { botName, categoryCommands, menu as menuOriginal, normalizeCommand, ownerName, ownerNumber, prefix, sections } from './menu.js';
import { createGames } from './jogos.js';
import { createIntegrations } from './integracoes.js';
import { chamouZumy, criarVoz, estilosVoz } from './voz.js';
const menu = (...args) => menuOriginal(...args);
import { createGroupSettings, extraAdmin, createCommunity, communityAdmin } from './config-grupo.js';

const pick = values => values[randomInt(values.length)];
const shuffle = values => {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const normalizeJid = id => String(id || '').replace(/:\d+(?=@)/, '').replace(/@c\.us$/, '@s.whatsapp.net');
const userJid = number => number + '@s.whatsapp.net';
const groupJid = id => typeof id === 'string' && id.endsWith('@g.us');
const identity = member => [member?.id, member?.phoneNumber, member?.lid].filter(Boolean).map(normalizeJid);
export function identidadePrivada(ids) {
  const identificadores = ids.filter(Boolean).map(normalizeJid);
  const telefone = identificadores.find(id => /^\d{10,15}@s\.whatsapp\.net$/.test(id));
  const lid = identificadores.find(id => /^\d+@lid$/.test(id));
  const linhas = ['🔑 Sua identidade no ZUMY'];
  if (telefone) linhas.push('OWNER_NUMBER=' + telefone.split('@')[0]);
  if (lid) linhas.push('OWNER_LID=' + lid);
  if (!telefone && !lid) linhas.push('Nenhum identificador confirmado neste evento.');
  linhas.push('Se você é o responsável pelo bot, use os valores disponíveis no Render. Mantenha esta mensagem no privado.');
  return linhas.join('\n');
}

const chatText = message => message?.conversation || message?.extendedTextMessage?.text ||
  message?.imageMessage?.caption || message?.videoMessage?.caption || message?.documentMessage?.caption || '';

function contentOf(message) {
  while (message?.ephemeralMessage?.message || message?.documentWithCaptionMessage?.message) {
    message = message.ephemeralMessage?.message || message.documentWithCaptionMessage.message;
  }
  return message || {};
}

function readSettings(folder) {
  if (!folder) return { get: () => ({}), save: () => {}, ids: () => [] };
  const path = join(folder, 'zumy-grupos.json');
  let data = {};
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    get: jid => data[jid] || {},
    ids: () => Object.keys(data),
    save(jid, settings) {
      const next = { ...data, [jid]: settings };
      writeFileSync(path + '.tmp', JSON.stringify(next), { mode: 0o600 });
      renameSync(path + '.tmp', path);
      data = next;
    },
  };
}

const flags = {
  antilink: 'Links de convite do WhatsApp de participantes comuns são apagados.',
  antispam: 'Apaga repetições idênticas a partir da quarta mensagem em 10 segundos.',
  antivizu: 'Apaga mídias de visualização única de participantes comuns sem abrir o conteúdo.',
  antigaviao: 'Avisa quando um participante menciona mais de três pessoas na mesma mensagem.',
  detectargado: 'Responde a frases românticas com uma brincadeira.',
  zoeira: 'Permite os comandos de zoeira no grupo.',
};

const ownerCommands = new Set(['ativar', 'reiniciar', 'bloquear', 'desbloquear', 'broadcast', 'grupos']);
const adminCommands = new Set([
  'b', 'ban', 'kick', 'd', 'promover', 'rebaixar', 'grupo', 'abrirgp', 'fechargp',
  'limpar', 'programar', 'mensagem', 'antifanta', 'reacoes', 'marcar', 'linkgp', 'add', 'configurar', 'vozzumy', ...Object.keys(flags), ...extraAdmin, ...communityAdmin,
]);
const basic = {
  menu: ({ arg, reply }) => reply(menu(arg)),
  ajuda: ({ reply }) => reply('Use !menu para ver os atalhos. Exemplos: !jogos, !musicas e !administracao.\n!menu completo lista tudo.\nResponda a uma mensagem ou marque alguém quando o comando pedir.'),
  dono: ({ reply, ownerLabel }) => reply('👑 Responsável pelo ZUMY: ' + ownerLabel + '\nPara ver os administradores deste grupo, use !admins.'),
  ping: ({ reply }) => reply('🏓 Pong! ZUMY online.'),
  hora: ({ reply }) => reply('🕐 ' + new Intl.DateTimeFormat('pt-BR', {
    timeZone: process.env.BOT_TIMEZONE || 'America/Fortaleza', hour: '2-digit', minute: '2-digit',
  }).format(new Date())),
  status: ({ reply }) => reply('✅ ZUMY conectada e respondendo neste grupo.'),
  infobot: ({ reply }) => reply('🤖 ' + botName + ' · Bot para grupos · Prefixo ' + prefix),
};

const rankings = sections[3].commands;
const relationships = {
  ship: 'Combinação do casal',
  casal: 'Casal sorteado',
  compatibilidade: 'Compatibilidade',
  apaixonado: 'Índice de paixão',
  crush: 'Índice de crush',
  casamento: 'Casamento de brincadeira',
  divorcio: 'Divórcio de brincadeira',
  beijo: 'Beijo virtual',
  namorar: 'Pedido de namoro de brincadeira',
  quemmeama: 'Admirador secreto sorteado',
  quemmetraiu: 'Suspeito fictício sorteado',
};
const jokes = {
  queme: ['Quem é a pessoa mais pontual do grupo?', 'Quem é mais provável de esquecer o próprio aniversário?'],
  eununca: ['Eu nunca ri numa hora errada.', 'Eu nunca mandei mensagem no grupo errado.'],
  confissao: ['Confissão fictícia: sumi do grupo para terminar a série.', 'Confissão fictícia: ensaiei a resposta e esqueci de mandar.'],
  segredo: ['Segredo fictício: a pipoca acabou antes do filme.', 'Segredo fictício: o café é o verdadeiro administrador.'],
  azar: ['Seu azar do dia: o carregador ficou em outro cômodo.', 'Seu azar do dia: o áudio de cinco minutos chegou na hora de dormir.'],
  sorte: ['Sua sorte de hoje: alguém vai te oferecer a última fatia.', 'Sua sorte de hoje: a fila vai andar quando você chegar.'],
  previsao: ['Previsão: vai aparecer uma figurinha para esse momento.', 'Previsão: alguém ainda vai perguntar qual era o assunto.'],
  horoscopo: ['Horóscopo de brincadeira: mercúrio pede menos áudios e mais café.', 'Horóscopo de brincadeira: hoje é dia de responder o grupo.'],
  quemseria: ['Quem seria o primeiro a rir numa reunião séria?', 'Quem seria o guia ideal numa cidade desconhecida?'],
};
const comparisons = { testedeamor: 'Amor', testedebeleza: 'Beleza', testedeloucura: 'Loucura' };

function describeParticipantResult(result, reply) {
  const status = Number(result?.[0]?.status);
  if (status === 200) return reply('Ação concluída.');
  if (status === 403) return reply('O WhatsApp recusou a ação. Para !add, a privacidade da pessoa pode exigir convite.');
  if (status === 409) return reply('O participante já está no grupo.');
  return reply('O WhatsApp não confirmou a ação' + (status ? ' (' + status + ')' : '') + '.');
}


function groupActions() {
  const participantAction = action => async ({ sock, jid, target, targetMember, settings, update, reply }) => {
    if (!target) return reply('Marque alguém ou responda à mensagem da pessoa.');
    const result = await sock.groupParticipantsUpdate(jid, [target], action);
    if (action !== 'remove' || Number(result?.[0]?.status) !== 200) return describeParticipantResult(result, reply);
    update({ banHistory: [...(settings.banHistory || []).slice(-49), { id: target, at: Date.now() }] });
    const legenda = (settings.bemvindo2 ? settings.goodbyeText2 || settings.goodbyeText
      : settings.goodbyeText || settings.goodbyeText2) || '{usuario} foi removido do grupo.';
    const nome = targetMember?.name || targetMember?.notify || 'O participante';
    return reply('🚫 Participante removido.\n' + legenda.replaceAll('{usuario}', nome));
  };
  const setGroup = mode => async ({ sock, jid, arg, reply }) => {
    const input = arg.toLowerCase();
    const selection = mode || ({ abrir: 'a', fechar: 'f' })[input] || input;
    if (!['a', 'f'].includes(selection)) return reply('Use !grupo a ou !grupo f.');
    try {
      await sock.groupSettingUpdate(jid, selection === 'a' ? 'not_announcement' : 'announcement');
    } catch (error) {
      const status = error?.output?.statusCode ?? error?.data?.code;
      if (Number(status) === 403) {
        return reply('O WhatsApp negou a mudança. Confira se o número conectado ao ZUMY está como admin neste grupo.');
      }
      throw error;
    }
    return reply(selection === 'a' ? 'Grupo aberto.' : 'Grupo fechado.');
  };
  return {
    b: participantAction('remove'),
    ban: participantAction('remove'),
    kick: participantAction('remove'),
    promover: participantAction('promote'),
    rebaixar: participantAction('demote'),
    d: async ({ sock, jid, quotedKey, reply }) => {
      if (!quotedKey) return reply('Responda à mensagem que quer apagar com !d.');
      await sock.sendMessage(jid, { delete: quotedKey });
    },
    grupo: setGroup(),
    abrirgp: setGroup('a'),
    fechargp: setGroup('f'),
    marcar: ({ arg, members, themeMark }) => themeMark('marcar', members, arg || 'Atenção, pessoal!'),
    linkgp: async ({ sock, jid, meta, reply, send }) => {
      let codigo;
      try {
        codigo = await sock.groupInviteCode(jid);
      } catch {
        return reply('Não consegui consultar o convite. Confira se o ZUMY é administrador do grupo.');
      }
      if (!codigo) return reply('O convite deste grupo está indisponível.');

      const nome = meta?.subject || 'Grupo do WhatsApp';
      const descricao = meta?.desc?.trim() || 'Grupo sem descrição cadastrada.';
      const convite = 'https://chat.whatsapp.com/' + codigo;
      const cabecalho = '👥 *' + nome + '*\n🔗 ' + convite;
      const texto = cabecalho + '\n\n📝 ' + descricao;
      let foto;
      try {
        foto = await sock.profilePictureUrl(jid, 'image', 5000);
      } catch {
        // A configuração de privacidade pode ocultar a foto do grupo.
      }
      if (!foto) return reply(texto);
      if (texto.length <= 900) {
        try {
          return await send({ image: { url: foto }, caption: texto });
        } catch {
          return reply(texto);
        }
      }
      try {
        await send({ image: { url: foto }, caption: cabecalho });
      } catch {
        return reply(texto);
      }
      return reply('📝 ' + descricao);
    },
    add: async ({ sock, jid, arg, target, reply }) => {
      const number = arg.replace(/^\+/, '');
      const id = /^\d{10,15}$/.test(number) ? userJid(number) : target;
      if (!id) return reply('Use !add 55DDDNUMERO, marque ou responda à pessoa.');
      return describeParticipantResult(await sock.groupParticipantsUpdate(jid, [id], 'add'), reply);
    },
  };
}

function ownerActions(restart) {
  const block = action => async ({ arg, targetPhone, sock, reply, ownerJid }) => {
    const number = arg.replace(/^\+/, '');
    const target = /^\d{10,15}$/.test(number) ? userJid(number) : targetPhone;
    if (!target || target === ownerJid || target === normalizeJid(sock.user?.id)) {
      return reply('Informe o telefone completo de outra pessoa com código do país.');
    }
    await sock.updateBlockStatus(target, action);
    return reply(action === 'block' ? 'Contato bloqueado.' : 'Contato desbloqueado.');
  };
  return {
    reiniciar: async ({ arg, reply }) => {
      if (!/^(?:bot\s+)?confirmar$/i.test(arg.trim())) return reply('Para reiniciar o ZUMY, envie !reiniciar bot confirmar.');
      if (typeof restart !== 'function') return reply('O servidor ainda não forneceu a função de reinício ao bot.');
      await reply('Reiniciando o ZUMY…');
      return restart();
    },
    bloquear: block('block'),
    desbloquear: block('unblock'),
    grupos: async ({ sock, reply }) => {
      const groups = Object.values(await sock.groupFetchAllParticipating());
      if (!groups.length) return reply('O ZUMY não participa de grupos.');
      const list = groups.slice(0, 50).map((group, i) => (i + 1) + '. ' + group.subject);
      return reply('Grupos: ' + groups.length + '\n' + list.join('\n') +
        (groups.length > list.length ? '\nMostrando os primeiros 50.' : ''));
    },
    broadcast: async ({ arg, sock, reply }) => {
      if (!arg.startsWith('confirmar ') || arg.length > 1010) {
        return reply('Use !broadcast confirmar SUA MENSAGEM para enviar um aviso de até 1.000 caracteres a todos os grupos.');
      }
      const groups = Object.keys(await sock.groupFetchAllParticipating()).filter(groupJid);
      let sent = 0;
      for (const jid of groups) {
        try {
          await sock.sendMessage(jid, { text: '📢 Aviso do dono\n' + arg.slice('confirmar '.length) });
          sent++;
        } catch {
          // Continua com os grupos restantes quando uma entrega falha.
        }
      }
      return reply('Aviso enviado a ' + sent + ' de ' + groups.length + ' grupos.');
    },
  };
}

function parseZoom(phrase = '') {
  const text = phrase.trim().replace(/[?!]+$/, '');
  const normalized = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const commands = {
    'abre o grupo': 'abrirgp', 'fecha o grupo': 'fechargp',
    'remova esse': 'ban', 'marca todo mundo': 'marcar',
    'forme um casal': 'casal', 'que horas sao': 'hora',
    'quantos membros tem aqui': 'membros',
  };
  if (Object.hasOwn(commands, normalized)) return commands[normalized];
  if (/^baixe musica\s+/i.test(normalized)) return 'play ' + text.split(/\s+/).slice(2).join(' ');
  if (/^enquete:/i.test(normalized)) {
    const options = text.slice(text.indexOf(':') + 1).trim().split(/\s+ou\s+/i);
    return 'enquete Escolha uma opção | ' + options.join(' | ');
  }
  if (categoryCommands.includes(normalizeCommand(text))) return normalizeCommand(text);
  return 'menu';
}

export function createGroupHandler({ folder, logger = console, downloadMedia, restart, activate, bulkDelete, env = process.env, generateVoice, getOwner } = {}) {
  const defaultOwner = {
    number: String(env.OWNER_NUMBER || ownerNumber).replace(/\D/g, ''),
    name: env.OWNER_NAME || ownerName,
    lid: env.OWNER_LID || '',
  };
  if (!/^\d{10,15}$/.test(defaultOwner.number)) throw new Error('OWNER_NUMBER deve conter DDI, DDD e número.');
  const config = readSettings(folder);
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
  };
  const recent = new Map();
  let broadcasting = false;
  const lastCommand = new Map();
  const games = createGames();
  const integrations = createIntegrations({ downloadMedia, logger, env });
  // Voz Gemini, com fallback em texto.
  const responderVoz = criarVoz({ env, logger, gerar: generateVoice, perguntar: arg => integrations.ia({ arg, reply: texto => texto }) });


  const declared = new Set(sections.flatMap(section => section.commands
    .filter(command => !command.startsWith('zoom ')).map(command => command.split(' ')[0])));
  declared.add('vozzumy');
  declared.add('testarvoz');
  const groupSettings = createGroupSettings({ config, integrations, known: declared, logger });
  const community = createCommunity({ config, integrations, env, logger, downloadMedia, responderVoz });
  let nextSweep = 0;

  const security = Object.fromEntries(Object.entries(flags).map(([name, description]) => [
    name,
    ({ arg, jid, reply, settings }) => {
      const action = arg.toLowerCase();
      if (action === 'status') return reply('!' + name + ': ' + (settings[name] ? 'on' : 'off') + '\n' + description);
      if (!['on', 'off'].includes(action)) return reply('Use ' + prefix + name + ' on, off ou status.\n' + description);
      config.save(jid, { ...settings, [name]: action === 'on' });
      return reply('!' + name + ' ' + action + '\n' + description);
    },
  ]));

  const rank = Object.fromEntries(rankings.map(name => [name, context => community.rank(context, name)]));
  const relation = Object.fromEntries(Object.entries(relationships).map(([name, label]) => [
    name,
    ({ target, actor, members, mention, reply }) => {
      const candidates = members.filter(id => id !== actor);
      const selected = target || (candidates.length ? pick(candidates) : '');
      if (!selected) return reply('Marque alguém para a brincadeira.');
      const score = ['ship', 'compatibilidade', 'apaixonado', 'crush'].includes(name) ? randomInt(101) + '% · ' : '';
      return mention('❤️ ' + label + ' · ' + score + 'brincadeira\n', [actor, selected].filter(Boolean));
    },
  ]));
  const jokeActions = {
    ...Object.fromEntries(Object.entries(jokes).map(([name, lines]) => [name, ({ reply }) => reply('😂 ' + pick(lines))])),
    ...Object.fromEntries(Object.entries(comparisons).map(([name, label]) => [name,
      ({ reply }) => reply('😂 ' + label + ': ' + randomInt(101) + '% · resultado aleatório.')])),
    duelo: ({ actor, target, members, mention, reply }) => {
      const candidates = members.filter(id => id !== actor);
      const rival = target || (candidates.length ? pick(candidates) : '');
      return actor && rival ? mention('⚔️ Vencedor do duelo: ', [pick([actor, rival])]) : reply('Marque um rival para o duelo.');
    },
    batalha: ({ members, mention, reply }) => members.length > 1
      ? mention('🏆 Finalistas da batalha (em ordem de chegada):\n', shuffle(members).slice(0, 3), true)
      : reply('Preciso de pelo menos dois participantes.'),
  };
  const handlers = {
    ...basic,
    regras: ({ meta, reply }) => reply(meta.desc || 'Este grupo não tem regras na descrição.'),
    ...groupActions(), ...security, ...rank, ...relation, ...games, ...jokeActions, ...integrations,
    ...ownerActions(restart),
    configurar: ({ reply, settings, ownerLabel }) => reply(menu('configuracao', { nickname: settings.nickname, ownerLabel })),
    vozzumy: ({ arg, settings, update, reply }) => {
      const estilo = arg.toLowerCase();
      if (['0', 'off'].includes(estilo)) {
        update({ voiceEnabled: false });
        return reply('Voz desativada neste grupo.');
      }
      if (!Object.hasOwn(estilosVoz, estilo)) return reply('Use !vozzumy anime, doce, calma ou brava. Para desligar: !vozzumy 0.');
      update({ voiceStyle: estilo, voiceEnabled: true });
      return reply('Voz feminina configurada: ' + estilo + '. Teste com !testarvoz.');
    },
    testarvoz: context => responderVoz.testar(context.voz),
    meuid: async ({ sock, senderIds, actor, reply }) => {
      if (!actor || !/^\d+(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)$/.test(actor)) {
        return reply('Envie !meuid no privado do ZUMY para conferir sua identidade.');
      }
      try {
        await sock.sendMessage(actor, { text: identidadePrivada(senderIds) });
        return reply('Enviei sua identidade no privado.');
      } catch {
        return reply('Abra uma conversa privada com o ZUMY e envie !meuid para conferir sua identidade.');
      }
    },
    ...groupSettings.commands,
    ...community.commands,
    p: integrations.play,
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
    },
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
    },
  };
  const limparAnterior = handlers.limpar;
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
  for (const name of declared) {
    if (!Object.hasOwn(handlers, name)) throw new Error('Comando sem implementação: /' + name);
  }

  async function moderate({ sock, msg, jid, actor, text, content, settings, isAdmin, botAdmin, mentions, reply, update }) {
    if (isAdmin || msg.key.fromMe) return false;
    let reason = groupSettings.mediaReason(settings, content, text);
    if (settings.antilink && /\bchat\.whatsapp\.com\/[\w-]+/i.test(text)) reason = 'link de convite';
    if (settings.antivizu && (content.viewOnceMessage || content.viewOnceMessageV2 || content.viewOnceMessageV2Extension ||
      content.imageMessage?.viewOnce || content.videoMessage?.viewOnce || content.audioMessage?.viewOnce)) reason = 'mídia de visualização única';
    if (actor && settings.antispam && text && !text.startsWith(prefix)) {
      const now = Date.now();
      if (now >= nextSweep) {
        for (const [key, item] of recent) if (now - item.started >= 10000) recent.delete(key);
        nextSweep = now + 10000;
      }
      const key = jid + ':' + actor;
      const previous = recent.get(key);
      const normalized = text.slice(0, 400).toLowerCase();
      const item = previous?.text === normalized && now - previous.started < 10000
        ? previous : { text: normalized, started: now, count: 0 };
      item.count++;
      recent.set(key, item);
      if (item.count >= 4) reason = 'spam repetido';
    }
    if (reason && botAdmin !== false) {
      try {
        await sock.sendMessage(jid, { delete: msg.key });
      } catch (error) {
        if (Number(error?.output?.statusCode ?? error?.data?.code) === 403) return false;
        throw error;
      }
      if (settings.advertenciaauto && actor) {
        await groupSettings.warn({
          settings: config.get(jid), target: actor, sock, jid,
          update,
          reply: text => sock.sendMessage(jid, { text }),
        }, reason);
      } else {
        await sock.sendMessage(jid, { text: '🛡️ Mensagem apagada: ' + reason + '.' });
      }
      return true;
    }
    if (settings.antigaviao && new Set(mentions).size > 3) await reply('🛡️ Evite marcar muita gente sem necessidade.');
    else if (settings.detectargado && /\b(te amo|meu amor|linda demais)\b/i.test(text)) {
      await reply('💘 Radar do romance: alguém está inspirado hoje!');
    }
    return false;
  }

  const outgoing = new Map();
  const pendingReplies = new Set();

  async function handleGroup(sock, msg) {
    const jid = msg.key?.remoteJid;
    if (!groupJid(jid) || !msg.message) return;
    const content = contentOf(msg.message);
    const text = chatText(content).trim();
    const settings = config.get(jid);
    const owner = getOwner?.() || defaultOwner;
    const ownerJid = userJid(owner.number);
    const ownerLabel = String(owner.name || ownerName).replace(/[\r\n*]/g, ' ').trim().slice(0, 60) || ownerName;
    const ownerLid = /^\d+@lid$/.test(owner.lid || '') ? owner.lid : undefined;
    const zoom = /^zoom(?:[\s,:]+([\s\S]+))?$/i.exec(text);
    let request = zoom ? parseZoom(zoom[1]) : text.startsWith(prefix) ? text.slice(prefix.length).trim() : '';
    request = request
      .replace(/^previs[aã]o do tempo(?=\s|$)/i, 'previsaodotempo')
      .replace(/^data e hora(?=\s|$)/i, 'dataehora')
      .replace(/^rank mentiroso(?=\s|$)/i, 'rankmentiroso')
      .replace(/^(atividades|inativos)[✅❌]/i, '$1')
      .replace(/^(ban|banfake|tirardalista|tirardalistar|listanegra|listanegram|liberarcastigo|tliberarcastogo)(?=@)/i, '$1 ')
      .replace(/^(autorepro|aurorepro|autorepo|antiporno)([01])(?=\s|$)/i, '$1 $2');
    const match = /^([^\s]+)(?:\s+([\s\S]*))?$/u.exec(request);
    const usaPrefixo = text.startsWith(prefix);
    const chamadaVoz = !usaPrefixo && !zoom && chamouZumy(text);
    const rawCommand = match ? normalizeCommand(match[1]) : '';
    const aliases = {
      tliberarcastogo: 'liberarcastigo', liberarcastogo: 'liberarcastigo', listanegram: 'listanegra',
      listanranca: 'listabranca', atifanta: 'antifanta', tirardalistar: 'tirardalista', aurorepro: 'autorepro',
      autorepo: 'autorepro', autodowload: 'autodownload', rankdodia: 'rankdia',
    };
    const command = Object.hasOwn(aliases, rawCommand) ? aliases[rawCommand] : rawCommand;
    const arg = match?.[2]?.trim() || '';
    if (msg.key.fromMe && (outgoing.has(jid + ':' + msg.key.id) || pendingReplies.has(jid + ':' + text))) return;
    const update = changes => config.save(jid, { ...config.get(jid), ...changes });
    let narrou = false;
    const voz = {
      jid, text, settings, update,
      send: (message, options) => send(message, { ...options, narrar: false }),
      reply: texto => send({ text: texto }, { narrar: false }),
    };
    const send = async (message, { citar = true, narrar = true } = {}) => {
      const outgoingText = message.text?.trim();
      const marker = outgoingText && jid + ':' + outgoingText;
      if (marker) pendingReplies.add(marker);
      try {
        const sent = await sock.sendMessage(jid, message, citar ? { quoted: msg } : undefined);
        if (sent?.key?.id) {
          if (outgoing.size >= 512) outgoing.delete(outgoing.keys().next().value);
          outgoing.set(jid + ':' + sent.key.id, true);
        }
        if (narrar && !narrou && settings.voiceEnabled !== false && env.BOT_VOICE_AUTO !== '0' &&
            !['testarvoz', 'vozzumy', 'play', 'p', 'totag', 'marcar', 'hidetag', 'broadcast'].includes(command)) {
          const texto = message.text || message.caption;
          if (typeof texto === 'string' && texto.trim()) {
            narrou = true;
            const limpo = texto.replace(/https?:\/\/\S+/g, 'link na mensagem').replace(/@\d+/g, 'participante')
              .replace(/[^\p{L}\p{N}\p{P}\p{Z}\r\n]/gu, '').trim();
            const fala = limpo.length > 420 || texto.includes('┎┅')
              ? 'A resposta completa está na mensagem do grupo.' : limpo;
            void responderVoz.narrar({ ...voz, settings: config.get(jid) }, fala).catch(() => {});
          }
        }
        return sent;
      } finally {
        if (marker) pendingReplies.delete(marker);
      }
    };
    const reply = (text, options) => send({ text }, options);
    if (settings.reactCommands && command && declared.has(command) && command !== 'reacoes' && msg.key.id) {
      void sock.sendMessage(jid, { react: { text: '👀', key: msg.key } }).catch(() => {});
    }
    const menuInfo = { nickname: settings.nickname, user: msg.pushName, ownerLabel };
    if (msg.key.fromMe && !usaPrefixo && !zoom && !chamadaVoz) return;
    const hasAccessRules = settings.soadm || settings.blockedCommands?.length || settings.cooldown;
    if (!hasAccessRules && !settings.communitySync && !settings.antiporno && !Object.keys(settings.castigos || {}).length) {
      if (command === 'menu') return reply(menu(arg, menuInfo));
      if (categoryCommands.includes(command)) return reply(menu(command, menuInfo));
      if (Object.hasOwn(basic, command)) return basic[command]({ arg, reply, ownerLabel });
    }
    const activeSecurity = Object.keys(settings).some(name => name !== 'zoeira' && settings[name] &&
      (Object.hasOwn(flags, name) || name.startsWith('anti') || name === 'maxChars'));
    const automatic = settings.communitySync || settings.autosticker || settings.autodownload || Object.keys(settings.castigos || {}).length || (settings.atodos && /^@all(?:\s|$)/i.test(text));
    const knownCommand = declared.has(command) || categoryCommands.includes(command) || command === 'membros' || Object.hasOwn(basic, command);
    if (!activeSecurity && !automatic && !knownCommand && !usaPrefixo && !chamadaVoz) return;
    const ctx = (content.extendedTextMessage || content.imageMessage || content.videoMessage || content.documentMessage)?.contextInfo;
    const mentions = ctx?.mentionedJid || [];
    const botIds = [sock.user?.id, sock.user?.lid, sock.user?.phoneNumber,
      sock.authState?.creds?.me?.id, sock.authState?.creds?.me?.lid].filter(Boolean).map(normalizeJid);
    const ids = msg.key.fromMe ? botIds : [msg.key.participant, msg.key.participantAlt].filter(Boolean).map(normalizeJid);
    const meta = await sock.groupMetadata(jid);
    const participants = meta.participants || [];
    const mapper = sock.signalRepository?.lidMapping;
    async function aliasesFor(identifiers) {
      const aliases = new Set(identifiers);
      if (!mapper) return [...aliases];
      for (const id of identifiers) {
        const resolve = id.endsWith('@lid') ? mapper.getPNForLID : mapper.getLIDForPN;
        if (typeof resolve !== 'function') continue;
        try {
          const alias = normalizeJid(await resolve.call(mapper, id));
          if (alias) aliases.add(alias);
        } catch {
          // Sem vínculo confirmado, a identidade original é a única válida.
        }
      }
      return [...aliases];
    }
    const findMember = identifiers => participants.find(member => identity(member).some(id => identifiers.includes(id)));
    const sender = findMember(ids) || findMember(await aliasesFor(ids));
    const actor = sender?.id || ids[0];
    let senderIds = [...new Set([...ids, ...identity(sender)])];
    if (command === 'meuid' || (ownerCommands.has(command) && !senderIds.includes(ownerJid))) {
      senderIds = await aliasesFor(senderIds);
    }
    const isOwner = senderIds.includes(ownerJid) || Boolean(ownerLid && senderIds.includes(ownerLid));
    const isGroupOwner = [meta.owner, meta.ownerPn].some(id => id && senderIds.includes(normalizeJid(id)));
    const isAdmin = isOwner || isGroupOwner || ['admin', 'superadmin'].includes(sender?.admin) ||
      sender?.isAdmin === true || sender?.isSuperAdmin === true;
    const bot = msg.key.fromMe ? sender : findMember(botIds) || findMember(await aliasesFor(botIds));
    const botAdmin = bot ? ['admin', 'superadmin'].includes(bot.admin) ||
      bot.isAdmin === true || bot.isSuperAdmin === true : undefined;
    if ((settings.antiporno || settings.castigos?.[actor]) &&
        await community.restricted({ sock, msg, jid, actor, content, text, isAdmin, botAdmin, settings })) return;
    if (activeSecurity && await moderate({ sock, msg, jid, actor, text, content, settings, isAdmin, botAdmin, mentions, reply, update })) return;
    const timestamp = Number(msg.messageTimestamp);
    if (settings.communitySync && !msg.key.fromMe && actor && (!timestamp || Date.now() - timestamp * 1000 < 120000) &&
        (text || content.imageMessage || content.videoMessage || content.audioMessage || content.stickerMessage || content.documentMessage)) {
      community.observe(jid, actor, msg.pushName);
    }
    const members = participants.filter(member => member !== bot && member.id).map(member => member.id);
    if (!command && settings.atodos && isAdmin && /^@all(?:\s|$)/i.test(text)) {
      return community.themeMark(jid, 'all', members, text.slice(4).trim() || 'Atenção, pessoal!', send);
    }
    if (chamadaVoz && settings.autorepro !== false) {
      if (settings.soadm && !isAdmin) return;
      return responderVoz.conversar(voz);
    }
    if (!command && !msg.key.fromMe && settings.autodownload && /^https:\/\/\S+$/i.test(text)) {
      const url = URL.canParse(text) ? new URL(text) : null;
      if (url && ((url.origin === 'https://archive.org' && url.pathname.startsWith('/details/')) ||
          (/\.(?:mp3|m4a|mp4)$/i.test(url.pathname) && env.MUSIC_AUDIO_ORIGIN &&
            url.origin === env.MUSIC_AUDIO_ORIGIN.replace(/\/$/, '')))) {
        return integrations.play({ arg: text, reply, send, jid });
      }
    }
    if (usaPrefixo && !knownCommand) {
      const exemplos = {
        configurar: '!configurar', play: '!play lista', fig: '!fig (responda a uma foto)',
        ia: '!ia Diga olá ao grupo', totag: '!totag Atenção, pessoal!', ban: '!ban @participante',
        msgtemp: '!msgtemp 24h', castigo: '!castigo 24h @participante', rankativos: '!rankativos', perfil: '!perfil 2', reiniciar: '!reiniciar',
      };
      const candidato = Object.keys(exemplos).find(nome => command.length >= 2 && nome.startsWith(command));
      const nome = match?.[1]?.slice(0, 40);
      return reply('Comando inválido: ' + prefix + (nome || '') + '. Exemplo: ' +
        (exemplos[candidato] || '!menu para ver os comandos. Experimente !play lista'));
    }
    if (!knownCommand && !settings.autosticker) return;
    if (!isAdmin && knownCommand && (settings.blockedCommands?.includes(command) ||
        (settings.soadm && !settings.allowedCommands?.includes(command)))) {
      return reply('Esse comando está restrito neste grupo.');
    }
    if (knownCommand && !isAdmin && actor && settings.cooldown) {
      const now = Date.now();
      const key = jid + ':' + actor;
      const until = lastCommand.get(key) || 0;
      if (until > now) return reply('Aguarde ' + Math.ceil((until - now) / 1000) + ' s antes de outro comando.');
      if (lastCommand.size >= 1000) {
        for (const [entry, expires] of lastCommand) if (expires <= now) lastCommand.delete(entry);
      }
      lastCommand.set(key, now + settings.cooldown * 1000);
    }
    if (command === 'menu') return reply(menu(arg, menuInfo));
    if (categoryCommands.includes(command)) return reply(menu(command, menuInfo));
    if (Object.hasOwn(basic, command)) return basic[command]({ arg, reply, ownerLabel });
    if (command === 'membros') return reply('O grupo tem ' + participants.length + ' participantes.');
    if (command === 'apelido' && !arg) return reply('Apelido neste grupo: ' + (settings.nickname || botName));
    logger.info({ command, jid }, 'Comando de grupo');
    if (ownerCommands.has(command) && !isOwner) {
      logger.info({
        command, fromMe: Boolean(msg.key.fromMe), ownerNumberConfigured: Boolean(getOwner?.() || env.OWNER_NUMBER),
        senderHasPhone: senderIds.some(id => id.endsWith('@s.whatsapp.net')),
        senderHasLid: senderIds.some(id => id.endsWith('@lid')),
        ownerLidConfigured: Boolean(ownerLid),
      }, 'Identidade do dono não confirmada');
      return reply('Comando exclusivo do dono do ZUMY.');
    }
    if (adminCommands.has(command) && !isAdmin) return reply('Comando exclusivo dos administradores.');
    if (botAdmin === false && ['b', 'ban', 'kick', 'abrirgp', 'fechargp', 'grupo'].includes(command)) {
      return reply('Torne o número conectado ao ZUMY administrador deste grupo para executar esse comando.');
    }
    if (settings.zoeira === false && Object.hasOwn(jokeActions, command)) return reply('Zoeiras desativadas neste grupo.');
    const target = mentions[0] || ctx?.participant;
    const targetIds = target ? [normalizeJid(target)] : [];
    const targetMember = findMember(targetIds) || (target ? findMember(await aliasesFor(targetIds)) : undefined);
    const targetPhone = [normalizeJid(target), ...identity(targetMember)].find(id => /^\d+@s\.whatsapp\.net$/.test(id));
    const quotedKey = ctx?.stanzaId && ctx.participant ? {
      remoteJid: jid,
      id: ctx.stanzaId,
      participant: ctx.participant,
      fromMe: [...botIds, ...identity(bot)].includes(normalizeJid(ctx.participant)),
    } : null;
    const quoted = quotedKey && ctx.quotedMessage ? { key: quotedKey, message: ctx.quotedMessage } : null;
    const isMedia = message => Boolean(message.imageMessage || message.videoMessage || message.stickerMessage);
    const quotedContent = contentOf(quoted?.message);
    const mediaMessage = isMedia(content) || !isMedia(quotedContent) ? msg : quoted;
    const source = contentOf(mediaMessage.message);
    const context = {
      themeMark: (key, ids, title, sender = send) => community.themeMark(jid, key, ids, title, sender),
      sock, jid, arg, reply, send, meta, actor, senderIds, ownerJid, ownerLabel, isAdmin, botAdmin, commandKey: msg.key, target: targetMember?.id || target, targetMember, targetPhone, settings, quotedKey, source, voz,
      members,
      admins: participants.filter(member => member.admin === 'admin' || member.admin === 'superadmin' ||
        member.isAdmin === true || member.isSuperAdmin === true).map(member => member.id).filter(Boolean),
      update,
      quotedText: chatText(contentOf(quoted?.message)),
      download: download => download(mediaMessage),
      mention: (prefix, ids, numbered = false) => send({
        text: prefix + ids.map((id, i) => (numbered ? (i + 1) + '. ' : '') + '@' + normalizeJid(id).split('@')[0]).join(numbered ? '\n' : ' '),
        mentions: ids,
      }),
    };
    if (!knownCommand) {
      if (settings.autosticker) return groupSettings.autoSticker(context);
      return;
    }
    if (command !== 'broadcast') {
      try {
        const result = await handlers[command](context);
        return result;
      } catch (error) {
        const status = error?.output?.statusCode ?? error?.data?.code;
        if (adminCommands.has(command) && Number(status) === 403) {
          return reply('O WhatsApp negou o comando. Confira se o ZUMY está como admin neste grupo.');
        }
        throw error;
      }
    }
    if (broadcasting) return reply('Já há um aviso sendo enviado.');
    broadcasting = true;
    try {
      return await handlers.broadcast(context);
    } finally {
      broadcasting = false;
    }
  };
  async function boasVindasComFoto(sock, event) {
    const { id: jid, action, participants = [] } = event;
    if (action !== 'add') return groupSettings.greet(sock, event);
    const settings = config.get(jid);
    if (!settings.bemvindo && !settings.bemvindo2) return;
    const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(normalizeJid);
    for (const participant of participants) {
      const id = typeof participant === 'string' ? participant : participant?.id;
      if (!id || botIds.includes(normalizeJid(id))) continue;
      const second = settings.bemvindo2;
      const label = (second ? settings.welcomeText2 : settings.welcomeText) || 'Bem-vindo, {usuario}!';
      const tag = '@' + normalizeJid(id).split('@')[0];
      const text = '👋 ' + (settings.nickname || botName) + ' · ' + label.replaceAll('{usuario}', tag);
      const mentions = label.includes('{usuario}') ? [id] : [];
      let photo;
      if (typeof sock.profilePictureUrl === 'function') {
        try { photo = await sock.profilePictureUrl(id, 'image', 5000); }
        catch { /* A privacidade pode impedir a foto. */ }
      }
      if (photo) {
        try {
          await sock.sendMessage(jid, { image: { url: photo }, caption: text, mentions });
          continue;
        } catch { logger.warn('Não consegui enviar a foto do participante nas boas-vindas'); }
      }
      await groupSettings.greet(sock, { ...event, participants: [participant] });
    }
  }
  handleGroup.onParticipantsUpdate = (sock, event) => community.entrance(sock, event, boasVindasComFoto);
  handleGroup.tick = community.tick;
  handleGroup.groupSettings = jid => config.get(jid);
  handleGroup.saveGroupSettings = (jid, values) => config.save(jid, { ...config.get(jid), ...values });
  handleGroup.runAgenda = agendaDiaria.tick;
  return handleGroup;
}
