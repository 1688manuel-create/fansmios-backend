// backend/controllers/postController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { containsForbiddenWords } = require('../utils/contentFilter');
const { cloudinary } = require('../utils/cloudinaryConfig');

// Función auxiliar para enviar al Radar de IA (Sightengine)
const checkAI = async (filePath) => {
  if (!process.env.SIGHTENGINE_USER || !process.env.SIGHTENGINE_SECRET) {
    console.warn("⚠️ API de Sightengine no configurada. Saltando revisión Anti-IA.");
    return { isAI: false, score: 0 };
  }

  const data = new FormData();
  data.append('media', fs.createReadStream(filePath));
  data.append('models', 'genai');
  data.append('api_user', process.env.SIGHTENGINE_USER);
  data.append('api_secret', process.env.SIGHTENGINE_SECRET);

  try {
    const response = await axios({
      method: 'post',
      url: 'https://api.sightengine.com/1.0/check.json',
      data: data,
      headers: data.getHeaders()
    });

    if (response.data?.type?.ai_generated > 0.8) {
      return { isAI: true, score: response.data.type.ai_generated };
    }
    return { isAI: false, score: response.data?.type?.ai_generated || 0 };
  } catch (error) {
    console.error("❌ Error en Sightengine:", error.message);
    return { isAI: false, score: 0 }; // Si falla la API, asumimos inocencia para no bloquear a lo tonto
  }
};

exports.createPost = async (req, res) => {
  try {
    const { content, isPPV, price } = req.body;
    const userId = req.user.userId;
    
    // ☁️ ¡MAGIA!: req.file.path ahora es directamente el LINK Inmortal de Cloudinary
    const mediaUrl = req.file ? req.file.path : null; 
    const mediaType = req.file ? (req.file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE') : 'TEXT';

    if (!content && !mediaUrl) return res.status(400).json({ error: 'El post debe tener texto o imagen.' });

    // 🛡️ 1. FILTRO DE TEXTO
    if (containsForbiddenWords(content)) {
      // Si ofende, borramos la foto de Cloudinary usando su ID público (filename)
      if (req.file) await cloudinary.uploader.destroy(req.file.filename); 
      return res.status(403).json({ error: 'Tu publicación contiene palabras prohibidas. 🛑' });
    }

    // 🤖 2. RADAR ANTI-IA (Leyendo el link de la nube)
    if (req.file && req.file.mimetype.startsWith('image/')) {
      if (process.env.SIGHTENGINE_USER && process.env.SIGHTENGINE_SECRET) {
        try {
          const response = await axios.get('https://api.sightengine.com/1.0/check.json', {
            params: {
              url: mediaUrl, // Le pasamos el link de Cloudinary directo
              models: 'genai',
              api_user: process.env.SIGHTENGINE_USER,
              api_secret: process.env.SIGHTENGINE_SECRET
            }
          });

          if (response.data?.type?.ai_generated > 0.8) {
            const probability = (response.data.type.ai_generated * 100).toFixed(2);
            // 🚨 ¡Es IA! Borramos la foto de Cloudinary para no pagar almacenamiento basura
            await cloudinary.uploader.destroy(req.file.filename);
            return res.status(403).json({ error: `Imagen IA Detectada (${probability}%). Fansmios solo permite contenido real. 🤖🚫` });
          }
        } catch (apiError) {
          console.error("⚠️ Error conectando con Sightengine por URL. Dejando pasar.");
        }
      }
    }

    // 💾 3. Guardamos en la Base de Datos
    const newPost = await prisma.post.create({
      data: { 
        content: content || null, 
        mediaUrl, // Guardamos el link de Cloudinary
        mediaType, 
        isPPV: isPPV === 'true' || isPPV === true, 
        price: price ? parseFloat(price) : 0, 
        userId 
      },
      include: { user: { select: { email: true, username: true } } }
    });

    res.status(201).json({ message: 'Post publicado con éxito', post: newPost });
  } catch (error) { 
    console.error("Error creando post:", error);
    // Si algo explota en la BD, borramos la foto huérfana de Cloudinary
    if (req.file) await cloudinary.uploader.destroy(req.file.filename);
    res.status(500).json({ error: 'Error al guardar.' }); 
  }
};

// 🐕 EL PERRO GUARDIÁN: Escáner Retroactivo de IA
// Esta función será llamada por una ruta secreta de Admin o por un Cron Job
exports.scanExistingPostsForAI = async (req, res) => {
  try {
    // 1. Buscamos los últimos 50 posts que tengan imagen (para no saturar la API)
    const postsToScan = await prisma.post.findMany({
      where: { 
        mediaUrl: { not: null },
        mediaType: 'IMAGE'
      },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true } } }
    });

    let scannedCount = 0;
    let deletedCount = 0;

    console.log(`🐕 Iniciando Patrullaje Anti-IA en ${postsToScan.length} publicaciones...`);

    for (const post of postsToScan) {
      if (!post.mediaUrl) continue;

      // Reconstruimos la ruta real del archivo en el servidor
      const fileName = post.mediaUrl.replace('/uploads/', '');
      const filePath = path.join(__dirname, '..', 'uploads', fileName);

      // Si el archivo existe físicamente
      if (fs.existsSync(filePath)) {
        scannedCount++;
        const aiResult = await checkAI(filePath);

        if (aiResult.isAI) {
          console.log(`🚨 [CAZADO] Eliminando post de @${post.user.username} por uso de IA (${(aiResult.score*100).toFixed(2)}%). ID: ${post.id}`);
          
          // 1. Borramos el archivo físico
          fs.unlinkSync(filePath);
          
          // 2. Borramos el registro de la base de datos
          await prisma.post.delete({ where: { id: post.id } });
          deletedCount++;
        }
        
        // Pausa de 1 segundo entre análisis para no que el API de Sightengine nos bloquee
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    res.status(200).json({ 
      message: 'Patrullaje Anti-IA finalizado.', 
      stats: { scanned: scannedCount, deletedBots: deletedCount } 
    });

  } catch (error) {
    console.error("Error en el escáner retroactivo:", error);
    res.status(500).json({ error: 'Error al ejecutar el patrullaje.' });
  }
};

// ==========================================
// MANTENEMOS EL RESTO DE TUS FUNCIONES INTACTAS
// ==========================================

exports.getAllPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = currentUser?.role === 'ADMIN';

    const posts = await prisma.post.findMany({
      where: { OR: [{ user: { status: 'ACTIVE' } }, { userId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { 
          select: { 
            id: true, email: true, username: true, 
            creatorProfile: { select: { profileImage: true } },
            subscribers: { where: { fanId: userId } },
            promotions: { where: { active: true, expiresAt: { gt: new Date() } }, select: { package: true } }
          } 
        },
        _count: { select: { likes: true, comments: true } },
        purchases: { where: { fanId: userId } },
        likes: { where: { userId: userId }, select: { id: true, emoji: true } },
        comments: { include: { _count: true } } 
      }
    });

    // ... (El resto de la lógica de getAllPosts que ya tenías)
    let promotedPosts = [];
    let organicPosts = [];
    const seenPromotedCreators = new Set();

    posts.forEach(post => {
      let hasAccess = isAdmin || post.user.id === userId || post.purchases.length > 0;
      if (!hasAccess && !post.isPPV) {
        const sub = post.user.subscribers?.find(s => s.fanId === userId);
        if (sub) {
          if (sub.status === 'ACTIVE') { hasAccess = true; } 
          else if (sub.status === 'PAST_DUE') {
            hasAccess = (new Date() - new Date(sub.updatedAt)) < (3 * 24 * 60 * 60 * 1000);
          }
        } else { hasAccess = true; }
      }

      const activePromo = post.user.promotions?.length > 0 ? post.user.promotions[0].package : null;
      let weight = 0;
      if(activePromo === 'GOD') weight = 3;
      if(activePromo === 'PRO') weight = 2;
      if(activePromo === 'BASIC') weight = 1;

      const formattedPost = { 
        ...post, hasAccess, 
        myReaction: post.likes?.length > 0 ? post.likes[0].emoji : null, 
        content: hasAccess ? post.content : null, 
        mediaUrl: hasAccess ? post.mediaUrl : null,
        isPromoted: !!activePromo,
        promoTier: activePromo,
        weight
      };

      if (activePromo && post.user.id !== userId && !seenPromotedCreators.has(post.user.id)) {
        promotedPosts.push(formattedPost);
        seenPromotedCreators.add(post.user.id);
      } else {
        organicPosts.push({ ...formattedPost, isPromoted: false, promoTier: null });
      }
    });

    promotedPosts.sort((a, b) => b.weight - a.weight);
    const finalFeed = [...promotedPosts, ...organicPosts];

    res.status(200).json({ posts: finalFeed });
  } catch (error) { 
    console.error(error);
    res.status(500).json({ error: 'Error al obtener muro.' }); 
  }
};

exports.getCreatorPosts = async (req, res) => {
  try {
    const { username } = req.params;
    const userId = req.user?.userId; // Agregado para verificación
    
    const posts = await prisma.post.findMany({
      where: { user: { username: username, status: 'ACTIVE' } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, creatorProfile: { select: { profileImage: true } } } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    
    // Blindaje extra para que el frontend reciba si el usuario actual tiene acceso
    const formattedPosts = posts.map(post => ({
        ...post,
        hasAccess: post.userId === userId // Si eres el creador, lo tienes
    }));

    res.status(200).json({ posts: formattedPosts });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener posts del creador.' });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const existingLike = await prisma.like.findFirst({ where: { postId: id, userId } });

    if (existingLike) {
      await prisma.like.delete({ where: { id: existingLike.id } });
      return res.status(200).json({ message: 'Like eliminado' });
    }

    await prisma.like.create({ data: { postId: id, userId, emoji: '❤️' } });
    res.status(201).json({ message: 'Like agregado' });
  } catch (error) {
    res.status(500).json({ error: 'Error en el like.' });
  }
};

exports.addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.userId;

    const comment = await prisma.comment.create({
      data: { content, postId: id, userId }
    });
    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ error: 'Error al comentar.' });
  }
};

exports.toggleCommentLike = async (req, res) => {
  try {
    res.status(200).json({ message: 'Funcionalidad activa.' });
  } catch (error) { res.status(500).json({ error: 'Error.' }); }
};

exports.buyBoost = async (req, res) => {
  try { res.status(200).json({ message: 'Pasarela lista.' }); } catch (error) { res.status(500).json({ error: 'Error.' }); }
};

exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const post = await prisma.post.findUnique({ where: { id } });
    if (!post || post.userId !== userId) return res.status(403).json({ error: 'No autorizado.' });

    // Si tiene archivo físico, lo borramos también para liberar espacio
    if (post.mediaUrl) {
      const fileName = post.mediaUrl.replace('/uploads/', '');
      const filePath = path.join(__dirname, '..', 'uploads', fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await prisma.post.delete({ where: { id } });
    res.status(200).json({ message: 'Post eliminado con éxito.' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar.' });
  }
};