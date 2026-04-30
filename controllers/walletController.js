// backend/controllers/walletController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const speakeasy = require('speakeasy'); 
const axios = require('axios'); // 🔥 NUEVO: Para conectar con PayRam

exports.getWallet = async (req, res) => {
  try {
    const userId = req.user.userId;
    let wallet = await prisma.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId, balance: 0.0, pendingBalance: 0.0, coinBalance: 0 }
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
        data: { userId: creatorId, balance: 0.0, pendingBalance: 0.0, coinBalance: 0 }
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

    const settings = await prisma.platformSettings.findFirst() || { feeWithdrawalExp: 5, feeWithdrawalStd: 2 };
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
        coinBalance: wallet?.coinBalance || 0, // 🔥 Añadimos el saldo de monedas al feed
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
      create: { userId: userId, balance: 0, pendingBalance: 0, coinBalance: 0, cryptoAddress: cryptoAddress, cryptoNetwork: cryptoNetwork || 'TRC20' }
    });
    res.status(200).json({ message: 'Billetera Cripto actualizada con éxito.', wallet });
  } catch (error) {
    res.status(500).json({ error: 'Error interno al guardar la dirección.' });
  }
};

// ==========================================
// 🪙 NUEVO: GENERAR ORDEN DE COMPRA DE MONEDAS (PAYRAM / COVRA PAY)
// ==========================================
exports.buyCoins = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageId, amountUsd, coinsToAdd } = req.body;

    if (!amountUsd || !coinsToAdd) {
      return res.status(400).json({ error: 'Datos del paquete inválidos.' });
    }

    // 🐎 EL CABALLO DE TROYA: Pegamos el ID con las monedas para que el Webhook sepa cuánto entregar
    const trojanPayload = `${userId}:::${coinsToAdd}`;

    // ⚡ CONEXIÓN A PAYRAM (COVRA PAY)
    // Usamos tu dominio oficial desde el .env
    const payramUrl = `${process.env.PAYRAM_BASE_URL}/api/v1/invoices`; 

    const payramResponse = await axios.post(payramUrl, {
      amount: amountUsd,
      currency: 'USD',
      customer_id: trojanPayload, 
      description: `Fansmio: Paquete de ${coinsToAdd} Monedas`,
      success_url: `${process.env.FRONTEND_URL}/dashboard/wallet`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard/wallet`
    }, {
      headers: { 
        'Authorization': `Bearer ${process.env.PAYRAM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 8000 // 🔥 Obliga a fallar rápido si hay un bloqueo de red (8 segundos)
    });

    // CovraPay debería regresarte un link de pago (checkoutUrl)
    const checkoutUrl = payramResponse.data.checkout_url || payramResponse.data.payment_link || payramResponse.data.url;

    if (!checkoutUrl) {
      throw new Error("La pasarela no devolvió una URL de pago válida.");
    }

    res.status(200).json({ checkoutUrl });

  } catch (error) {
    console.error("❌ Error generando orden CovraPay:", error.message);
    if (error.response) console.error("Detalle del error:", error.response.data);
    
    res.status(500).json({ error: "No se pudo conectar con la pasarela blindada. Intenta de nuevo." });
  }
};