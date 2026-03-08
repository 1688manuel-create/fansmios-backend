// backend/controllers/bundleController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ==========================================
// 1. CREAR UN PAQUETE (Solo Creador)
// ==========================================
exports.createBundle = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { title, description, price, postIds } = req.body; // postIds es un arreglo: ["id1", "id2"]

    if (!title || price === undefined || !postIds || postIds.length === 0) {
      return res.status(400).json({ error: 'Faltan datos. Un paquete necesita título, precio y al menos un post.' });
    }

    // 1. Verificamos que los posts realmente existan y le pertenezcan a este creador
    const posts = await prisma.post.findMany({
      where: {
        id: { in: postIds },
        userId: creatorId
      }
    });

    if (posts.length !== postIds.length) {
      return res.status(400).json({ error: 'Algunos posts no existen o no te pertenecen.' });
    }

    // 2. Creamos el Bundle en la base de datos y lo conectamos con los posts
    const newBundle = await prisma.bundle.create({
      data: {
        creatorId: creatorId,
        title: title,
        description: description,
        price: parseFloat(price),
        posts: {
          connect: postIds.map(id => ({ id })) // Sintaxis de Prisma para enlazar posts existentes
        }
      },
      include: { posts: true }
    });

    res.status(201).json({ message: 'Paquete creado exitosamente 📦', bundle: newBundle });
  } catch (error) {
    console.error('Error al crear bundle:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 2. COMPRAR UN PAQUETE (Fan)
// ==========================================
exports.purchaseBundle = async (req, res) => {
  try {
    const fanId = req.user.userId;
    const { bundleId } = req.body;

    // 1. Buscamos el paquete y los posts que trae adentro
    const bundle = await prisma.bundle.findUnique({
      where: { id: bundleId },
      include: { posts: true }
    });

    if (!bundle) return res.status(404).json({ error: 'Paquete no encontrado.' });
    if (bundle.creatorId === fanId) return res.status(400).json({ error: 'No puedes comprar tu propio paquete.' });

    // 2. Verificamos que no lo haya comprado ya
    const existingPurchase = await prisma.bundlePurchase.findUnique({
      where: { fanId_bundleId: { fanId, bundleId } }
    });
    if (existingPurchase) return res.status(400).json({ error: 'Ya compraste este paquete.' });

    // 3. Matemáticas Financieras
    const settings = await prisma.platformSetting.findUnique({ where: { id: 'global_settings' } });
    const feePercent = settings ? settings.platformFeePercent : 20.0;
    
    const price = bundle.price;
    const platformFee = (price * feePercent) / 100;
    const netAmount = price - platformFee;

    // 4. TRANSACCIÓN SEGURA (Magia de Desbloqueo en Masa)
    await prisma.$transaction(async (tx) => {
      // a) Crear el recibo del paquete completo
      await tx.bundlePurchase.create({
        data: { fanId, bundleId, pricePaid: price }
      });

      // b) 🪄 DESBLOQUEO EN MASA: Crear un recibo individual por cada post dentro del paquete.
      // Usamos "skipDuplicates: true" por si el Fan ya había comprado uno de estos posts sueltos antes.
      const postPurchasesData = bundle.posts.map(post => ({
        fanId: fanId,
        postId: post.id,
        pricePaid: 0 // Le ponemos 0 porque el precio ya se cobró en el paquete
      }));

      await tx.postPurchase.createMany({
        data: postPurchasesData,
        skipDuplicates: true 
      });

      // c) Libro contable de la empresa
      await tx.transaction.create({
        data: {
          senderId: fanId,
          receiverId: bundle.creatorId,
          type: 'BUNDLE',
          status: 'COMPLETED',
          amount: price,
          platformFee,
          netAmount,
          bundleId: bundleId
        }
      });

      // d) Pagarle al creador
      await tx.wallet.upsert({
        where: { userId: bundle.creatorId },
        update: { pendingBalance: { increment: netAmount } },
        create: { userId: bundle.creatorId, pendingBalance: netAmount, balance: 0.0 }
      });
    });

    res.status(200).json({ message: '¡Paquete comprado! Todo el contenido ha sido desbloqueado 🔓📦' });
  } catch (error) {
    console.error('Error al comprar paquete:', error);
    res.status(500).json({ error: 'Error procesando el pago del paquete.' });
  }
};

// ==========================================
// 3. OBTENER MIS PAQUETES CREADOS (Solo Creador)
// ==========================================
exports.getMyBundles = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const bundles = await prisma.bundle.findMany({
      where: { creatorId: creatorId },
      include: { 
        posts: { select: { id: true, mediaUrl: true, mediaType: true } }, // Traemos info visual de los posts
        _count: { select: { purchases: true } } // Cuántas veces se ha vendido
      },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ bundles });
  } catch (error) {
    console.error('Error al obtener mis bundles:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. OBTENER POSTS ELEGIBLES PARA UN PAQUETE (Solo Creador)
// ==========================================
exports.getEligiblePosts = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    // Solo traemos posts que sean PPV y que tengan alguna imagen/video
    const posts = await prisma.post.findMany({
      where: { userId: creatorId, isPPV: true, mediaUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, content: true, mediaUrl: true, mediaType: true, price: true }
    });
    res.status(200).json({ posts });
  } catch (error) {
    console.error('Error al obtener posts elegibles:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 5. OBTENER PAQUETES DE UN CREADOR (Mostrador Público para Fans)
// ==========================================
exports.getCreatorBundles = async (req, res) => {
  try {
    const { username } = req.params;
    const fanId = req.user.userId;

    const creator = await prisma.user.findUnique({ where: { username } });
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });

    // Traemos todos los bundles y el contenido de sus posts
    const bundles = await prisma.bundle.findMany({
      where: { creatorId: creator.id },
      include: {
        posts: { select: { id: true, content: true, mediaUrl: true, mediaType: true } },
        purchases: { where: { fanId: fanId } } 
      },
      orderBy: { createdAt: 'desc' }
    });

    // Separamos los que ya compró de los que aún puede comprar
    const availableBundles = bundles.filter(bundle => bundle.purchases.length === 0);
    const purchasedBundles = bundles.filter(bundle => bundle.purchases.length > 0);

    res.status(200).json({ availableBundles, purchasedBundles });
  } catch (error) {
    console.error('Error al obtener paquetes del creador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// 🥈 NIVEL 2 DE PUBLICIDAD: EL BANNER AZUL (Solo Boost PRO)
exports.getFeaturedBundle = async (req, res) => {
  try {
    // 1. Buscamos quién pagó la renta del aparador (Paquete PRO)
    const activeProPromo = await prisma.promotion.findFirst({
      where: {
        package: 'PRO', // 🔥 SOLO QUIEN PAGÓ EL NIVEL 2
        active: true,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!activeProPromo) {
       return res.status(200).json({ bundle: null });
    }

    // 2. Si alguien sí pagó, buscamos su paquete (Bundle)
    const bundle = await prisma.bundle.findFirst({
      where: { creatorId: activeProPromo.creatorId },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { 
          select: { 
            id: true, 
            username: true, 
            name: true,
            // 🔥 ESTA ES LA LÍNEA MÁGICA QUE FALTABA PARA TRAER LA FOTO:
            creatorProfile: { select: { profileImage: true } } 
          } 
        },
        posts: { select: { id: true } } 
      }
    });
    
    res.status(200).json({ bundle });
  } catch (error) {
    console.error('Error fetching featured bundle:', error);
    res.status(500).json({ error: 'Error del servidor al buscar el paquete patrocinado' });
  }
};

// ELIMINAR UN PAQUETE (BUNDLE)
exports.deleteBundle = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Verificamos que el paquete exista y pertenezca a este creador
    const bundle = await prisma.bundle.findFirst({
      where: { id, creatorId: userId }
    });

    if (!bundle) {
      return res.status(404).json({ error: 'Paquete no encontrado o no autorizado' });
    }

    // Lo eliminamos de la base de datos
    await prisma.bundle.delete({
      where: { id }
    });

    res.status(200).json({ message: 'Paquete eliminado con éxito' });
  } catch (error) {
    console.error('Error al eliminar paquete:', error);
    res.status(500).json({ error: 'Error del servidor al eliminar' });
  }
};