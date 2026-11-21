if (nextQr) {
  status = 'aguardando_pareamento';
  qr = nextQr;
  logger.info('QR de pareamento disponível');

  const numero = String(
    process.env.PAIRING_NUMBER || ''
  ).trim();

  if (!numero) {
    logger.warn('Configure PAIRING_NUMBER na Discloud.');
  } else if (!/^55\d{10,11}$/.test(numero)) {
    logger.warn(
      'PAIRING_NUMBER inválido. Use 55 + DDD + número, somente dígitos.'
    );
  } else if (
    !state.creds.registered &&
    !current.zumyCodigoSolicitado &&
    !pairingInProgress
  ) {
    current.zumyCodigoSolicitado = true;
    pairingInProgress = true;

    void (async () => {
      try {
        const codigo =
          await current.requestPairingCode(numero);

        if (current !== sock || status === 'conectado') return;

        logger.info(
          'CÓDIGO PARA CONECTAR A ZUMY: ' + codigo
        );
      } catch (error) {
        logger.warn(
          {
            code: error.output?.statusCode || error.code,
            name: error.name,
          },
          'Falha ao gerar código de pareamento'
        );
      } finally {
        pairingInProgress = false;
      }
    })();
  }
}
