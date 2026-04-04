// backend/controllers/seriesController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { cloudinary } = require('../utils/cloudinaryConfig');
const fs = require('fs');

// ==========================================
// 1. CREAR UNA NUEVA SERIE (CURSO)
// ==========================================
exports.createSeries = async (req, res) => {
  try {
    const creatorId = req.user.userId;
    const { title, description, price } = req.body;

    if (!title || price === undefined) {
      return res.status(400).json({ error: 'Falta el título o el precio de la serie.' });
    }

    let thumbnailUrl = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, { folder: "fansmio_series" });
      thumbnailUrl = result.secure_url;
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    const newSeries = await prisma.series.create({
      data: {
        title,
        description,
        price: parseFloat(price),
        thumbnail: thumbnailUrl,
        creatorId
      }
    });

    res.status(201).json({ message: 'Serie creada con éxito 🎬', series: newSeries });
  } catch (error) {
    console.error("Error al crear serie:", error);
    res.status(500).json({ error: 'Error interno al crear el curso.' });
  }
};

// ==========================================
// 2. SUBIR UN EPISODIO A LA SERIE
// ==========================================
exports.addEpisode = async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { title, description, order } = req.body;
    const creatorId = req.user.userId;

    // Verificar que la serie le pertenece al creador
    const series = await prisma.series.findUnique({ where: { id: seriesId } });
    if (!series || series.creatorId !== creatorId) {
      return res.status(403).json({ error: 'No tienes permiso para modificar esta serie.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Debes adjuntar un video para el episodio.' });
    }

    // Subir video a Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, { folder: "fansmio_episodes", resource_type: "video" });
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    const newEpisode = await prisma.seriesEpisode.create({
      data: {
        title,
        description,
        mediaUrl: result.secure_url,
        order: parseInt(order) || 0,
        seriesId
      }
    });

    res.status(201).json({ message: 'Episodio agregado con éxito 🚀', episode: newEpisode });
  } catch (error) {
    console.error("Error al subir episodio:", error);
    res.status(500).json({ error: 'Error interno al subir el video.' });
  }
};

// ==========================================
// 3. OBTENER LAS SERIES PARA EL PERFIL DEL CREADOR
// ==========================================
exports.getCreatorSeries = async (req, res) => {
  try {
    const { username } = req.params;
    const viewerId = req.user?.userId; // Puede ser undefined si no ha iniciado sesión

    const creator = await prisma.user.findUnique({ where: { username } });
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado.' });

    // Traer todas las series del creador con sus episodios
    const series = await prisma.series.findMany({
      where: { creatorId: creator.id },
      include: {
        episodes: { orderBy: { order: 'asc' } },
        purchases: viewerId ? { where: { fanId: viewerId } } : false
      },
      orderBy: { createdAt: 'desc' }
    });

    // Formatear la respuesta para ocultar los videos si no han pagado
    const secureSeries = series.map(s => {
      const isOwner = creator.id === viewerId;
      const hasPurchased = viewerId && s.purchases && s.purchases.length > 0;
      const isUnlocked = isOwner || hasPurchased || s.price === 0;

      return {
        id: s.id,
        title: s.title,
        description: s.description,
        price: s.price,
        thumbnail: s.thumbnail,
        isUnlocked: isUnlocked,
        // Si no ha pagado, enviamos los títulos pero OCULTAMOS las URLs de los videos
        episodes: s.episodes.map(ep => ({
          id: ep.id,
          title: ep.title,
          description: ep.description,
          order: ep.order,
          mediaUrl: isUnlocked ? ep.mediaUrl : null 
        }))
      };
    });

    res.status(200).json({ series: secureSeries });
  } catch (error) {
    console.error("Error obteniendo series:", error);
    res.status(500).json({ error: 'Error al cargar los cursos.' });
  }
};

// ==========================================
// 4. COMPRAR SERIE (INTEGRACIÓN CON COVRA PAY)
// ==========================================
exports.buySeries = async (req, res) => {
  const fanId = req.user.userId;
  const { seriesId } = req.params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Validar Serie
      const series = await tx.series.findUnique({ where: { id: seriesId } });
      if (!series) throw new Error('Serie no encontrada.');

      // 2. Verificar compra previa
      const existingPurchase = await tx.seriesPurchase.findUnique({
        where: { seriesId_fanId: { seriesId, fanId } }
      });
      if (existingPurchase) throw new Error('Ya tienes acceso a este curso.');

      // 3. Cargar Billetera
      const fanWallet = await tx.wallet.findUnique({ where: { userId: fanId } });

      if (!fanWallet || fanWallet.balance < series.price) {
        throw new Error('Saldo insuficiente en Covra Pay.');
      }

      // 4. CÁLCULOS FINANCIEROS
      const price = parseFloat(series.price);
      const platformFee = parseFloat((price * 0.10).toFixed(2)); // 10% comisión
      const creatorEarnings = parseFloat((price - platformFee).toFixed(2));

      // A) DESCUENTO AL FAN
      await tx.wallet.update({
        where: { userId: fanId },
        data: { balance: { decrement: price } }
      });

      // B) PAGO AL CREADOR (Saldo Pendiente)
      await tx.wallet.update({
        where: { userId: series.creatorId },
        data: { pendingBalance: { increment: creatorEarnings } }
      });

      // C) REGISTRO DE ACCESO
      const purchase = await tx.seriesPurchase.create({
        data: { seriesId, fanId, pricePaid: price }
      });

      // D) GENERAR RECIBOS (¡100% ALINEADOS A TU SCHEMA! 🚨)
      
      // Recibo para el Fan (Gasto)
      await tx.transaction.create({
        data: {
          senderId: fanId,
          receiverId: series.creatorId,
          amount: -price,
          type: 'BUNDLE', // Usamos BUNDLE porque está en tu enum
          status: 'COMPLETED',
          attachedMessage: `Compra de academia VIP: ${series.title}`,
          platformFee: 0,
          netAmount: -price
        }
      });

      // Recibo para el Creador (Ingreso)
      await tx.transaction.create({
        data: {
          senderId: fanId,
          receiverId: series.creatorId,
          amount: price,
          type: 'BUNDLE', // Usamos BUNDLE porque está en tu enum
          status: 'PENDING',
          attachedMessage: `Venta de academia VIP: ${series.title}`,
          platformFee: platformFee,
          netAmount: creatorEarnings
        }
      });

      // E) NOTIFICACIÓN AL CREADOR
      await tx.notification.create({
        data: {
          userId: series.creatorId,
          type: 'SALE',
          content: `¡Felicidades! Alguien compró tu curso "${series.title}". Ganaste $${creatorEarnings} USD.`
        }
      });

      return purchase;
    });

    res.status(200).json({ message: '¡Compra exitosa! 🔓', purchase: result });

  } catch (error) {
    console.error("🚨 ERROR FINANCIERO:", error.message);
    res.status(400).json({ error: error.message || 'Error al procesar el pago.' });
  }
};