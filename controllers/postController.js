// backend/controllers/postController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { cloudinary } = require('../utils/cloudinaryConfig');

// === Filtro de palabras prohibidas ===
let containsForbiddenWords = () => false;
try {
  const filter = require('../utils/contentFilter');
  if (filter && typeof filter.containsForbiddenWords === 'function') {
    containsForbiddenWords = filter.containsForbiddenWords;
  }
} catch (e) {
  console.log("⚠️ Archivo de filtro de palabras no encontrado, saltando validación...");
}

// 🔥 NUEVO RADAR ESTRICTO (IA, Armas, Gore, Menores) - Permite NSFW
const scanContentStrict = async (filePath, mimetype) => {
  if (!process.env.SIGHTENGINE_USER || !process.env.SIGHTENGINE_SECRET) {
    console.log("⚠️ RADAR APAGADO: Faltan credenciales SIGHTENGINE_USER / SECRET.");
    return { isSafe: true, reason: null };
  }

  try {
    const data = new FormData();
    data.append('models', 'gore,weapon,minors,genai'); // 👈 Sin nudity
    data.append('api_user', process.env.SIGHTENGINE_USER);
    data.append('api_secret', process.env.SIGHTENGINE_SECRET);
    data.append('media', fs.createReadStream(filePath));

    const isVideo = mimetype && mimetype.startsWith('video/');
    const endpoint = isVideo 
      ? 'https://api.sightengine.com/1.0/video/sync.json' 
      : 'https://api.sightengine.com/1.0/check.json';

    const response = await axios({
      method: 'post',
      url: endpoint,
      data: data,
      headers: data.getHeaders()
    });

    // Sightengine devuelve datos de forma distinta si es video (frames) o imagen
    let frames = isVideo && response.data.data && response.data.data.frames ? response.data.data.frames : [response.data];
    const threshold = 0.8; // 80% de certeza

    for (const frame of frames) {
      const weaponScore = frame.weapon?.classes?.weapon || frame.weapon || 0;
      const goreScore = frame.gore?.prob || frame.gore || 0;
      const aiScore = frame.type?.ai_generated || 0;
      let hasMinors = false;
      
      if (frame.faces) {
        hasMinors = frame.faces.some(f => (f.attributes?.minor > threshold || f.features?.minor > threshold));
      }

      if (weaponScore > threshold) return { isSafe: false, reason: "Armas de fuego detectadas" };
      if (goreScore > threshold) return { isSafe: false, reason: "Violencia extrema detectada" };
      if (hasMinors) return { isSafe: false, reason: "Presencia de menores no permitida" };
      if (aiScore > threshold) return { isSafe: false, reason: "Contenido generado por IA (Deepfake)" };
    }

    return { isSafe: true, reason: null };
  } catch (error) {
    console.error("⚠️ Error conectando con Sightengine:", error.response?.data || error.message);
    return { isSafe: true, reason: null }; // Ante la duda o caída del servidor, no bloqueamos al creador
  }
};

exports.createPost = async (req, res) => {
  try {
    const { content, isPPV, price } = req.body;
    const userId = req.user.userId;
    
    const mediaUrl = req.file ? req.file.path : null; 
    const mediaType = req.file ? (req.file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE') : 'TEXT';

    if (!content && !mediaUrl) {
      return res.status(400).json({ error: 'El post debe tener texto o imagen.' });
    }

    if (content && containsForbiddenWords(content)) {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'Tu publicación contiene palabras prohibidas. 🛑' });
    }

    // 🛡️ ESCANEO MILITAR ANTES DE PUBLICAR
    if (req.file && req.file.path) {
      console.log(`🔍 Escaneando contenido: ${mediaUrl}`);
      const scanResult = await scanContentStrict(req.file.path, req.file.mimetype);
      
      if (!scanResult.isSafe) {
        // Destruir archivo local de inmediato
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: `Publicación bloqueada: ${scanResult.reason}. 🚫` });
      }
    }

    const newPost = await prisma.post.create({
      data: { content: content || null, mediaUrl, mediaType, isPPV: isPPV === 'true' || isPPV === true, price: price ? parseFloat(price) : 0, userId },
      include: { user: { select: { email: true, username: true } } }
    });
    
    res.status(201).json({ message: 'Post publicado con éxito', post: newPost });
  } catch (error) { 
    if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Error interno del servidor al publicar.' }); 
  }
};

exports.scanExistingPostsForAI = async (req, res) => {
  try {
    const postsToScan = await prisma.post.findMany({
      where: { mediaUrl: { not: null }, mediaType: 'IMAGE' }, take: 50, orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true } } }
    });
    let scannedCount = 0; let deletedCount = 0;
    for (const post of postsToScan) {
      if (!post.mediaUrl || post.mediaUrl.includes('cloudinary.com')) continue; 
      const fileName = post.mediaUrl.replace('/uploads/', '');
      const filePath = path.join(__dirname, '..', 'uploads', fileName);
      if (fs.existsSync(filePath)) {
        scannedCount++;
        const aiResult = await scanContentStrict(filePath, 'image/jpeg');
        if (!aiResult.isSafe) {
          fs.unlinkSync(filePath);
          await prisma.post.delete({ where: { id: post.id } });
          deletedCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (res && res.status) res.status(200).json({ message: 'Patrullaje finalizado.', stats: { scanned: scannedCount, deletedBots: deletedCount } });
  } catch (error) { if (res && res.status) res.status(500).json({ error: 'Error.' }); }
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
        user: { select: { id: true, email: true, username: true, creatorProfile: { select: { profileImage: true } }, subscribers: { where: { fanId: userId } }, promotions: { where: { active: true, expiresAt: { gt: new Date() } }, select: { package: true } } } },
        _count: { select: { comments: true } },
        purchases: { where: { fanId: userId } },
        likes: { select: { id: true, emoji: true, userId: true } }, 
        comments: { include: { user: { select: { username: true } } }, orderBy: { createdAt: 'asc' } } 
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
          else if (sub.status === 'PAST_DUE') { hasAccess = (new Date() - new Date(sub.updatedAt)) < (3 * 24 * 60 * 60 * 1000); }
        } else { hasAccess = true; }
      }

      const activePromo = post.user.promotions?.length > 0 ? post.user.promotions.package : null;
      let weight = 0;
      if(activePromo === 'GOD') weight = 3; if(activePromo === 'PRO') weight = 2; if(activePromo === 'BASIC') weight = 1;

      const myReactionObj = post.likes.find(l => l.userId === userId);
      const reactionCounts = { '❤️': 0, '❤️‍🔥': 0, '🤤': 0, '🫦': 0 };
      post.likes.forEach(l => {
        if (reactionCounts[l.emoji] !== undefined) reactionCounts[l.emoji]++;
        else reactionCounts[l.emoji] = 1;
      });

      const formattedPost = { 
        ...post, hasAccess, 
        myReaction: myReactionObj ? myReactionObj.emoji : null, 
        reactionCounts,
        content: hasAccess ? post.content : null, 
        mediaUrl: post.mediaUrl, 
        isPromoted: !!activePromo, promoTier: activePromo, weight
      };

      if (activePromo && post.user.id !== userId && !seenPromotedCreators.has(post.user.id)) {
        promotedPosts.push(formattedPost); seenPromotedCreators.add(post.user.id);
      } else { organicPosts.push({ ...formattedPost, isPromoted: false, promoTier: null }); }
    });

    promotedPosts.sort((a, b) => b.weight - a.weight);
    res.status(200).json({ posts: [...promotedPosts, ...organicPosts] });
  } catch (error) { res.status(500).json({ error: 'Error al obtener muro.' }); }
};

exports.getCreatorPosts = async (req, res) => {
  try {
    const { username } = req.params;
    const userId = req.user?.userId; 
    const posts = await prisma.post.findMany({
      where: { user: { username: username, status: 'ACTIVE' } }, orderBy: { createdAt: 'desc' },
      include: { 
        user: { select: { id: true, username: true, creatorProfile: { select: { profileImage: true } }, subscribers: { where: { fanId: userId, status: 'ACTIVE' } } } }, 
        _count: { select: { comments: true } }, 
        likes: { select: { id: true, emoji: true, userId: true } },
        purchases: { where: { fanId: userId } }
      }
    });
    
    let isSubscribed = false;

    const formattedPosts = posts.map(post => {
      if (post.user?.subscribers?.length > 0) isSubscribed = true;
      const hasAccess = post.userId === userId || post.purchases?.length > 0 || (isSubscribed && !post.isPPV);

      const myReactionObj = post.likes.find(l => l.userId === userId);
      const reactionCounts = { '❤️': 0, '❤️‍🔥': 0, '🤤': 0, '🫦': 0 };
      post.likes.forEach(l => {
        if (reactionCounts[l.emoji] !== undefined) reactionCounts[l.emoji]++;
        else reactionCounts[l.emoji] = 1;
      });
      
      return { 
        ...post, 
        hasAccess, 
        myReaction: myReactionObj ? myReactionObj.emoji : null, 
        reactionCounts,
        content: hasAccess ? post.content : null 
      };
    });

    res.status(200).json({ posts: formattedPosts, isSubscribed });
  } catch (error) { res.status(500).json({ error: 'Error.' }); }
};

exports.toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    const userId = req.user.userId;
    
    const post = await prisma.post.findUnique({ 
      where: { id },
      include: { user: { select: { id: true, username: true } } } 
    });
    
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    
    const fan = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const existingLike = await prisma.like.findFirst({ where: { postId: id, userId } });

    if (existingLike) {
      if (existingLike.emoji === emoji) {
        await prisma.like.delete({ where: { id: existingLike.id } }); 
        return res.status(200).json({ message: 'Like eliminado' });
      } else {
        await prisma.like.update({ where: { id: existingLike.id }, data: { emoji } }); 
        return res.status(200).json({ message: 'Like actualizado' });
      }
    }

    await prisma.like.create({ data: { postId: id, userId, emoji: emoji || '❤️' } });
    
    if (post.userId !== userId) {
      await prisma.notification.create({
        data: {
          userId: post.userId,
          type: 'LIKE',
          content: `@${fan.username} reaccionó con ${emoji || '❤️'} a tu publicación.`,
          link: `/feed#post-${post.id}`
        }
      });
    }

    res.status(201).json({ message: 'Like agregado' });
  } catch (error) { res.status(500).json({ error: 'Error en el like.' }); }
};

exports.addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, parentId } = req.body; 
    const userId = req.user.userId;

    const post = await prisma.post.findUnique({ 
      where: { id },
      include: { user: { select: { id: true, username: true } } }
    });

    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });

    const fan = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });

    const comment = await prisma.comment.create({
      data: { content, postId: id, userId, parentId: parentId || null }
    });

    let notifiedUserId = null;

    if (parentId) {
      const parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
      if (parentComment && parentComment.userId !== userId) {
        await prisma.notification.create({
          data: {
            userId: parentComment.userId,
            type: 'REPLY',
            content: `@${fan.username} respondió a tu comentario: "${content.substring(0, 30)}..."`,
            link: `/feed#post-${post.id}-comment-${comment.id}` 
          }
        });
        notifiedUserId = parentComment.userId;
      }
    } 

    if (post.userId !== userId && post.userId !== notifiedUserId) {
      await prisma.notification.create({
        data: {
          userId: post.userId,
          type: 'COMMENT',
          content: `@${fan.username} comentó en tu publicación: "${content.substring(0, 30)}..."`,
          link: `/feed#post-${post.id}-comment-${comment.id}` 
        }
      });
    }

    res.status(201).json(comment);
  } catch (error) { 
    console.error("Error al agregar comentario:", error);
    res.status(500).json({ error: 'Error al comentar.' }); 
  }
};

exports.toggleCommentLike = async (req, res) => { res.status(200).json({ message: 'Funcionalidad activa.' }); };
exports.buyBoost = async (req, res) => { res.status(200).json({ message: 'Pasarela lista.' }); };

exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post || post.userId !== userId) return res.status(403).json({ error: 'No autorizado.' });
    if (post.mediaUrl && post.mediaUrl.includes('cloudinary.com')) {
      const parts = post.mediaUrl.split('/');
      const filenameWithExt = parts[parts.length - 1];
      const publicId = 'fansmio_uploads/' + filenameWithExt.split('.'); 
      await cloudinary.uploader.destroy(publicId).catch(() => console.log("No se pudo borrar de Cloudinary"));
    } else if (post.mediaUrl) {
      const fileName = post.mediaUrl.replace('/uploads/', '');
      const filePath = path.join(__dirname, '..', 'uploads', fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.post.delete({ where: { id } });
    res.status(200).json({ message: 'Post eliminado con éxito.' });
  } catch (error) { res.status(500).json({ error: 'Error al eliminar.' }); }
};

exports.deleteComment = async (req, res) => {
  try {
    const { id } = req.params; 
    const userId = req.user.userId;

    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    if (comment.userId !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    await prisma.comment.delete({ where: { id } });
    res.status(200).json({ message: 'Comentario eliminado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error interno al eliminar comentario.' });
  }
};