// backend/controllers/postController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { cloudinary } = require('../utils/cloudinaryConfig');

// 🛡️ Importación Segura del Filtro de Palabras
let containsForbiddenWords = () => false;
try {
  const filter = require('../utils/contentFilter');
  if (filter && typeof filter.containsForbiddenWords === 'function') {
    containsForbiddenWords = filter.containsForbiddenWords;
  }
} catch (e) {
  console.log("⚠️ Archivo de filtro de palabras no encontrado, saltando validación...");
}

// Función auxiliar para enviar al Radar de IA (Sightengine)
const checkAI = async (filePath) => {
  if (!process.env.SIGHTENGINE_USER || !process.env.SIGHTENGINE_SECRET) {
    return { isAI: false, score: 0 };
  }

  try {
    const data = new FormData();
    data.append('media', fs.createReadStream(filePath));
    data.append('models', 'genai');
    data.append('api_user', process.env.SIGHTENGINE_USER);
    data.append('api_secret', process.env.SIGHTENGINE_SECRET);

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
    return { isAI: false, score: 0 }; 
  }
};

exports.createPost = async (req, res) => {
  try {
    const { content, isPPV, price } = req.body;
    const userId = req.user.userId;
    
    // ☁️ Obtenemos el link inmortal de Cloudinary de forma segura
    const mediaUrl = req.file ? req.file.path : null; 
    const mediaType = req.file ? (req.file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE') : 'TEXT';

    if (!content && !mediaUrl) {
      return res.status(400).json({ error: 'El post debe tener texto o imagen.' });
    }

    // 🛡️ 1. FILTRO DE TEXTO (Blindado)
    if (content && containsForbiddenWords(content)) {
      if (req.file && req.file.filename) {
        await cloudinary.uploader.destroy(req.file.filename).catch(() => console.log("No se pudo borrar de nube"));
      }
      return res.status(403).json({ error: 'Tu publicación contiene palabras prohibidas. 🛑' });
    }

    // 🤖 2. RADAR ANTI-IA (Leyendo el link de la nube de forma segura)
    if (req.file && req.file.mimetype.startsWith('image/')) {
      if (process.env.SIGHTENGINE_USER && process.env.SIGHTENGINE_SECRET) {
        try {
          const response = await axios.get('https://api.sightengine.com/1.0/check.json', {
            params: {
              url: mediaUrl,
              models: 'genai',
              api_user: process.env.SIGHTENGINE_USER,
              api_secret: process.env.SIGHTENGINE_SECRET
            }
          });

          if (response.data?.type?.ai_generated > 0.8) {
            const probability = (response.data.type.ai_generated * 100).toFixed(2);
            if (req.file && req.file.filename) {
              await cloudinary.uploader.destroy(req.file.filename).catch(() => console.log("No se pudo borrar de nube"));
            }
            return res.status(403).json({ error: `Imagen IA Detectada (${probability}%). Fansmios solo permite contenido real. 🤖🚫` });
          }
        } catch (apiError) {
          console.error("⚠️ Error conectando con Sightengine por URL. Dejando pasar el post.");
        }
      }
    }

    // 💾 3. Guardamos en la Base de Datos
    const newPost = await prisma.post.create({
      data: { 
        content: content || null, 
        mediaUrl, 
        mediaType, 
        isPPV: isPPV === 'true' || isPPV === true, 
        price: price ? parseFloat(price) : 0, 
        userId 
      },
      include: { user: { select: { email: true, username: true } } }
    });

    res.status(201).json({ message: 'Post publicado con éxito', post: newPost });
  } catch (error) { 
    console.error("🚨 Error crítico al crear post:", error);
    if (req.file && req.file.filename) {
      await cloudinary.uploader.destroy(req.file.filename).catch(() => console.log("Error limpiando Cloudinary post-fallo"));
    }
    res.status(500).json({ error: 'Error interno del servidor al publicar.' }); 
  }
};

// 🐕 EL PERRO GUARDIÁN: Escáner Retroactivo de IA
exports.scanExistingPostsForAI = async (req, res) => {
  try {
    const postsToScan = await prisma.post.findMany({
      where: { mediaUrl: { not: null }, mediaType: 'IMAGE' },
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true } } }
    });

    let scannedCount = 0;
    let deletedCount = 0;

    for (const post of postsToScan) {
      if (!post.mediaUrl || post.mediaUrl.includes('cloudinary.com')) continue; 

      const fileName = post.mediaUrl.replace('/uploads/', '');
      const filePath = path.join(__dirname, '..', 'uploads', fileName);

      if (fs.existsSync(filePath)) {
        scannedCount++;
        const aiResult = await checkAI(filePath);

        if (aiResult.isAI) {
          fs.unlinkSync(filePath);
          await prisma.post.delete({ where: { id: post.id } });
          deletedCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (res && res.status) {
      res.status(200).json({ message: 'Patrullaje Anti-IA finalizado.', stats: { scanned: scannedCount, deletedBots: deletedCount } });
    }
  } catch (error) {
    if (res && res.status) res.status(500).json({ error: 'Error al ejecutar el patrullaje.' });
  }
};

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
        // 🔥 FIX DE COMENTARIOS: Ahora trae el nombre del usuario y los ordena
        comments: { 
          include: { user: { select: { username: true } } },
          orderBy: { createdAt: 'asc' } 
        } 
      }
    });

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
    const userId = req.user?.userId; 
    
    const posts = await prisma.post.findMany({
      where: { user: { username: username, status: 'ACTIVE' } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, username: true, creatorProfile: { select: { profileImage: true } } } },
        _count: { select: { likes: true, comments: true } }
      }
    });
    
    const formattedPosts = posts.map(post => ({
        ...post,
        hasAccess: post.userId === userId 
    }));

    res.status(200).json({ posts: formattedPosts });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener posts del creador.' });
  }
};

exports.toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body; // 🔥 FIX LIKES: Leemos el emoji que envia el frontend
    const userId = req.user.userId;
    
    const existingLike = await prisma.like.findFirst({ where: { postId: id, userId } });

    // Si ya le dio like, se lo quitamos
    if (existingLike) {
      await prisma.like.delete({ where: { id: existingLike.id } });
      return res.status(200).json({ message: 'Like eliminado' });
    }

    // Si no tenía like, se lo creamos con el emoji especificado (o ❤️ por defecto)
    await prisma.like.create({ 
      data: { postId: id, userId, emoji: emoji || '❤️' } 
    });
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

    // 🗑️ Borrado inteligente (Nube o Local)
    if (post.mediaUrl && post.mediaUrl.includes('cloudinary.com')) {
      const parts = post.mediaUrl.split('/');
      const filenameWithExt = parts[parts.length - 1];
      const publicId = 'fansmios_uploads/' + filenameWithExt.split('.')[0]; 
      await cloudinary.uploader.destroy(publicId).catch(() => console.log("No se pudo borrar de Cloudinary"));
    } else if (post.mediaUrl) {
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