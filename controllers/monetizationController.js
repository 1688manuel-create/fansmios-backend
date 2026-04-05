// backend/controllers/monetizationController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. SUSCRIBIRSE A UN CREADOR (Con soporte de Descuentos)
// ==========================================
exports.subscribeToCreator = async (req, res) => {
  try {
    const fanId = req.user.userId;
    const { creatorId, discountCode } = req.body; // AHORA RECIBIMOS EL CÓDIGO OPCIONAL

    if (fanId === creatorId) return res.status(400).json({ error: 'No puedes suscribirte a ti mismo.' });

    const creatorProfile = await prisma.creatorProfile.findUnique({ where: { userId: creatorId } });
    if (!creatorProfile) return res.status(404).json({ error: 'Creador no encontrado.' });

    const existingSub = await prisma.subscription.findUnique({
      where: { fanId_creatorId: { fanId, creatorId } }
    });

    if (existingSub && existingSub.status === 'ACTIVE') {
      return res.status(400).json({ error: 'Ya tienes una suscripción activa con este creador.' });
    }

    // -----------------------------------------------------
    // 🎟️ LÓGICA DE DESCUENTOS Y PROMOCIONES
    // -----------------------------------------------------
    let finalPrice = creatorProfile.monthlyPrice;
    let appliedDiscount = null;

    // Buscamos si hay un descuento válido (Ya sea el código que mandó el fan, o uno automático)
    const activeDiscount = await prisma.discount.findFirst({
      where: {
        creatorId: creatorId,
        isActive: true,
        expiresAt: { gt: new Date() }, // Que no haya expirado (greater than today)
        code: discountCode ? discountCode.toUpperCase() : null // Busca el código, o el automático (null)
      }
    });

    if (activeDiscount) {
      // Verificamos si ya llegó al límite de usos
      if (activeDiscount.maxUses !== null && activeDiscount.usedCount >= activeDiscount.maxUses) {
        // Ignoramos el descuento si ya se agotó
        console.log("El descuento ha alcanzado su límite de usos.");
      } else {
        // Aplicamos la matemática: Precio = Precio Original - (Precio Original * Porcentaje / 100)
        finalPrice = finalPrice - (finalPrice * (activeDiscount.discountPercent / 100));
        appliedDiscount = activeDiscount;
      }
    }

    // Si el descuento lo hace gratis temporalmente, aseguramos que mínimo sea 0
    if (finalPrice < 0) finalPrice = 0.0;
    // -----------------------------------------------------

    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    const feePercent = settings ? settings.platformFeePercent : 20.0;
    
    const platformFee = (finalPrice * feePercent) / 100;
    const netAmount = finalPrice - platformFee;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);

    // 🔥 Variable para guardar el resultado y mandarlo al frontend
    let subscriptionData = null;

    await prisma.$transaction(async (tx) => {
      // Si usamos un descuento, le sumamos 1 a su contador de usos
      if (appliedDiscount) {
        await tx.discount.update({
          where: { id: appliedDiscount.id },
          data: { usedCount: { increment: 1 } }
        });
      }

      if (existingSub) {
        subscriptionData = await tx.subscription.update({
          where: { id: existingSub.id },
          data: { status: 'ACTIVE', price: finalPrice, startDate, endDate }
        });
      } else {
        subscriptionData = await tx.subscription.create({
          data: { fanId, creatorId, price: finalPrice, startDate, endDate, status: 'ACTIVE' }
        });
      }

      await tx.transaction.create({
        data: {
          senderId: fanId,
          receiverId: creatorId,
          type: 'SUBSCRIPTION',
          status: 'COMPLETED',
          amount: finalPrice, // Guardamos el precio ya con descuento
          platformFee: platformFee,
          netAmount: netAmount
        }
      });

      await tx.wallet.upsert({
        where: { userId: creatorId },
        update: { pendingBalance: { increment: netAmount } },
        create: { userId: creatorId, pendingBalance: netAmount, balance: 0.0 }
      });
    });

    const msg = appliedDiscount ? `¡Suscripción exitosa con descuento del ${appliedDiscount.discountPercent}%! 🎉` : '¡Suscripción exitosa! 🎉';
    
    // 🔥 Le mandamos la 'subscriptionData' al frontend para que destrabe la pantalla
    res.status(200).json({ 
      message: msg,
      subscription: subscriptionData 
    });

  } catch (error) {
    console.error('Error al suscribirse:', error);
    res.status(500).json({ error: 'Error interno procesando el pago.' });
  }
};

// ==========================================
// 2. CANCELAR SUSCRIPCIÓN MANUALMENTE (Fan)
// ==========================================
exports.cancelSubscription = async (req, res) => {
  try {
    const fanId = req.user.userId;
    const { creatorId } = req.body;

    const subscription = await prisma.subscription.findUnique({
      where: { fanId_creatorId: { fanId, creatorId } }
    });

    if (!subscription || subscription.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'No tienes una suscripción activa con este creador.' });
    }

    // Cambiamos el estatus a CANCELADO. 
    // Nota profesional: El "endDate" no cambia, el usuario sigue teniendo acceso hasta que acabe su mes pagado.
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELED' }
    });

    res.status(200).json({ message: 'Suscripción cancelada. No se te volverá a cobrar el próximo mes. 🛑' });
  } catch (error) {
    console.error('Error al cancelar:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 3. VER HISTORIAL DE SUSCRIPCIONES (Fan)
// ==========================================
exports.getMySubscriptions = async (req, res) => {
  try {
    const fanId = req.user.userId;

    const subscriptions = await prisma.subscription.findMany({
      where: { fanId: fanId },
      include: {
        creator: { select: { email: true, name: true } } // Traemos el nombre del creador
      }
    });

    res.status(200).json({ message: 'Tu historial de suscripciones 📜', subscriptions });
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. MOTOR DE RENOVACIÓN AUTOMÁTICA Y PERIODO DE GRACIA (Sistema Interno)
// *Esta función luego la conectaremos a un "Background Job" (Cron) para que corra sola cada madrugada*
// ==========================================
exports.processRenewals = async (req, res) => {
  try {
    const today = new Date();

    // Buscamos todas las suscripciones activas cuya fecha de fin ya pasó
    const expiredSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { lt: today } // "lt" significa Less Than (menor que hoy)
      }
    });

    // A las que ya vencieron, las ponemos en PERIODO DE GRACIA (PAST_DUE)
    // El periodo de gracia les da unos días para actualizar su tarjeta antes de perder acceso
    for (const sub of expiredSubscriptions) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE' }
      });
    }

    res.status(200).json({ 
      message: 'Motor de renovaciones ejecutado correctamente ⚙️', 
      processed: expiredSubscriptions.length 
    });
  } catch (error) {
    console.error('Error procesando renovaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. COMPRAR UN POST BLOQUEADO (PPV) - Fan
// ==========================================
exports.purchasePost = async (req, res) => {
  try {
    const fanId = req.user.userId;
    const { postId } = req.body;

    // 1. Buscamos el post para ver cuánto cuesta
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    if (!post.isPPV) return res.status(400).json({ error: 'Este post es gratuito, no necesitas pagar.' });
    if (post.userId === fanId) return res.status(400).json({ error: 'No puedes comprar tu propio contenido.' });

    // 2. Verificamos que sea COMPRA ÚNICA (Que no lo haya pagado ya)
    const existingPurchase = await prisma.postPurchase.findUnique({
      where: { fanId_postId: { fanId: fanId, postId: postId } }
    });
    if (existingPurchase) return res.status(400).json({ error: 'Ya compraste este contenido. Ya está desbloqueado para ti.' });

    // 3. Matemáticas Financieras (Cálculo de comisiones)
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    const feePercent = settings ? settings.platformFeePercent : 20.0;

    const price = post.price;
    const platformFee = (price * feePercent) / 100;
    const netAmount = price - platformFee;

    // 4. TRANSACCIÓN SEGURA (Si falla algo, no se cobra nada)
    await prisma.$transaction(async (tx) => {
      // a) Crear el recibo de compra única (Historial)
      await tx.postPurchase.create({
        data: { fanId: fanId, postId: postId, pricePaid: price }
      });

      // b) Registrar en el libro contable de la empresa
      await tx.transaction.create({
        data: {
          senderId: fanId,
          receiverId: post.userId,
          type: 'PPV_POST',
          status: 'COMPLETED',
          amount: price,
          platformFee: platformFee,
          netAmount: netAmount,
          postId: postId
        }
      });

      // c) Ingresar el dinero al creador
      await tx.wallet.upsert({
        where: { userId: post.userId },
        update: { pendingBalance: { increment: netAmount } },
        create: { userId: post.userId, pendingBalance: netAmount, balance: 0.0 }
      });
    });

    res.status(200).json({ message: '¡Compra exitosa! Contenido desbloqueado 🔓' });
  } catch (error) {
    console.error('Error al comprar post:', error);
    res.status(500).json({ error: 'Error procesando el pago PPV.' });
  }
};

// ==========================================
// 6. VER HISTORIAL DE COMPRAS (Desbloqueos del Fan)
// ==========================================
exports.getMyPurchasedPosts = async (req, res) => {
  try {
    const fanId = req.user.userId;

    const purchases = await prisma.postPurchase.findMany({
      where: { fanId: fanId },
      include: {
        post: { 
          select: { content: true, mediaUrl: true, createdAt: true, user: { select: { name: true } } } 
        }
      },
      orderBy: { createdAt: 'desc' } // Los más recientes primero
    });

    res.status(200).json({ message: 'Tu galería de contenido desbloqueado 📸', purchases });
  } catch (error) {
    console.error('Error al obtener historial PPV:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 7. COMPRAR UN MENSAJE BLOQUEADO (PPV)
// ==========================================
exports.purchaseMessage = async (req, res) => {
  try {
    const fanId = req.user.userId;
    const { messageId } = req.body;

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    
    if (!message) return res.status(404).json({ error: 'Mensaje no encontrado.' });
    if (!message.isPPV) return res.status(400).json({ error: 'Este mensaje es gratuito.' });
    if (message.senderId === fanId) return res.status(400).json({ error: 'No puedes comprar tu propio mensaje.' });

    const existingPurchase = await prisma.messagePurchase.findUnique({
      where: { fanId_messageId: { fanId, messageId } }
    });
    if (existingPurchase) return res.status(400).json({ error: 'Ya compraste este mensaje.' });

    // Cálculo de comisiones
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    const feePercent = settings ? settings.platformFeePercent : 20.0;
    
    const price = message.price;
    const platformFee = (price * feePercent) / 100;
    const netAmount = price - platformFee;

    // Transacción Segura
    await prisma.$transaction(async (tx) => {
      await tx.messagePurchase.create({
        data: { fanId, messageId, pricePaid: price }
      });

      await tx.transaction.create({
        data: {
          senderId: fanId,
          receiverId: message.senderId,
          type: 'PPV_MESSAGE',
          status: 'COMPLETED',
          amount: price,
          platformFee,
          netAmount
        }
      });

      await tx.wallet.upsert({
        where: { userId: message.senderId },
        update: { pendingBalance: { increment: netAmount } },
        create: { userId: message.senderId, pendingBalance: netAmount, balance: 0.0 }
      });
    });

    res.status(200).json({ message: '¡Mensaje desbloqueado! 🔓' });
  } catch (error) {
    console.error('Error al comprar mensaje:', error);
    res.status(500).json({ error: 'Error procesando el pago del mensaje.' });
  }
};

// ==========================================
// 8. ENVIAR PROPINA (TIP) - Monto libre y mensaje
// ==========================================
exports.sendTip = async (req, res) => {
  try {
    const fanId = req.user.userId;
    // Recibimos a quién va, cuánto dinero (monto libre) y el texto
    const { creatorId, amount, message } = req.body;

    // 1. Validaciones básicas de negocio
    if (fanId === creatorId) {
      return res.status(400).json({ error: 'No puedes enviarte propinas a ti mismo.' });
    }
    
    const tipAmount = parseFloat(amount);
    if (!tipAmount || tipAmount <= 0) {
      return res.status(400).json({ error: 'El monto de la propina debe ser mayor a $0.00' });
    }

    // Buscamos al creador para asegurarnos de que existe
    const creator = await prisma.user.findUnique({ where: { id: creatorId, role: 'CREATOR' } });
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado.' });

    // 2. Cálculo de comisiones (Tu plataforma siempre gana su parte)
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    const feePercent = settings ? settings.platformFeePercent : 20.0;
    
    const platformFee = (tipAmount * feePercent) / 100;
    const netAmount = tipAmount - platformFee;

    // 3. TRANSACCIÓN SEGURA (Guardamos el dinero y el mensaje)
    await prisma.$transaction(async (tx) => {
      // a) Crear el registro en el historial con el mensaje opcional
      await tx.transaction.create({
        data: {
          senderId: fanId,
          receiverId: creatorId,
          type: 'TIP',
          status: 'COMPLETED',
          amount: tipAmount,
          platformFee: platformFee,
          netAmount: netAmount,
          attachedMessage: message || null // Si envían mensaje lo guarda, si no, lo deja vacío
        }
      });

      // b) Ingresar el dinero limpio a la billetera del creador
      await tx.wallet.upsert({
        where: { userId: creatorId },
        update: { pendingBalance: { increment: netAmount } },
        create: { userId: creatorId, pendingBalance: netAmount, balance: 0.0 }
      });
    });

    res.status(200).json({ message: `¡Propina de $${tipAmount} enviada exitosamente al creador! 🎁` });
  } catch (error) {
    console.error('Error al enviar propina:', error);
    res.status(500).json({ error: 'Error interno procesando la propina.' });
  }
};