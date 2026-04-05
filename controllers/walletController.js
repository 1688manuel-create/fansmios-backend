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

// 🔥 SOLICITAR UN RETIRO 
exports.requestWithdrawal = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    let { amount, isExpress, twoFactorToken } = req.body; 

    isExpress = isExpress === true || isExpress === 'true';
    const withdrawalAmount = parseFloat(amount); 
    
    if (!withdrawalAmount || withdrawalAmount < 50) {
      return res.status(400).json({ error: 'El monto mínimo de retiro es de $50.00 USD.' });
    }

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

    if (!wallet || wallet.balance < withdrawalAmount) {
      return res.status(400).json({ error: 'No tienes saldo disponible suficiente.' });
    }

    if (!wallet.cryptoAddress || wallet.cryptoAddress.length < 10) {
      return res.status(400).json({ error: 'Configura tu Billetera USDT (TRC20) antes de solicitar un retiro.' });
    }

    // 👑 CONSULTAR COMISIONES DE RETIRO
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
          pendingBalance: { increment: withdrawalAmount }
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

// 🔥 LA CONSULTA MAESTRA DEL DASHBOARD (REESCRITA Y BLINDADA)
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 1. Buscamos al usuario
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    // 2. Buscamos la bóveda real
    const wallet = await prisma.wallet.findUnique({
      where: { userId: userId }
    });

    // 3. 🎯 LA CALCULADORA DEL HISTÓRICO FACTURADO
    // Suma todo el dinero (neto) que haya ingresado al creador
    const totalEarnedAggr = await prisma.transaction.aggregate({
      where: {
        receiverId: userId,
        status: { in: ['COMPLETED', 'PENDING'] }, // Dinero seguro o en cuarentena
        type: { in: ['TIP', 'SUBSCRIPTION', 'PPV_POST', 'PPV_MESSAGE', 'BUNDLE', 'LIVE_TICKET'] } // 👈 ¡Incluimos BUNDLE de la academia!
      },
      _sum: {
        netAmount: true 
      }
    });
    const totalEarnedHistorial = totalEarnedAggr._sum.netAmount || 0;

    // 4. 🎯 HISTORIAL DE RETIROS (Para la tabla inferior derecha)
    const withdrawalHistory = await prisma.withdrawal.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    // 5. Lógica Dinámica de Saldo
    const isCreator = user?.role === 'CREATOR' || user?.role === 'ADMIN';
    const displayBalance = isCreator ? (wallet?.balance || 0) : (user?.walletBalance || 0);

    // 6. Visión Total de Transacciones
    const recentTransactions = await prisma.transaction.findMany({
      where: {
        OR: [
          { senderId: userId },
          { receiverId: userId }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        sender: { select: { username: true } },
        receiver: { select: { username: true } }
      }
    });

    // 7. Mapeo táctico (Le avisamos al frontend qué es ingreso y qué es gasto)
    const mappedTransactions = recentTransactions.map(tx => ({
      ...tx,
      isIncome: tx.receiverId === userId && tx.type !== 'CREDIT_TOPUP'
    }));

    res.status(200).json({
      wallet: {
        balance: displayBalance,
        pendingBalance: wallet?.pendingBalance || 0,
        cryptoAddress: wallet?.cryptoAddress || null
      },
      totalEarnedHistorial: totalEarnedHistorial, // 👈 ¡EL NÚMERO MÁGICO ENVIADO AL FRONTEND!
      withdrawalHistory: withdrawalHistory,       // 👈 ¡LOS RETIROS ENVIADOS AL FRONTEND!
      recentTransactions: mappedTransactions
    });

  } catch (error) {
    console.error("❌ Error en Wallet Bóveda:", error);
    res.status(500).json({ error: "Error al obtener datos de la billetera." });
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