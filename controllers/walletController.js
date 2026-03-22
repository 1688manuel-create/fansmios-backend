// backend/controllers/walletController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const speakeasy = require('speakeasy'); 

// 🔥 NUEVA FUNCIÓN: Obtener billetera básica
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

// ==========================================
// 1. VER EL BALANCE DEL CREADOR
// ==========================================
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

// ==========================================
// 2. VER EL HISTORIAL DE TRANSACCIONES (Ventas)
// ==========================================
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

// ==========================================
// 🔥 3. SOLICITAR UN RETIRO 
// ==========================================
exports.requestWithdrawal = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    let { amount, isExpress, twoFactorToken } = req.body; 

    // 🔥 PARCHE DE SEGURIDAD: Convertir a booleano real para evitar cobros erróneos
    isExpress = isExpress === true || isExpress === 'true';

    const user = await prisma.user.findUnique({ where: { id: creatorId } });

    // 🛡️ ESCUDO DE PRODUCCIÓN: Validación estricta de 2FA y KYC
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
    
    // 🛑 REGLA 1: Monto Mínimo de Retiro ($50)
    if (!withdrawalAmount || withdrawalAmount < 50) {
      return res.status(400).json({ error: 'El monto mínimo de retiro es de $50.00 USD.' });
    }

    // 🛑 REGLA 2: Frecuencia (Solo si NO es Exprés)
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

    // 🛑 REGLA 3: Billetera Cripto (USDT)
    if (!wallet?.cryptoAddress || wallet.cryptoAddress.length < 10) {
      return res.status(400).json({ error: 'Configura tu Billetera USDT (TRC20) antes de solicitar un retiro.' });
    }

    // 🛑 REGLA 4: Fondos Suficientes
    if (!wallet || wallet.balance < withdrawalAmount) {
      return res.status(400).json({ error: 'No tienes saldo disponible suficiente.' });
    }

    // 💰 REGLA 5: EL NEGOCIO (2% Normal vs 5% Exprés)
    const feePercent = isExpress ? 0.05 : 0.02;
    const feeAmount = withdrawalAmount * feePercent;
    const netAmount = withdrawalAmount - feeAmount;
    
    const typeLabel = isExpress ? '⚡ RETIRO EXPRÉS' : '🐢 RETIRO ESTÁNDAR';

    // 🔒 FLUJO SEGURO (Transacción ACID)
    const withdrawal = await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId: creatorId },
        data: { balance: { decrement: withdrawalAmount } }
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

// ==========================================
// 4. VER HISTORIAL DE RETIROS (Creador)
// ==========================================
exports.getWithdrawalHistory = async (req, res) => {
  try {
    const creatorId = req.user.userId;

    const withdrawals = await prisma.withdrawal.findMany({
      where: { creatorId: creatorId },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ message: 'Tu historial de retiros 💸', withdrawals });
  } catch (error) {
    console.error('Error al obtener historial de retiros:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. DASHBOARD DE BILLETERA MAESTRO
// ==========================================
exports.getWalletDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;

    let wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { userId, balance: 0, pendingBalance: 0 } });
    }

    const recentTransactions = await prisma.transaction.findMany({
      where: { receiverId: userId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { sender: { select: { username: true, email: true } } }
    });

    const withdrawalHistory = await prisma.withdrawal.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const totalEarnings = await prisma.transaction.aggregate({
      where: { receiverId: userId, status: 'COMPLETED' },
      _sum: { netAmount: true }
    });

    res.status(200).json({
      wallet,
      recentTransactions,
      withdrawalHistory,
      totalEarnedHistorial: totalEarnings._sum.netAmount || 0
    });
  } catch (error) {
    console.error('Error al cargar la billetera:', error);
    res.status(500).json({ error: 'Error interno al cargar los datos financieros.' });
  }
};

// ==========================================
// 6. ACTUALIZAR DIRECCIÓN CRIPTO (USDT TRC20)
// ==========================================
exports.updateCryptoAddress = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { cryptoAddress, cryptoNetwork } = req.body;

    if (!cryptoAddress || cryptoAddress.length < 10) {
      return res.status(400).json({ error: 'La dirección cripto no es válida.' });
    }

    // Buscamos o creamos la billetera del usuario
    const wallet = await prisma.wallet.upsert({
      where: { userId: userId },
      update: { 
        cryptoAddress: cryptoAddress,
        cryptoNetwork: cryptoNetwork || 'TRC20'
      },
      create: {
        userId: userId,
        balance: 0,
        pendingBalance: 0,
        cryptoAddress: cryptoAddress,
        cryptoNetwork: cryptoNetwork || 'TRC20'
      }
    });

    res.status(200).json({ message: 'Billetera Cripto actualizada con éxito.', wallet });
  } catch (error) {
    console.error('Error al actualizar billetera cripto:', error);
    res.status(500).json({ error: 'Error interno al guardar la dirección.' });
  }
};