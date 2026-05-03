// backend/controllers/walletController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const speakeasy = require('speakeasy'); 
const axios = require('axios'); // 🔥 Para conectar con PayRam
const PDFDocument = require('pdfkit');

exports.getWallet = async (req, res) => {
  try {
    const userId = req.user.userId;
    let wallet = await prisma.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId, balance: 0.0, pendingBalance: 0.0 }
      });
    }
    res.status(200).json({ wallet });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener billetera' });
  }
};

exports.getWalletBalance = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    let wallet = await prisma.wallet.findUnique({ where: { userId: creatorId } });

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId: creatorId, balance: 0.0, pendingBalance: 0.0 }
      });
    }

    res.status(200).json({
      message: 'Billetera obtenida exitosamente 💰',
      wallet: {
        disponibleParaRetirar: wallet.balance,
        enProcesoBancario: wallet.pendingBalance, 
        saldoTotal: wallet.balance + wallet.pendingBalance
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getTransactionHistory = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const transactions = await prisma.transaction.findMany({
      where: { receiverId: creatorId },
      orderBy: { createdAt: 'desc' }, 
      include: { sender: { select: { email: true, name: true, username: true } } }
    });

    res.status(200).json({ message: 'Historial de transacciones 📜', totalVentas: transactions.length, transactions });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.requestWithdrawal = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    let { amount, isExpress, twoFactorToken } = req.body; 

    isExpress = isExpress === true || isExpress === 'true';
    const withdrawalAmount = parseFloat(amount); 
    
    if (!withdrawalAmount || withdrawalAmount < 50) return res.status(400).json({ error: 'El monto mínimo de retiro es de $50.00 USD.' });

    const user = await prisma.user.findUnique({ where: { id: creatorId } });

    if (!user.twoFactorEnabled || !user.twoFactorSecret) return res.status(403).json({ error: '⚠️ Seguridad Requerida: Debes activar el 2FA en tu perfil para retirar fondos.' });
    if (!twoFactorToken) return res.status(400).json({ error: 'Debes ingresar tu código de 6 dígitos de Google Authenticator.' });
    
    const isVerified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: twoFactorToken, window: 1 });
    if (!isVerified) return res.status(401).json({ error: '❌ Código 2FA incorrecto o expirado.' });

    const profile = await prisma.creatorProfile.findUnique({ where: { userId: creatorId } });
    if (!profile || profile.kycStatus !== 'APPROVED') return res.status(403).json({ error: '⚠️ Verificación Requerida: Tu identidad (KYC) debe estar aprobada por un administrador.' });

    if (!isExpress) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentWithdrawal = await prisma.withdrawal.findFirst({
        where: { creatorId: creatorId, createdAt: { gte: sevenDaysAgo } }
      });
      if (recentWithdrawal) return res.status(400).json({ error: 'Ya pediste un retiro esta semana. Si te urge, usa "Retiro Exprés ⚡".' });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: creatorId } });
    if (!wallet || wallet.balance < withdrawalAmount) return res.status(400).json({ error: 'No tienes saldo disponible suficiente.' });
    if (!wallet.cryptoAddress || wallet.cryptoAddress.length < 10) return res.status(400).json({ error: 'Configura tu Billetera USDT (TRC20) antes de solicitar un retiro.' });

    // 👑 MODO DIOS: CONSULTAR COMISIONES EN TIEMPO REAL (🔥 CORREGIDO SINGULAR)
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } }) || { feeWithdrawalExp: 5, feeWithdrawalStd: 2 };
    const feePercent = isExpress ? (settings.feeWithdrawalExp / 100) : (settings.feeWithdrawalStd / 100);
    
    const feeAmount = withdrawalAmount * feePercent;
    const netAmount = withdrawalAmount - feeAmount;
    const typeLabel = isExpress ? '⚡ RETIRO EXPRÉS' : '🐢 RETIRO ESTÁNDAR';

    const withdrawal = await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: creatorId },
        data: { balance: { decrement: withdrawalAmount }, pendingBalance: { increment: withdrawalAmount } }
      });

      await tx.transaction.create({
        data: {
          senderId: creatorId, receiverId: creatorId, type: 'PAYOUT', status: 'PENDING',
          amount: -withdrawalAmount, platformFee: feeAmount, netAmount: -netAmount, attachedMessage: `Solicitud de ${typeLabel}`
        }
      });

      return await tx.withdrawal.create({
        data: { 
          creatorId: creatorId, amount: withdrawalAmount, status: 'PENDING', cryptoAddress: wallet.cryptoAddress, cryptoNetwork: wallet.cryptoNetwork || 'TRC20',
          adminNotes: `[${typeLabel}] Bruto: $${withdrawalAmount} | Fee (${feePercent * 100}%): $${feeAmount.toFixed(2)} | NETO: $${netAmount.toFixed(2)}`
        }
      });
    });

    res.status(201).json({ message: `Retiro ${isExpress ? 'Exprés ⚡' : 'Estándar ⏳'} autorizado. Recibirás $${netAmount.toFixed(2)} USDT.`, withdrawal });
  } catch (error) {
    res.status(500).json({ error: 'Error interno procesando la solicitud.' });
  }
};

exports.getWithdrawalHistory = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const withdrawals = await prisma.withdrawal.findMany({ where: { creatorId: creatorId }, orderBy: { createdAt: 'desc' } });
    res.status(200).json({ message: 'Tu historial de retiros 💸', withdrawals });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const wallet = await prisma.wallet.findUnique({ where: { userId: userId } });

    const totalEarnedAggr = await prisma.transaction.aggregate({
      where: { receiverId: userId, status: { in: ['COMPLETED', 'PENDING'] }, type: { in: ['TIP', 'SUBSCRIPTION', 'PPV_POST', 'PPV_MESSAGE', 'BUNDLE', 'LIVE_TICKET'] } },
      _sum: { netAmount: true }
    });
    const totalEarnedHistorial = totalEarnedAggr._sum.netAmount || 0;

    const withdrawalHistory = await prisma.withdrawal.findMany({ where: { creatorId: userId }, orderBy: { createdAt: 'desc' }, take: 5 });
    const isCreator = user?.role === 'CREATOR' || user?.role === 'ADMIN';
    const displayBalance = isCreator ? (wallet?.balance || 0) : (wallet?.balance || 0);

    const recentTransactions = await prisma.transaction.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      orderBy: { createdAt: 'desc' }, take: 20, include: { sender: { select: { username: true } }, receiver: { select: { username: true } } }
    });

    const mappedTransactions = recentTransactions.map(tx => ({ ...tx, isIncome: tx.receiverId === userId && tx.type !== 'CREDIT_TOPUP' }));

    res.status(200).json({
      wallet: {
        balance: displayBalance,
        pendingBalance: wallet?.pendingBalance || 0,
        cryptoAddress: wallet?.cryptoAddress || null
      },
      totalEarnedHistorial, withdrawalHistory, recentTransactions: mappedTransactions
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener datos de la billetera." });
  }
};

exports.updateCryptoAddress = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { cryptoAddress, cryptoNetwork } = req.body;
    if (!cryptoAddress || cryptoAddress.length < 10) return res.status(400).json({ error: 'La dirección cripto no es válida.' });

    const wallet = await prisma.wallet.upsert({
      where: { userId: userId },
      update: { cryptoAddress: cryptoAddress, cryptoNetwork: cryptoNetwork || 'TRC20' },
      create: { userId: userId, balance: 0, pendingBalance: 0, cryptoAddress: cryptoAddress, cryptoNetwork: cryptoNetwork || 'TRC20' }
    });
    res.status(200).json({ message: 'Billetera Cripto actualizada con éxito.', wallet });
  } catch (error) {
    res.status(500).json({ error: 'Error interno al guardar la dirección.' });
  }
};

// ==========================================
// 💵 GENERAR ORDEN DE RECARGA DE BÓVEDA EN DÓLARES (COVRA PAY)
// ==========================================
exports.buyCoins = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log("🔥 ATENCIÓN: MI ID DE USUARIO ES --->", userId);
    
    // 🔥 Solo recibimos los dólares (amountUsd), ignoramos monedas
    const { amountUsd } = req.body;

    let finalAmount = parseFloat(amountUsd);

    // Validación pura de dólares
    if (!finalAmount || finalAmount <= 0) {
      return res.status(400).json({ error: 'Monto de recarga inválido.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // ⚡ CONEXIÓN A COVRA PAY
    const covraUrl = `${process.env.PAYRAM_BASE_URL}/api/v1/payment`; 

    const payramResponse = await axios.post(covraUrl, {
      customerEmail: user.email,     
      customerID: userId.toString(), // 👈 Mandamos el ID limpio
      amountInUSD: finalAmount       // 👈 El número puro en dólares
    }, {
      headers: { 
        'API-Key': process.env.PAYRAM_API_KEY, 
        'Content-Type': 'application/json'
      },
      timeout: 8000 
    });

    const checkoutUrl = payramResponse.data.url;

    if (!checkoutUrl) {
      throw new Error("Covra Pay no devolvió una URL de checkout válida.");
    }

    res.status(200).json({ success: true, checkoutUrl });

  } catch (error) {
    console.error("❌ Error generando orden CovraPay:", error.message);
    res.status(500).json({ error: "No se pudo conectar con la pasarela blindada. Intenta de nuevo." });
  }
};

// ==========================================
// 📄 GENERADOR DE COMPROBANTES PDF (FINTECH)
// ==========================================
exports.downloadWithdrawalReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    
    // 🔥 CORRECCIÓN 1: Leemos correctamente el ID desde el token
    const userId = req.user.userId; 

    // 🔥 CORRECCIÓN 2: Buscamos tu rol directo en la base de datos para no fallar
    const userRequesting = await prisma.user.findUnique({ where: { id: userId } });
    const userRole = userRequesting ? userRequesting.role : 'USER';

    // 1. Buscamos el retiro en la base de datos
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id },
      include: { creator: true }
    });

    if (!withdrawal) {
      return res.status(404).json({ error: "Retiro no encontrado" });
    }

    // 2. Blindaje: Solo el dueño del retiro o un ADMIN puede descargarlo
    if (withdrawal.creatorId !== userId && userRole !== 'ADMIN') {
      return res.status(403).json({ error: "Acceso denegado a este comprobante" });
    }

    // 3. Configuramos las cabeceras HTTP para forzar la descarga de un PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Fansmio_Recibo_${withdrawal.id.substring(0,8)}.pdf`);

    // 4. Inicializamos el documento PDF
    const doc = new PDFDocument({ margin: 50 });
    
    // Conectamos el documento directamente a la respuesta (stream)
    doc.pipe(res);

    // --- DISEÑO DEL PDF ---
    // Título / Logo
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#22c55e').text('FANSMIO', { align: 'center' });
    doc.fontSize(12).font('Helvetica').fillColor('#000000').text('Comprobante de Liquidación (Payout Receipt)', { align: 'center' });
    doc.moveDown(2);

    // Detalles del Emisor
    doc.fontSize(10).font('Helvetica-Bold').text('Detalles del Emisor:');
    doc.font('Helvetica').text('Fansmio Inc.');
    doc.text('https://fansmio.com');
    doc.moveDown();

    // Detalles del Creador
    doc.font('Helvetica-Bold').text('Detalles del Beneficiario:');
    doc.font('Helvetica').text(`Usuario: @${withdrawal.creator.username || 'Creador'}`);
    doc.text(`ID de Plataforma: ${withdrawal.creatorId}`);
    doc.moveDown();

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown();

    // Detalles de la Transacción
    doc.fontSize(14).font('Helvetica-Bold').text('Detalles de la Transacción', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).font('Helvetica-Bold').text('ID de Transacción: ', { continued: true }).font('Helvetica').text(withdrawal.id);
    doc.font('Helvetica-Bold').text('Fecha de Solicitud: ', { continued: true }).font('Helvetica').text(new Date(withdrawal.createdAt).toLocaleString());
    
    // Traducir estado a algo más amigable
    let statusTexto = withdrawal.status;
    if (withdrawal.status === 'PAID' || withdrawal.status === 'APPROVED') statusTexto = 'COMPLETADO Y PAGADO';
    
    doc.font('Helvetica-Bold').text('Estado: ', { continued: true }).font('Helvetica').text(statusTexto);
    doc.font('Helvetica-Bold').text('Monto Pagado: ', { continued: true }).fillColor('#22c55e').text(`$${withdrawal.amount.toFixed(2)} USD`).fillColor('#000000');
    
    if (withdrawal.cryptoAddress) {
      doc.font('Helvetica-Bold').text('Billetera Destino: ', { continued: true }).font('Helvetica').text(withdrawal.cryptoAddress);
    }
    if (withdrawal.cryptoNetwork) {
      doc.font('Helvetica-Bold').text('Red Cripto: ', { continued: true }).font('Helvetica').text(withdrawal.cryptoNetwork);
    }
    if (withdrawal.txHash) {
      doc.font('Helvetica-Bold').text('Hash de Transacción (TxHash): ', { continued: true }).font('Helvetica').text(withdrawal.txHash);
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(2);

    // Pie de página legal
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('gray')
       .text('Este documento es un comprobante digital generado automáticamente y sirve como respaldo de liquidación de fondos en la plataforma Fansmio.', { align: 'center' });

    // Finalizar y enviar documento
    doc.end();

  } catch (error) {
    console.error("Error generando PDF:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno al generar el PDF" });
    }
  }
};