// backend/controllers/paymentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { sendNotificationEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../utils/pushService');

// ==========================================
// 1. BÓVEDA PAYRAM: PROCESADOR INSTANTÁNEO 
// (Suscripciones, PPV, Tips, Bundles)
// ==========================================
exports.createPaymentIntent = async (req, res) => {
  try {
    // Recibimos los datos, incluyendo un token simulado de PayRam (MVP)
    const { amount, type, description, couponCode, creatorId, postId, bundleId, messageId, attachedMessage, payramToken } = req.body; 
    const fanId = req.user.userId;
    
    if (!amount || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    if (!type) return res.status(400).json({ error: 'Tipo de pago no especificado.' });

    let finalAmount = parseFloat(amount);
    let appliedCouponId = null;

    // 🎟️ LÓGICA DE CUPONES (Intacta)
    if (couponCode && creatorId && type !== 'TIP') {
      const coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
      if (coupon && coupon.creatorId === creatorId && coupon.active) {
        const isNotExpired = !coupon.expiresAt || new Date() <= new Date(coupon.expiresAt);
        const hasUsesLeft = !coupon.maxUses || coupon.currentUses < coupon.maxUses;
        
        if (isNotExpired && hasUsesLeft) {
          const discount = (finalAmount * coupon.discountPercent) / 100;
          finalAmount = finalAmount - discount;
          appliedCouponId = coupon.id;
        } else {
          return res.status(400).json({ error: 'El cupón ha expirado o alcanzó su límite.' });
        }
      } else {
        return res.status(400).json({ error: 'Cupón inválido.' });
      }
    }

    if (finalAmount < 0.50) finalAmount = 0.50; // Mínimo global

    // 🏦 SPLIT ROUTING: REGLAS DE NEGOCIO
    let feePercent = 0.20; 
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    if (settings) feePercent = settings.platformFeePercent / 100;

    // Reglas Especiales
    if (type === 'LIVE_TICKET' || type === 'PPV_LIVE') feePercent = 0.30; 
    else if (type === 'TIP') feePercent = 0.20; 
    
    const platformFee = finalAmount * feePercent; 
    const netAmount = finalAmount - platformFee;

    // Recibo interno de PayRam (MVP)
    const payramReceiptId = `PAYRAM_TX_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const fan = await prisma.user.findUnique({ where: { id: fanId } });
    const creator = await prisma.user.findUnique({ where: { id: creatorId } });

    // ==========================================
    // 🛡️ TRANSACCIÓN ACID (Todo o Nada)
    // ==========================================
    await prisma.$transaction(async (db) => {
      
      // A. REGISTRO CONTABLE (Inmediatamente Completado)
      const tx = await db.transaction.create({
        data: {
          senderId: fanId,
          receiverId: creatorId,
          type: type,
          status: 'COMPLETED', // ¡Aprobado instantáneamente por PayRam!
          amount: finalAmount,
          platformFee: platformFee,
          netAmount: netAmount,
          postId: postId || null,
          bundleId: bundleId || null,
          attachedMessage: messageId || attachedMessage || null,
          payAddress: payramReceiptId // Guardamos el rastro
        }
      });

      // B. BÓVEDA DEL CREADOR (Dinero a Saldo Pendiente)
      await db.wallet.upsert({
        where: { userId: creatorId },
        update: { pendingBalance: { increment: netAmount } },
        create: { userId: creatorId, balance: 0.0, pendingBalance: netAmount }
      });

      // C. LÓGICA DE DESBLOQUEO INMEDIATO (El antiguo Webhook, ahora es instantáneo)
      if (type === 'SUBSCRIPTION') {
        const existingSub = await db.subscription.findFirst({ where: { fanId, creatorId } });
        const newEndDate = new Date();
        newEndDate.setDate(newEndDate.getDate() + 30);

        if (existingSub) {
          await db.subscription.update({
            where: { id: existingSub.id },
            data: { status: 'ACTIVE', endDate: newEndDate, reminderSent: false }
          });
        } else {
          await db.subscription.create({
            data: { fanId, creatorId, status: 'ACTIVE', price: tx.amount, endDate: newEndDate }
          });
          // Mensaje de bienvenida
          const creatorProfile = await db.creatorProfile.findUnique({ where: { userId: creatorId } });
          if (creatorProfile?.welcomeMessage) {
            let conv = await db.conversation.findFirst({ where: { OR: [{ creatorId }, { fanId }] } }); // Simplificado para Fansmios
            if (!conv) conv = await db.conversation.create({ data: { creatorId, fanId } });
            await db.message.create({ data: { conversationId: conv.id, senderId: creatorId, receiverId: fanId, content: creatorProfile.welcomeMessage, isUnlocked: true } });
          }
        }
        await sendNotificationEmail(creatorId, 'sale', '⭐ ¡Nuevo Suscriptor VIP!', `<b>@${fan.username}</b> pagó su suscripción. Ganaste $${netAmount.toFixed(2)} USD.`);
        await sendPushNotification(creatorId, '⭐ ¡Nuevo VIP!', `@${fan.username} se suscribió a tu perfil.`, `/${creator.username}`);
      }
      
      else if (type === 'TIP') {
        await db.notification.create({ data: { userId: creatorId, type: 'tip', content: `¡Dinero recibido! 💸 @${fan.username} te envió una propina de $${tx.amount.toFixed(2)}.` } });
        await sendNotificationEmail(creatorId, 'sale', '💸 ¡Nueva Propina!', `<b>@${fan.username}</b> envió una propina. Ganaste $${netAmount.toFixed(2)} USD.`);
        await sendPushNotification(creatorId, '💸 ¡Nueva Propina!', `@${fan.username} te envió una propina.`, `/${creator.username}`);
      }
      
      else if (type === 'BUNDLE') {
        const bundle = await db.bundle.findUnique({ where: { id: bundleId }, include: { posts: true } });
        await db.bundlePurchase.create({ data: { fanId, bundleId, pricePaid: tx.amount } });
        const postPurchasesData = bundle.posts.map(p => ({ fanId, postId: p.id, pricePaid: 0 }));
        await db.postPurchase.createMany({ data: postPurchasesData, skipDuplicates: true });
        await sendNotificationEmail(creatorId, 'sale', '📦 ¡Paquete Vendido!', `<b>@${fan.username}</b> compró tu paquete. Ganaste $${netAmount.toFixed(2)} USD.`);
      }
      
      else if (type === 'PPV_POST') {
        await db.postPurchase.create({ data: { fanId, postId, pricePaid: tx.amount } });
        await sendNotificationEmail(creatorId, 'sale', '🔓 ¡Post Desbloqueado (PPV)!', `<b>@${fan.username}</b> pagó por tu post exclusivo. Ganaste $${netAmount.toFixed(2)} USD.`);
      }
      
      else if (type === 'LIVE_TICKET') {
        await db.postPurchase.create({ data: { fanId, postId: attachedMessage, pricePaid: tx.amount } });
        await sendNotificationEmail(creatorId, 'sale', '🎟️ ¡Nueva Entrada Vendida!', `<b>@${fan.username}</b> compró un ticket para tu Live Stream. Ganaste $${netAmount.toFixed(2)} USD.`);
      }
      
      else if (type === 'PPV_MESSAGE') {
        await db.messagePurchase.create({ data: { fanId, messageId: attachedMessage, pricePaid: tx.amount } });
        await db.message.update({ where: { id: attachedMessage }, data: { isUnlocked: true } });
        await sendNotificationEmail(creatorId, 'sale', '✉️ ¡Mensaje Privado Desbloqueado!', `<b>@${fan.username}</b> pagó por tu mensaje privado.`);
      }
    });

    // 🚀 El Frontend recibe el OK inmediato
    res.status(200).json({ 
      success: true, 
      message: 'Pago procesado exitosamente por PayRam.',
      payramReceipt: payramReceiptId
    });

  } catch (error) { 
    console.error("❌ Error grave en Bóveda PayRam:", error);
    res.status(500).json({ error: 'La transacción fue rechazada. No se ha cobrado nada.' }); 
  }
};

// ==========================================
// 2. OBTENER MIS SUSCRIPCIONES (Intacto)
// ==========================================
exports.getMySubscriptions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const subscriptions = await prisma.subscription.findMany({
      where: { fanId: userId },
      include: {
        creator: { select: { username: true, creatorProfile: { select: { profileImage: true } } } }
      },
      orderBy: { endDate: 'desc' }
    });
    
    const formattedSubs = subscriptions.map(sub => ({
      ...sub,
      isExpired: new Date(sub.endDate) < new Date() || sub.status !== 'ACTIVE'
    }));

    res.status(200).json({ subscriptions: formattedSubs });
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. CANCELAR SUSCRIPCIÓN (Intacto)
// ==========================================
exports.cancelSubscription = async (req, res) => {
  try {
    const { creatorId } = req.body;
    const fanId = req.user.userId;

    const subscription = await prisma.subscription.findFirst({
      where: { fanId: fanId, creatorId: creatorId, status: 'ACTIVE' }
    });

    if (!subscription) return res.status(404).json({ error: 'No se encontró la suscripción.' });

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELED' }
    });

    res.status(200).json({ message: 'Suscripción cancelada. Conservarás acceso hasta expirar tus 30 días.' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno al procesar.' });
  }
};