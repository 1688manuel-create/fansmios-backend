// backend/controllers/paymentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { sendNotificationEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../utils/pushService');

// ==========================================
// 🏦 MOTOR COVRA PAY: PROCESADOR INSTANTÁNEO
// ==========================================

exports.createPaymentIntent = async (req, res) => {
  try {
    let { amount, type, description, couponCode, creatorId, postId, bundleId, messageId, attachedMessage } = req.body; 
    const fanId = req.user.userId;

    if (type === 'POST') type = 'PPV_POST';
    if (type === 'MESSAGE') type = 'PPV_MESSAGE';
    
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido.' });

    let finalAmount = parseFloat(amount);
    let appliedCouponId = null;

    // 🔥 Lógica de Cupones de Descuento
    if (couponCode && creatorId && type !== 'TIP') {
      const coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
      if (coupon && coupon.creatorId === creatorId && coupon.active) {
        const isNotExpired = !coupon.expiresAt || new Date() <= new Date(coupon.expiresAt);
        const hasUsesLeft = !coupon.maxUses || coupon.currentUses < coupon.maxUses;
        if (isNotExpired && hasUsesLeft) {
          finalAmount = finalAmount - ((finalAmount * coupon.discountPercent) / 100);
          appliedCouponId = coupon.id;
          await prisma.coupon.update({ where: { id: coupon.id }, data: { currentUses: { increment: 1 } } });
        }
      }
    }

    if (finalAmount < 0.50) finalAmount = 0.50;

    // 👑 MODO DIOS: CONSULTAR COMISIONES EN TIEMPO REAL (Agregamos feeReferral)
    const settings = await prisma.platformSettings.findFirst() || { feeLive: 30, feeSubscription: 20, feeTips: 20, feePPV: 20, feeReferral: 5 };
    
    let feePercent = 0.20; // Default por seguridad
    if (type === 'LIVE_TICKET' || type === 'PPV_LIVE') {
      feePercent = settings.feeLive / 100;
    } else if (type === 'SUBSCRIPTION') {
      feePercent = settings.feeSubscription / 100;
    } else if (type === 'TIP') {
      feePercent = settings.feeTips / 100;
    } else if (type === 'CREDIT_TOPUP') {
      feePercent = 0; 
    } else {
      feePercent = settings.feePPV / 100; 
    }

    const platformFee = finalAmount * feePercent; 
    const netAmount = finalAmount - platformFee;
    const payramReceiptId = `PAYRAM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

    // Obtener nombres para la notificación
    const fan = await prisma.user.findUnique({ where: { id: fanId }, select: { username: true } });
    
    // TRANSACCIÓN ATÓMICA
    await prisma.$transaction(async (db) => {
      
      // ==========================================
      // 💳 RUTA 1: RECARGA DE BILLETERA DEL FAN
      // ==========================================
      if (type === 'CREDIT_TOPUP') {
        
        await db.transaction.create({
          data: { 
            senderId: fanId, 
            receiverId: fanId, // El receptor es él mismo
            type: 'CREDIT_TOPUP', 
            status: 'COMPLETED', 
            amount: finalAmount, 
            platformFee, 
            netAmount, 
            payramReceiptId 
          }
        });

        // 🟢 Sube el dinero al BALANCE DISPONIBLE (listo para gastar)
        await db.wallet.upsert({
          where: { userId: fanId },
          update: { balance: { increment: finalAmount } },
          create: { userId: fanId, balance: finalAmount }
        });

        await db.notification.create({
          data: {
            userId: fanId,
            type: 'SYSTEM',
            content: `Has recargado $${finalAmount} USD a tu billetera con éxito. ⚡`,
            link: '/dashboard'
          }
        });

      } else {
        // ==========================================
        // 🛍️ RUTA 2: PAGOS A CREADORES (PPV, Tips, Subs)
        // ==========================================
        const targetMessageId = messageId || attachedMessage;

        await db.transaction.create({
          data: { 
            senderId: fanId, 
            receiverId: creatorId, 
            type: type, 
            status: 'COMPLETED', 
            amount: finalAmount, 
            platformFee, 
            netAmount, 
            postId, 
            bundleId, 
            attachedMessage: targetMessageId, 
            payramReceiptId 
          }
        });

        // 🟡 El dinero va a PENDING BALANCE (cuarentena)
        await db.wallet.upsert({
          where: { userId: creatorId },
          update: { pendingBalance: { increment: netAmount } },
          create: { userId: creatorId, pendingBalance: netAmount }
        });

        // 🔴 DESCONTAR EL DINERO DE LA BÓVEDA DEL FAN
        const fanWallet = await db.wallet.findUnique({ where: { userId: fanId } });
        if (!fanWallet || fanWallet.balance < finalAmount) {
          throw new Error("Saldo insuficiente en tu Bóveda de FansMio.");
        }
        
        await db.wallet.update({
          where: { userId: fanId },
          data: { balance: { decrement: finalAmount } }
        });

        // ==========================================
        // 🤝 MOTOR DE REFERIDOS (SOLO SUSCRIPCIONES - CANDADO 5 MESES)
        // ==========================================
        // 🔥 Solo se activa si la venta es una SUSCRIPCIÓN
        if (type === 'SUBSCRIPTION') {
          const creatorData = await db.user.findUnique({ 
            where: { id: creatorId }, 
            select: { referredById: true, username: true, createdAt: true } 
          });
          
          if (creatorData && creatorData.referredById) {
            
            // ⏳ REGLA DE ORO: Calcular si han pasado menos de 5 meses
            const expirationDate = new Date(creatorData.createdAt);
            expirationDate.setMonth(expirationDate.getMonth() + 5);
            const now = new Date();

            if (now <= expirationDate) {
              const referralPercent = (settings.feeReferral || 5) / 100;
              const referralBonus = finalAmount * referralPercent;

              // Le depositamos la comisión al Padrino
              await db.wallet.upsert({
                where: { userId: creatorData.referredById },
                update: { balance: { increment: referralBonus } },
                create: { userId: creatorData.referredById, balance: referralBonus }
              });

              // Creamos el recibo vital
              await db.transaction.create({
                data: { 
                  senderId: creatorId, 
                  receiverId: creatorData.referredById, 
                  type: 'PROMOTION', 
                  status: 'COMPLETED', 
                  amount: referralBonus, 
                  platformFee: 0, 
                  netAmount: referralBonus, 
                  attachedMessage: `Comisión por referido de @${creatorData.username}`, 
                  payramReceiptId: `REF-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
                }
              });

              // Notificamos al Padrino
              await db.notification.create({
                data: {
                  userId: creatorData.referredById,
                  type: 'MONEY',
                  content: `¡Dinero pasivo! 💸 Ganaste $${referralBonus.toFixed(2)} por una suscripción de tu referido @${creatorData.username}.`,
                  link: '/dashboard/referrals'
                }
              });
            } else {
              // 🛑 EL TIEMPO EXPIRÓ
              console.log(`⏱️ Referido expirado: @${creatorData.username} superó los 5 meses. No hay comisión para el padrino.`);
            }
          }
        }
        // ==========================================

        let notificationMessage = '';
        let notificationType = 'MONEY';

        if (type === 'SUBSCRIPTION') {
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + 30);
          await db.subscription.upsert({
            where: { fanId_creatorId: { fanId, creatorId } },
            update: { status: 'ACTIVE', endDate },
            create: { fanId, creatorId, status: 'ACTIVE', price: finalAmount, endDate }
          });
          notificationMessage = `¡Nuevo Suscriptor! @${fan.username} se ha suscrito a tu perfil por $${finalAmount}. 🎉`;
          notificationType = 'SUBSCRIPTION';

        } else if (type === 'PPV_POST') {
          await db.postPurchase.create({ data: { fanId, postId, pricePaid: finalAmount } });
          notificationMessage = `@${fan.username} desbloqueó tu publicación PPV por $${finalAmount}. 🔓`;
          notificationType = 'PPV_SALE';

        } else if (type === 'PPV_MESSAGE') {
          if (!targetMessageId) throw new Error("El sistema no recibió el ID del mensaje a desbloquear.");
          await db.messagePurchase.create({ 
            data: { 
              pricePaid: finalAmount,
              fan: { connect: { id: fanId } },
              message: { connect: { id: targetMessageId } }
            } 
          });
          await db.message.update({ where: { id: targetMessageId }, data: { isUnlocked: true } });
          notificationMessage = `@${fan.username} desbloqueó tu mensaje privado por $${finalAmount}. 💌`;
          notificationType = 'MESSAGE_SALE';

        } else if (type === 'BUNDLE') {
          const bundle = await db.bundle.findUnique({ where: { id: bundleId }, include: { posts: true } });
          await db.bundlePurchase.create({ data: { fanId, bundleId, pricePaid: finalAmount } });
          const postPurchasesData = bundle.posts.map(p => ({ fanId, postId: p.id, pricePaid: 0 }));
          await db.postPurchase.createMany({ data: postPurchasesData, skipDuplicates: true });
          notificationMessage = `@${fan.username} compró tu paquete "${bundle.title}" por $${finalAmount}. 📦`;
          notificationType = 'BUNDLE_SALE';

        } else if (type === 'TIP') {
          notificationMessage = `@${fan.username} te ha enviado una propina de $${finalAmount}! 💸 "${description || '¡Gracias!'}"`;
          notificationType = 'TIP';
          
        // 🦅 EL PARCHE ANTI-FUGAS (Para evitar notificaciones vacías)
        } else {
          notificationMessage = `@${fan.username} realizó un pago de $${finalAmount}. 💰`;
          notificationType = 'MONEY';
        }

        // Notificar al Creador
        if (creatorId !== fanId) {
          await db.notification.create({
            data: {
              userId: creatorId,
              type: notificationType,
              content: notificationMessage,
              link: '/dashboard/wallet'
            }
          });
        }
      }
    });

    // 🚀 RESPUESTA AL FRONTEND
    res.status(200).json({ 
      success: true, 
      message: 'Procesado por Covra Pay', 
      receipt: payramReceiptId,
      checkoutUrl: type === 'CREDIT_TOPUP' ? '/dashboard' : undefined 
    });

  } catch (error) {
    console.error("Error Covra Pay:", error);
    res.status(500).json({ error: error.message || 'Error en el motor de pagos interno.' });
  }
};

exports.getMySubscriptions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const subscriptions = await prisma.subscription.findMany({
      where: { fanId: userId },
      include: { creator: { select: { username: true, creatorProfile: { select: { profileImage: true } } } } }
    });
    res.status(200).json({ subscriptions });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener suscripciones.' });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    const { creatorId } = req.body;
    await prisma.subscription.updateMany({
      where: { fanId: req.user.userId, creatorId, status: 'ACTIVE' },
      data: { status: 'CANCELED' }
    });
    res.status(200).json({ message: 'Suscripción cancelada.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al cancelar suscripción.' });
  }
};