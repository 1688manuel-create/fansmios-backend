// backend/controllers/paymentController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { sendNotificationEmail } = require('../utils/emailService');
const { sendPushNotification } = require('../utils/pushService');
const { createCryptoPayment } = require('../utils/nowpaymentsService');

// ==========================================
// 1. GENERADOR MAESTRO DE ÓRDENES (Suscripciones, PPV, Tips, Bundles)
// ==========================================
exports.createPaymentIntent = async (req, res) => {
  try {
    const { amount, type, description, couponCode, creatorId, postId, bundleId, messageId, attachedMessage } = req.body; 
    const fanId = req.user.userId;
    
    if (!amount || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    if (!type) return res.status(400).json({ error: 'Tipo de pago no especificado.' });

    let finalAmount = parseFloat(amount);
    let appliedCouponId = null;

    // Lógica de Cupones (Se mantiene intacta)
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
          return res.status(400).json({ error: 'El cupón ha expirado o alcanzó su límite de usos.' });
        }
      } else {
        return res.status(400).json({ error: 'Cupón inválido.' });
      }
    }

    if (finalAmount < 0.50) finalAmount = 0.50; // Mínimo global

    // ==========================================
    // 🏦 SPLIT ROUTING: TUS REGLAS DE NEGOCIO ESTRICTAS
    // ==========================================
    let feePercent = 0.20; // 20% por defecto de la plataforma (80% Creador)
    
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    if (settings) feePercent = settings.platformFeePercent / 100;

    // 🔥 REGLAS ESPECÍFICAS DE LA FASE 5 (LIVE STREAMING)
    if (type === 'LIVE_TICKET' || type === 'PPV_LIVE') {
      feePercent = 0.30; // 30% Plataforma -> 70% Creador
    } else if (type === 'TIP') {
      feePercent = 0.20; // 20% Plataforma -> 80% Creador (Se mantiene tu regla)
    }
    
    const platformFee = finalAmount * feePercent; 
    const netAmount = finalAmount - platformFee;

    console.log("🔍 REVISIÓN DE IDs ANTES DE GUARDAR:");
    console.log("Sender (Comprador):", req.user.userId);
    console.log("Receiver (Creador):", creatorId);
    console.log("Post ID:", postId);



    // Creamos la Transacción en estado PENDIENTE
    const transaction = await prisma.transaction.create({
      data: {
        senderId: fanId,
        receiverId: creatorId,
        type: "PPV_POST", // SUBSCRIPTION, TIP, PPV_POST, PPV_MESSAGE, BUNDLE, LIVE_TICKET
        status: 'PENDING',
        amount: finalAmount,
        platformFee: platformFee,
        netAmount: netAmount,
        postId: postId || null,
        bundleId: bundleId || null,
        attachedMessage: messageId || attachedMessage || null 
      }
    });

    // Conectamos con NOWPayments para obtener la Billetera Desechable
    const cryptoPayment = await createCryptoPayment(finalAmount, transaction.id, description || `Pago en plataforma`);

    // Actualizamos con los datos del banco cripto
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        nowPaymentsId: cryptoPayment.payment_id.toString(),
        payAddress: cryptoPayment.pay_address,
        status: 'WAITING_CRYPTO'
      }
    });

    // Devolvemos la info al Frontend para que el widget Onramper procese la tarjeta
    res.status(200).json({ 
      success: true, 
      transactionId: transaction.id,
      nowPaymentsId: cryptoPayment.payment_id,
      payAddress: cryptoPayment.pay_address,
      finalAmount, 
      couponId: appliedCouponId 
    });

  } catch (error) { 
    console.error("Error al generar orden:", error);
    res.status(500).json({ error: 'Error interno al comunicarse con el procesador global.' }); 
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
// 3. CANCELAR SUSCRIPCIÓN (Evitar renovar si quisieran)
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

// ==========================================
// 📡 4. WEBHOOK GLOBAL (El Cerebro Activador)
// Aquí es donde NOWPayments nos avisa que la tarjeta pasó.
// ==========================================
exports.nowPaymentsWebhook = async (req, res) => {
  try {
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
    const signature = req.headers['x-nowpayments-sig'];
    
    // Verificación de seguridad de NOWPayments
    const hmac = crypto.createHmac('sha512', ipnSecret);
    hmac.update(JSON.stringify(req.body, Object.keys(req.body).sort()));
    const calculatedSignature = hmac.digest('hex');

    if (signature !== calculatedSignature) {
      console.error('🚨 Webhook: Firma inválida detectada.');
      return res.status(401).send('Invalid signature');
    }

    const paymentStatus = req.body.payment_status; // 'finished', 'failed', 'refunded'...
    const orderId = req.body.order_id; // Este es nuestro transaction.id

    if (paymentStatus === 'finished') {
      // 1. Buscar la transacción
      const tx = await prisma.transaction.findUnique({ 
        where: { id: orderId },
        include: { sender: true, receiver: true } 
      });

      if (!tx || tx.status === 'COMPLETED') return res.status(200).json({ message: 'Ya procesado' });

      // 2. Transacción de Base de datos (ACID Seguro)
      await prisma.$transaction(async (db) => {
        // A. Marcar transacción como completada
        await db.transaction.update({
          where: { id: tx.id },
          data: { status: 'COMPLETED' }
        });

        // B. Enviar dinero a la PENDING WALLET del creador (Seguridad Antifraude)
        const existingWallet = await db.wallet.findUnique({ where: { userId: tx.receiverId } });
        if (existingWallet) {
          await db.wallet.update({
            where: { userId: tx.receiverId },
            data: { pendingBalance: { increment: tx.netAmount } }
          });
        } else {
          await db.wallet.create({
            data: { userId: tx.receiverId, balance: 0.0, pendingBalance: tx.netAmount }
          });
        }

        // C. LÓGICA DE ACTIVACIÓN SEGÚN EL TIPO DE COMPRA
        const fan = tx.sender;
        const creator = tx.receiver;

        if (tx.type === 'SUBSCRIPTION') {
          // Suscripción Manual (30 días exactos)
          const existingSub = await db.subscription.findFirst({ where: { fanId: fan.id, creatorId: creator.id } });
          const newEndDate = new Date();
          newEndDate.setDate(newEndDate.getDate() + 30); // Sumar 30 días

          if (existingSub) {
            await db.subscription.update({
              where: { id: existingSub.id },
              data: { status: 'ACTIVE', endDate: newEndDate, reminderSent: false }
            });
          } else {
            await db.subscription.create({
              data: { fanId: fan.id, creatorId: creator.id, status: 'ACTIVE', price: tx.amount, endDate: newEndDate }
            });
            // Mensaje de bienvenida bot
            const creatorProfile = await db.creatorProfile.findUnique({ where: { userId: creator.id } });
            if (creatorProfile?.welcomeMessage) {
              let conv = await db.conversation.findFirst({ where: { OR: [{ creatorId: creator.id, fanId: fan.id }] } });
              if (!conv) conv = await db.conversation.create({ data: { creatorId: creator.id, fanId: fan.id } });
              await db.message.create({ data: { conversationId: conv.id, senderId: creator.id, receiverId: fan.id, content: creatorProfile.welcomeMessage, isUnlocked: true } });
            }
          }
          await sendNotificationEmail(creator.id, 'sale', '⭐ ¡Nuevo Suscriptor VIP!', `<b>@${fan.username}</b> pagó su suscripción. Has ganado $${tx.netAmount.toFixed(2)} USD.`);
          await sendPushNotification(creator.id, '⭐ ¡Nuevo VIP!', `@${fan.username} se suscribió a tu perfil.`, `http://localhost:3000/${creator.username}`);
        }

        else if (tx.type === 'TIP') {
          await db.notification.create({ data: { userId: creator.id, type: 'tip', content: `¡Dinero recibido! 💸 @${fan.username} te envió una propina de $${tx.amount.toFixed(2)}.`, link: `/${creator.username}` } });
          await sendNotificationEmail(creator.id, 'sale', '💸 ¡Nueva Propina!', `<b>@${fan.username}</b> envió una propina. Ganaste $${tx.netAmount.toFixed(2)} USD.`);
          await sendPushNotification(creator.id, '💸 ¡Nueva Propina!', `@${fan.username} te envió una propina.`, `http://localhost:3000/${creator.username}`);
        }

        else if (tx.type === 'BUNDLE') {
          const bundle = await db.bundle.findUnique({ where: { id: tx.bundleId }, include: { posts: true } });
          await db.bundlePurchase.create({ data: { fanId: fan.id, bundleId: tx.bundleId, pricePaid: tx.amount } });
          const postPurchasesData = bundle.posts.map(p => ({ fanId: fan.id, postId: p.id, pricePaid: 0 }));
          await db.postPurchase.createMany({ data: postPurchasesData, skipDuplicates: true });
          
          await sendNotificationEmail(creator.id, 'sale', '📦 ¡Paquete Vendido!', `<b>@${fan.username}</b> compró tu paquete. Ganaste $${tx.netAmount.toFixed(2)} USD.`);
          await sendPushNotification(creator.id, '📦 ¡Paquete Vendido!', `@${fan.username} compró tu paquete.`, `http://localhost:3000/dashboard/content-bundles`);
        }

        else if (tx.type === 'PPV_POST') {
          await db.postPurchase.create({ data: { fanId: fan.id, postId: tx.postId, pricePaid: tx.amount } });
          await sendNotificationEmail(creator.id, 'sale', '🔓 ¡Post Desbloqueado (PPV)!', `<b>@${fan.username}</b> pagó por tu post exclusivo. Ganaste $${tx.netAmount.toFixed(2)} USD.`);
          await sendPushNotification(creator.id, '🔓 ¡Venta de PPV!', `@${fan.username} desbloqueó tu post.`, `http://localhost:3000/${creator.username}#${tx.postId}`);
        }

        // ... (tus otros else if) ...
        else if (tx.type === 'LIVE_TICKET') {
          // El 'attachedMessage' guarda el ID del Stream que compraron
          await db.postPurchase.create({ 
            data: { fanId: fan.id, postId: tx.attachedMessage, pricePaid: tx.amount } // Usamos la misma tabla para accesos
          });
          
          await sendNotificationEmail(creator.id, 'sale', '🎟️ ¡Nueva Entrada Vendida!', `<b>@${fan.username}</b> compró un ticket para tu Live Stream. Ganaste $${tx.netAmount.toFixed(2)} USD.`);
          await sendPushNotification(creator.id, '🎟️ ¡Boleto Vendido!', `@${fan.username} compró acceso a tu Live.`, `http://localhost:3000/dashboard/live`);
        }

        else if (tx.type === 'PPV_MESSAGE') {
          await db.messagePurchase.create({ data: { fanId: fan.id, messageId: tx.attachedMessage, pricePaid: tx.amount } });
          await db.message.update({ where: { id: tx.attachedMessage }, data: { isUnlocked: true } });
          await sendNotificationEmail(creator.id, 'sale', '✉️ ¡Mensaje Privado Desbloqueado!', `<b>@${fan.username}</b> pagó por tu mensaje privado.`);
          await sendPushNotification(creator.id, '✉️ ¡Dinero en Chat!', `@${fan.username} pagó por tu mensaje.`, `http://localhost:3000/dashboard/messages`);
        }
      });
    } 
    else if (paymentStatus === 'failed' || paymentStatus === 'refunded') {
      await prisma.transaction.update({
        where: { id: orderId },
        data: { status: 'FAILED' }
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error("❌ Error grave procesando Webhook de NOWPayments:", error);
    res.status(500).send('Webhook Error');
  }
};