// backend/controllers/seriesController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { cloudinary } = require('../utils/cloudinaryConfig');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

// 🔥 NUEVO RADAR ESTRICTO (Hack para Plan Gratuito usando Cloudinary)
const scanContentStrict = async (filePath, mimetype) => {
  if (!process.env.SIGHTENGINE_USER || !process.env.SIGHTENGINE_SECRET) {
    console.log("⚠️ RADAR APAGADO: Faltan credenciales SIGHTENGINE_USER / SECRET.");
    return { isSafe: true, reason: null };
  }

  try {
    const isVideo = mimetype && mimetype.startsWith('video/');
    const isUrl = filePath.startsWith('http');
    
    // SIEMPRE usaremos el endpoint de imágenes (check.json) porque es el gratuito.
    const endpoint = 'https://api.sightengine.com/1.0/check.json';
    const activeModels = 'gore,wad,genai'; 

    let targetUrl = filePath;

    // 🔥 EL TRUCO DE MAGIA: Si es un video de Cloudinary, le cambiamos la extensión a .jpg
    if (isVideo && isUrl) {
      targetUrl = filePath.replace(/\.(mp4|mov|webm)$/i, '.jpg');
      console.log(`📸 Extrayendo fotograma VIP para escaneo gratuito: ${targetUrl}`);
    }

    let response;

    if (isUrl) {
      // 📡 ESCANEO VÍA URL (Cloudinary)
      response = await axios.get(endpoint, {
        params: {
          models: activeModels,
          api_user: process.env.SIGHTENGINE_USER,
          api_secret: process.env.SIGHTENGINE_SECRET,
          url: targetUrl 
        }
      });
    } else {
      // 📂 ESCANEO LOCAL (Funciona para la portada del curso que es imagen)
      if (isVideo) {
        console.log("⚠️ Archivo de video local detectado. Se salta el escaneo en el plan gratuito.");
        return { isSafe: true, reason: null };
      }

      const data = new FormData();
      data.append('models', activeModels); 
      data.append('api_user', process.env.SIGHTENGINE_USER);
      data.append('api_secret', process.env.SIGHTENGINE_SECRET);
      data.append('media', fs.createReadStream(filePath));

      response = await axios({
        method: 'post',
        url: endpoint,
        data: data,
        headers: data.getHeaders()
      });
    }

    const result = response.data;
    const threshold = 0.8;

    const weaponScore = result.wad?.weapon || 0; 
    const goreScore = result.gore?.prob || result.gore || 0;
    const aiScore = result.type?.ai_generated || 0;

    if (weaponScore > threshold) return { isSafe: false, reason: "Armas de fuego detectadas" };
    if (goreScore > threshold) return { isSafe: false, reason: "Violencia extrema detectada" };
    if (aiScore > threshold) return { isSafe: false, reason: "Contenido generado por IA (Deepfake)" };

    return { isSafe: true, reason: null };
  } catch (error) {
    console.error("⚠️ Error conectando con Sightengine:", error.response?.data || error.message);
    return { isSafe: true, reason: null }; 
  }
};


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

    // 🛡️ ESCANEO DE LA PORTADA (Como es imagen, el escaneo local funciona perfecto)
    if (req.file) {
      const scanResult = await scanContentStrict(req.file.path, req.file.mimetype);
      if (!scanResult.isSafe) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: `Portada bloqueada: ${scanResult.reason}. 🚫` });
      }
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
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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

    const series = await prisma.series.findUnique({ where: { id: seriesId } });
    if (!series || series.creatorId !== creatorId) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'No tienes permiso para modificar esta serie.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Debes adjuntar un video para el episodio.' });
    }

    // 1. Subir video a Cloudinary PRIMERO para poder usar el Hack del .jpg
    const result = await cloudinary.uploader.upload(req.file.path, { folder: "fansmio_episodes", resource_type: "video" });
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    // 2. 🛡️ ESCANEO DEL VIDEO (Evita IAs y contenido ilegal en los cursos VIP)
    console.log(`🔍 Escaneando episodio VIP: ${result.secure_url}`);
    const scanResult = await scanContentStrict(result.secure_url, req.file.mimetype);
    
    if (!scanResult.isSafe) {
      // Si es ilegal/IA, lo borramos de Cloudinary inmediatamente
      await cloudinary.uploader.destroy(result.public_id, { resource_type: 'video' }).catch(()=>console.log("No se pudo borrar de Cloudinary"));
      return res.status(403).json({ error: `Episodio bloqueado: ${scanResult.reason}. 🚫` });
    }

    // 3. Si todo está limpio, lo guardamos en la base de datos
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
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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
    const viewerId = req.user?.userId;

    const creator = await prisma.user.findUnique({ where: { username } });
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado.' });

    const series = await prisma.series.findMany({
      where: { creatorId: creator.id },
      include: {
        episodes: { orderBy: { order: 'asc' } },
        purchases: viewerId ? { where: { fanId: viewerId } } : false
      },
      orderBy: { createdAt: 'desc' }
    });

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
// 4. COMPRAR SERIE (INTEGRACIÓN CON COVRA PAY Y MODO DIOS)
// ==========================================
exports.buySeries = async (req, res) => {
  const fanId = req.user.userId;
  const { seriesId } = req.params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const series = await tx.series.findUnique({ where: { id: seriesId } });
      if (!series) throw new Error('Serie no encontrada.');

      const existingPurchase = await tx.seriesPurchase.findUnique({
        where: { seriesId_fanId: { seriesId, fanId } }
      });
      if (existingPurchase) throw new Error('Ya tienes acceso a este curso.');

      const fanWallet = await tx.wallet.findUnique({ where: { userId: fanId } });
      if (!fanWallet || fanWallet.balance < series.price) {
        throw new Error('Saldo insuficiente en Covra Pay.');
      }

      // 👑 MODO DIOS: Leer la comisión de la base de datos (Usamos el fee de PPV para los cursos)
      // 🔥 CORREGIDO: Usando 'platformSetting' en singular y 'findUnique'
      const settings = await tx.platformSetting.findUnique({ where: { id: 'global_settings' } }) || { feePPV: 20 };
      const feePercent = settings.feePPV / 100;

      // 4. CÁLCULOS FINANCIEROS DINÁMICOS
      const price = parseFloat(series.price);
      const platformFee = parseFloat((price * feePercent).toFixed(2)); // Ahora usa el porcentaje del panel
      const creatorEarnings = parseFloat((price - platformFee).toFixed(2));

      await tx.wallet.update({
        where: { userId: fanId },
        data: { balance: { decrement: price } }
      });

      await tx.wallet.upsert({
        where: { userId: series.creatorId },
        update: { pendingBalance: { increment: creatorEarnings } },
        create: { 
          userId: series.creatorId, 
          balance: 0, 
          pendingBalance: creatorEarnings 
        }
      });

      const purchase = await tx.seriesPurchase.create({
        data: { seriesId, fanId, pricePaid: price }
      });

      await tx.transaction.create({
        data: { senderId: fanId, receiverId: series.creatorId, amount: -price, type: 'BUNDLE', status: 'COMPLETED', attachedMessage: `Compra: ${series.title}`, platformFee: 0, netAmount: -price }
      });

      // 🔥 AQUÍ SE REGISTRA LA COMISIÓN EXACTA DEL MODO DIOS PARA FANSMIO
      await tx.transaction.create({
        data: { senderId: fanId, receiverId: series.creatorId, amount: price, type: 'BUNDLE', status: 'COMPLETED', attachedMessage: `Venta: ${series.title}`, platformFee: platformFee, netAmount: creatorEarnings }
      });

      await tx.transaction.create({
        data: { senderId: fanId, receiverId: series.creatorId, amount: price, type: 'BUNDLE', status: 'PENDING', attachedMessage: `Venta de academia VIP: ${series.title}`, platformFee: platformFee, netAmount: creatorEarnings }
      });

      await tx.notification.create({
        data: { userId: series.creatorId, type: 'SALE', content: `¡Felicidades! Alguien compró tu curso "${series.title}". Ganaste $${creatorEarnings} USD.` }
      });

      return purchase;
    });

    res.status(200).json({ message: '¡Compra exitosa! 🔓', purchase: result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Error al procesar el pago.' });
  }
};

// ==========================================
// 5. ELIMINAR UNA SERIE (CURSO)
// ==========================================
exports.deleteSeries = async (req, res) => {
  try {
    const { seriesId } = req.params;
    const userId = req.user.userId;

    const series = await prisma.series.findUnique({ where: { id: seriesId } });
    if (!series) return res.status(404).json({ error: 'Serie no encontrada.' });
    if (series.creatorId !== userId) return res.status(403).json({ error: 'No tienes permiso para eliminar esta serie.' });

    await prisma.series.delete({ where: { id: seriesId } });
    res.status(200).json({ success: true, message: 'Serie eliminada exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error interno al eliminar la serie.' });
  }
};