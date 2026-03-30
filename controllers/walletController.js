// backend/controllers/walletController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const speakeasy = require('speakeasy'); 

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

    let wallet = await prisma.wallet.findUnique({
      where: { userId: creatorId }
    });

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
    console.error('Error al obtener la billetera:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getTransactionHistory = async (req, res) => {
  try {
    const creatorId = req.user.userId;

    const transactions = await prisma.transaction.findMany({
      where: { receiverId: creatorId },
      orderBy: { createdAt: 'desc' }, 
      include: {
        sender: { select: { email: true, name: true, username: true } } 
      }
    });

    res.status(200).json({
      message: 'Historial de transacciones 📜',
      totalVentas: transactions.length,
      transactions: transactions
    });
  } catch (error) {
    console.error('Error al obtener transacciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// 🔥 3. SOLICITAR UN RETIRO (CORREGIDA CONTABILIDAD)
exports.requestWithdrawal = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    let { amount, isExpress, twoFactorToken } = req.body; 

    isExpress = isExpress === true || isExpress === 'true';

    const user = await prisma.user.findUnique({ where: { id: creatorId } });

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(403).json({ error: '⚠️ Seguridad Requerida: Debes activar el 2FA en tu perfil para retirar fondos.' });
    }
    
    if (!twoFactorToken) {
      return res.status(400).json({ error: 'Debes ingresar tu código de 6 dígitos de Google Authenticator.' });
    }
    
    const isVerified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: twoFactorToken, window: 1 });
    if (!isVerified) return res.status(401).json({ error: '❌ Código 2FA incorrecto o expirado.' });

    const profile = await prisma.creatorProfile.findUnique({ where: { userId: creatorId } });
    if (!profile || profile.kycStatus !== 'APPROVED') {
      return res.status(403).json({ error: '⚠️ Verificación Requerida: Tu identidad (KYC) debe estar aprobada por un administrador.' });
    }

    const withdrawalAmount = parseFloat(amount);
    
    if (!withdrawalAmount || withdrawalAmount < 50) {
      return res.status(400).json({ error: 'El monto mínimo de retiro es de $50.00 USD.' });
    }

    if (!isExpress) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentWithdrawal = await prisma.withdrawal.findFirst({
        where: {
          creatorId: creatorId,
          createdAt: { gte: sevenDaysAgo }
        }
      });

      if (recentWithdrawal) {
        return res.status(400).json({ error: 'Ya pediste un retiro esta semana. Si te urge, usa "Retiro Exprés ⚡".' });
      }
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: creatorId } });

    if (!wallet?.cryptoAddress || wallet.cryptoAddress.length < 10) {
      return res.status(400).json({ error: 'Configura tu Billetera USDT (TRC20) antes de solicitar un retiro.' });
    }

    if (!wallet || wallet.balance < withdrawalAmount) {
      return res.status(400).json({ error: 'No tienes saldo disponible suficiente.' });
    }

    // 👑 CONSULTAR COMISIONES DE RETIRO (MODO DIOS)
    const settings = await prisma.platformSettings.findFirst() || { feeWithdrawalExp: 5, feeWithdrawalStd: 2 };
    
    const feePercent = isExpress ? (settings.feeWithdrawalExp / 100) : (settings.feeWithdrawalStd / 100);
    const feeAmount = withdrawalAmount * feePercent;
    const netAmount = withdrawalAmount - feeAmount;
    
    const typeLabel = isExpress ? '⚡ RETIRO EXPRÉS' : '🐢 RETIRO ESTÁNDAR';

    // 🔒 FLUJO SEGURO (Mueve de balance a pendingBalance)
    const withdrawal = await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: creatorId },
        data: { 
          balance: { decrement: withdrawalAmount },
          pendingBalance: { increment: withdrawalAmount } // 🔥 EL FIX VITAL
        }
      });

      return await tx.withdrawal.create({
        data: { 
          creatorId: creatorId, 
          amount: withdrawalAmount, 
          status: 'PENDING',
          cryptoAddress: wallet.cryptoAddress,
          cryptoNetwork: wallet.cryptoNetwork || 'TRC20',
          adminNotes: `[${typeLabel}] Bruto: $${withdrawalAmount} | Fee (${feePercent * 100}%): $${feeAmount.toFixed(2)} | NETO: $${netAmount.toFixed(2)}`
        }
      });
    });

    res.status(201).json({ 
      message: `Retiro ${isExpress ? 'Exprés ⚡' : 'Estándar ⏳'} autorizado. Recibirás $${netAmount.toFixed(2)} USDT.`, 
      withdrawal 
    });
  } catch (error) {
    console.error('Error al solicitar retiro:', error);
    res.status(500).json({ error: 'Error interno procesando la solicitud.' });
  }
};

exports.getWithdrawalHistory = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const withdrawals = await prisma.withdrawal.findMany({
      where: { creatorId: creatorId },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ message: 'Tu historial de retiros 💸', withdrawals });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.getWalletDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;
    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    
    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { userId, balance: 0, pendingBalance: 0 } });
    }

    // 🔥 REPARACIÓN COVRA PAY: Modificamos la búsqueda para que traiga tanto 
    // lo que recibes (Creador) como las recargas/gastos que haces (Fan).
    const recentTransactions = await prisma.transaction.findMany({
      where: { 
        OR: [
          // Eres el receptor (Alguien te pagó o dio propina)
          { receiverId: userId, status: 'COMPLETED' },
          // O eres el emisor y es una recarga de saldo
          { senderId: userId, type: 'CREDIT_TOPUP', status: 'COMPLETED' },
          // O eres el emisor y gastaste dinero (opcional, para que el fan vea sus gastos)
          { senderId: userId, status: 'COMPLETED' }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { 
        sender: { select: { username: true, email: true } },
        receiver: { select: { username: true } } // 👈 Añadido para saber a quién le pagaste
      }
    });

    const withdrawalHistory = await prisma.withdrawal.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Solo sumamos lo que el usuario ha RECIBIDO para el total histórico
    const totalEarnings = await prisma.transaction.aggregate({
      where: { receiverId: userId, status: 'COMPLETED' },
      _sum: { netAmount: true }
    });

    // 🎯 ADAPTADOR PARA EL FRONTEND
    // Marcamos cada transacción para que el frontend sepa si entró o salió dinero
    const formattedTransactions = recentTransactions.map(tx => ({
      ...tx,
      // Es ingreso si tú eres el receptor, o si es una recarga a tu cuenta
      isIncome: tx.receiverId === userId || tx.type === 'CREDIT_TOPUP'
    }));

    res.status(200).json({
      wallet,
      recentTransactions: formattedTransactions,
      withdrawalHistory,
      totalEarnedHistorial: totalEarnings._sum.netAmount || 0
    });
  } catch (error) {
    console.error("Error en getWalletDashboard:", error);
    res.status(500).json({ error: 'Error interno al cargar los datos financieros.' });
  }
};

exports.updateCryptoAddress = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { cryptoAddress, cryptoNetwork } = req.body;

    if (!cryptoAddress || cryptoAddress.length < 10) {
      return res.status(400).json({ error: 'La dirección cripto no es válida.' });
    }

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