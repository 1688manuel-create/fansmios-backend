// backend/controllers/adminPayoutController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendCryptoPayout } = require('../utils/nowpaymentsService'); // 🔥 Importamos el disparador de dinero

// ==========================================
// 1. VER TODAS LAS SOLICITUDES DE RETIRO (Panel Antifraude)
// ==========================================
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      include: {
        creator: { 
          select: { 
            username: true, 
            email: true,
            wallet: { select: { balance: true, pendingBalance: true } }
          } 
        }
      },
      orderBy: { createdAt: 'asc' } 
    });

    res.status(200).json({ withdrawals });
  } catch (error) {
    console.error("Error al obtener retiros pendientes:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
};

// ==========================================
// 🔥 2. APROBAR Y PAGAR RETIRO (Automático con NOWPayments)
// ==========================================
exports.approveWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { txHash, adminNotes } = req.body; 

    const withdrawal = await prisma.withdrawal.findUnique({ 
      where: { id: withdrawalId },
      include: { creator: true } 
    });

    if (!withdrawal || withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    let realTxHash = txHash;

    // 🚀 MAGIA: Si el Admin no puso un hash manual, que lo haga la API sola
    if (!realTxHash) {
      const payoutResult = await sendCryptoPayout(withdrawal.cryptoAddress, withdrawal.amount);
      realTxHash = payoutResult.id || payoutResult.batch_withdrawal_id;
    }

    // 🔒 Transacción ACID: Actualizamos todo en cadena
    await prisma.$transaction(async (tx) => {
      // 1. Marcamos el retiro como PAGADO
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { 
          status: 'PAID', 
          txHash: realTxHash, 
          adminNotes: adminNotes || 'Pago Automático USDT (Tron) exitoso.' 
        }
      });

      // 2. Creamos el recibo en el historial
      await tx.transaction.create({
        data: {
          senderId: req.user.userId, 
          receiverId: withdrawal.creatorId,
          type: 'PAYOUT',
          status: 'COMPLETED',
          amount: withdrawal.amount,
          platformFee: 0, 
          netAmount: withdrawal.amount,
          cryptoTxHash: realTxHash
        }
      });
      
      // 3. Notificamos al Creador
      await tx.notification.create({
        data: {
          userId: withdrawal.creatorId,
          type: 'payout_approved',
          content: `✅ ¡BING! Tu retiro de $${withdrawal.amount} USD acaba de llegar a tu billetera Cripto.`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Retiro aprobado y dinero enviado con éxito. 💸' });

  } catch (error) {
    console.error("Error al aprobar retiro:", error);
    res.status(500).json({ error: error.message || "Error al procesar el pago cripto." });
  }
};

// ==========================================
// 3. RECHAZAR RETIRO (Antifraude / Reembolso)
// ==========================================
exports.rejectWithdrawal = async (req, res) => {
  try {
    const { withdrawalId } = req.params;
    const { adminNotes } = req.body; 

    if (!adminNotes) {
      return res.status(400).json({ error: 'Debes proporcionar una razón para rechazar el retiro.' });
    }

    const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });

    if (!withdrawal || withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: 'El retiro no existe o ya fue procesado.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: 'REJECTED', adminNotes }
      });

      await tx.wallet.update({
        where: { userId: withdrawal.creatorId },
        data: { balance: { increment: withdrawal.amount } }
      });

      await tx.notification.create({
        data: {
          userId: withdrawal.creatorId,
          type: 'payout_rejected',
          content: `❌ Tu retiro de $${withdrawal.amount} fue rechazado. Razón: ${adminNotes}`,
          link: '/dashboard/wallet'
        }
      });
    });

    res.status(200).json({ message: 'Retiro rechazado. Los fondos regresaron al creador. 🛡️' });

  } catch (error) {
    console.error("Error al rechazar retiro:", error);
    res.status(500).json({ error: "Error interno al rechazar el retiro." });
  }
};