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
