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
  console.log("⚠️ Archivo de filtro de palabras no encontrado...");
}

// 🔥 RADAR ESTRICTO (IA Moderation)
const scanContentStrict = async (filePath, mimetype) => {
  if (!process.env.SIGHTENGINE_USER || !process.env.SIGHTENGINE_SECRET) return { isSafe: true, reason: null };
  try {
    const isVideo = mimetype && mimetype.startsWith('video/');
    const isUrl = filePath.startsWith('http');
    const endpoint = 'https://api.sightengine.com/1.0/check.json';
    const activeModels = 'gore,wad,genai'; 

    let targetUrl = filePath;
    if (isVideo && isUrl) targetUrl = filePath.replace(/\.(mp4|mov|webm)$/i, '.jpg');

    let response;
    if (isUrl) {
      response = await axios.get(endpoint, {
        params: { models: activeModels, api_user: process.env.SIGHTENGINE_USER, api_secret: process.env.SIGHTENGINE_SECRET, url: targetUrl }
      });
    } else {
      if (isVideo) return { isSafe: true, reason: null };
      const data = new FormData();
      data.append('models', activeModels); 
      data.append('api_user', process.env.SIGHTENGINE_USER);
      data.append('api_secret', process.env.SIGHTENGINE_SECRET);
      data.append('media', fs.createReadStream(filePath));
      response = await axios({ method: 'post', url: endpoint, data: data, headers: data.getHeaders() });
    }

    const result = response.data;
    const threshold = 0.8;
    if ((result.wad?.weapon || 0) > threshold) return { isSafe: false, reason: "Armas detectadas" };
    if ((result.gore?.prob || 0) > threshold) return { isSafe: false, reason: "Violencia detectada" };
    if ((result.type?.ai_generated || 0) > threshold) return { isSafe: false, reason: "IA / Deepfake detectado" };

    return { isSafe: true, reason: null };
  } catch (error) { return { isSafe: true, reason: null }; }
};

// ==========================================
// 1. CREAR PUBLICACIÓN (Soporta 5 imágenes o 1 video) BLINDADO 🛡️
// ==========================================
exports.createPost = async (req, res) => {
  try {
    const { content, isPPV, price } = req.body;
    const userId = req.user.userId;
    const files = req.files || (req.file ? [req.file] : []);
    
    let mediaUrls = [];
    let mediaType = 'TEXT';

    if (files.length > 0) {
      const hasVideo = files.some(f => f.mimetype.startsWith('video/'));
      if (hasVideo && files.length > 1) {
        files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(400).json({ error: 'Solo puedes subir 1 video por publicación.' });
      }
      if (files.length > 5) {
        files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        return res.status(400).json({ error: 'Máximo 5 imágenes permitidas.' });
      }

      mediaType = hasVideo ? 'VIDEO' : 'IMAGE';

      for (const file of files) {
        // 1. Escanear con Sightengine
        const scanResult = await scanContentStrict(file.path, file.mimetype);
        if (!scanResult.isSafe) {
          files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
          return res.status(403).json({ error: `Bloqueado: ${scanResult.reason}` });
        }

        // 🔥 2. SUBIR A CLOUDINARY (El paso que faltaba)
        const uploadResult = await cloudinary.uploader.upload(file.path, {
          folder: 'fansmio_uploads',
          resource_type: hasVideo ? 'video' : 'image'
        });

        // 3. Guardar la URL real de la nube, no la ruta local
        mediaUrls.push(uploadResult.secure_url);

        // 4. Limpiar el archivo del disco duro del servidor para ahorrar espacio
        if(fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    if (!content && mediaUrls.length === 0) return res.status(400).json({ error: 'El post está vacío.' });
    if (content && containsForbiddenWords(content)) return res.status(403).json({ error: 'Contenido prohibido.' });

    // 🔥 FIX: Guardar el texto directo (mediaUrls[0]) si es 1, o convertir a JSON si son varias
    const finalMediaUrl = mediaUrls.length > 1 ? JSON.stringify(mediaUrls) : (mediaUrls.length === 1 ? mediaUrls[0] : null);

    const newPost = await prisma.post.create({
      data: { 
        content: content || null, 
        mediaUrl: finalMediaUrl, 
        mediaType, 
        isPPV: isPPV === 'true' || isPPV === true, 
        price: price ? parseFloat(price) : 0, 
        userId 
      },
      include: { user: { select: { username: true } } }
    });
    
    res.status(201).json({ message: 'Publicado exitosamente ⚡', post: newPost });
  } catch (error) { 
    console.error("🔥 ERROR CRÍTICO AL PUBLICAR:", error); // <-- Para ver qué pasa en Coolify
    res.status(500).json({ error: 'Fallo al publicar.' }); 
  }
};

// ==========================================
// 2. OBTENER MURO (ALGORITMO DE JERARQUÍA VIP 👑)
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
            id: true, username: true, 
            creatorProfile: { select: { profileImage: true } }, 
            subscribers: { where: { fanId: userId } },
            // 🔥 CLAVE: Traemos solo la promoción más poderosa y activa
            promotions: { where: { active: true, expiresAt: { gt: new Date() } }, take: 1, orderBy: { package: 'desc' } }
          } 
        },
        _count: { select: { comments: true } },
        purchases: { where: { fanId: userId } },
        likes: { select: { emoji: true, userId: true } }, 
        comments: { 
          include: { user: { select: { username: true, id: true, creatorProfile: { select: { profileImage: true } } } } }, 
          orderBy: { createdAt: 'asc' } 
        } 
      }
    });

    let promotedPosts = [];
    let organicPosts = [];

    posts.forEach(post => {
      // Control de acceso
      let hasAccess = isAdmin || post.user.id === userId || post.purchases.length > 0;
      if (!hasAccess && !post.isPPV) {
        const sub = post.user.subscribers?.[0];
        if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) hasAccess = true;
        else hasAccess = true; // Por ahora abierto, ajustar según tu regla de suscripción
      }

      // 🔥 MOTOR DE PESOS (Jerarquía de Pago)
      // Prisma devuelve un array en promotions, extraemos el primero
      const promoData = post.user.promotions?.[0];
      const activePromo = promoData ? promoData.package : null;
      
      let weight = 0;
      if (activePromo === 'GOD') weight = 3; 
      else if (activePromo === 'PRO') weight = 2; 
      else if (activePromo === 'BASIC') weight = 1;

      const myReactionObj = post.likes.find(l => l.userId === userId);
      const reactionCounts = { '❤️': 0, '❤️‍🔥': 0, '🤤': 0, '🫦': 0 };
      post.likes.forEach(l => { if (reactionCounts[l.emoji] !== undefined) reactionCounts[l.emoji]++; });

      const formattedPost = { 
        ...post, hasAccess, 
        myReaction: myReactionObj ? myReactionObj.emoji : null, 
        reactionCounts,
        content: hasAccess ? post.content : null, 
        isPromoted: !!activePromo, 
        promoTier: activePromo, 
        weight
      };

      // Si tiene pago, va a la fila VIP (solo si no es el propio usuario para evitar spam)
      if (weight > 0 && post.userId !== userId) {
        promotedPosts.push(formattedPost);
      } else {
        organicPosts.push(formattedPost);
      }
    });

    // 👑 ORDENAR EL TRONO: GOD primero, luego PRO, luego BASIC
    promotedPosts.sort((a, b) => b.weight - a.weight);

    res.status(200).json({ posts: [...promotedPosts, ...organicPosts] });
  } catch (error) { 
    console.error(error);
    res.status(500).json({ error: 'Error en el algoritmo del feed.' }); 
  }
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
        likes: { select: { emoji: true, userId: true } },
        purchases: { where: { fanId: userId } },
        comments: { 
          include: { user: { select: { username: true, id: true, creatorProfile: { select: { profileImage: true } } } } }, 
          orderBy: { createdAt: 'asc' } 
        } 
      }
    });
    
    let isSubscribed = false; // 🔥 VARIABLE RECUPERADA

    const formattedPosts = posts.map(post => {
      // 🔥 EVALUAMOS SUSCRIPCIÓN ANTES DE REVISAR ACCESO
      if (post.user?.subscribers?.length > 0) isSubscribed = true;
      
      const hasAccess = post.userId === userId || post.purchases?.length > 0 || (isSubscribed && !post.isPPV);
      const myReactionObj = post.likes.find(l => l.userId === userId);
      const reactionCounts = { '❤️': 0, '❤️‍🔥': 0, '🤤': 0, '🫦': 0 };
      post.likes.forEach(l => { if (reactionCounts[l.emoji] !== undefined) reactionCounts[l.emoji]++; });
      
      return { ...post, hasAccess, myReaction: myReactionObj ? myReactionObj.emoji : null, reactionCounts, content: hasAccess ? post.content : null };
    });

    // 🔥 DEVOLVEMOS LA VARIABLE PARA QUE EL BOTÓN NO SE REGRESE
    res.status(200).json({ posts: formattedPosts, isSubscribed });
  } catch (error) { res.status(500).json({ error: 'Error.' }); }
};

exports.toggleLike = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    const userId = req.user.userId;
    const post = await prisma.post.findUnique({ where: { id }, include: { user: { select: { id: true, username: true } } } });
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
        data: { userId: post.userId, type: 'LIKE', content: `@${fan.username} reaccionó con ${emoji || '❤️'}.`, link: `/feed#post-${post.id}` }
      });
    }
    res.status(201).json({ message: 'Like agregado' });
  } catch (error) { res.status(500).json({ error: 'Error.' }); }
};

exports.addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, parentId } = req.body; 
    const userId = req.user.userId;
    const post = await prisma.post.findUnique({ where: { id }, include: { user: { select: { id: true, username: true } } } });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    const fan = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const comment = await prisma.comment.create({ data: { content, postId: id, userId, parentId: parentId || null } });

    if (parentId) {
      const parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
      if (parentComment && parentComment.userId !== userId) {
        await prisma.notification.create({
          data: { userId: parentComment.userId, type: 'REPLY', content: `@${fan.username} respondió a tu comentario.`, link: `/feed#post-${post.id}-comment-${comment.id}` }
        });
      }
    } 
    if (post.userId !== userId) {
      await prisma.notification.create({
        data: { userId: post.userId, type: 'COMMENT', content: `@${fan.username} comentó en tu post.`, link: `/feed#post-${post.id}-comment-${comment.id}` }
      });
    }
    res.status(201).json(comment);
  } catch (error) { res.status(500).json({ error: 'Error al comentar.' }); }
};

exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post || post.userId !== userId) return res.status(403).json({ error: 'No autorizado.' });
    if (post.mediaUrl && post.mediaUrl.includes('cloudinary.com')) {
       // Si es JSON, borrar todos, si es string, borrar uno
       let urls = [];
       try { urls = JSON.parse(post.mediaUrl); if(!Array.isArray(urls)) urls = [post.mediaUrl]; } catch(e) { urls = [post.mediaUrl]; }
       for (const url of urls) {
         const parts = url.split('/');
         const publicId = 'fansmio_uploads/' + parts[parts.length - 1].split('.'); 
         await cloudinary.uploader.destroy(publicId).catch(() => {});
       }
    }
    await prisma.post.delete({ where: { id } });
    res.status(200).json({ message: 'Aniquilado.' });
  } catch (error) { res.status(500).json({ error: 'Error.' }); }
};

exports.deleteComment = async (req, res) => {
  try {
    const { id } = req.params; 
    const userId = req.user.userId;
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment || comment.userId !== userId) return res.status(403).json({ error: 'No autorizado' });
    await prisma.comment.delete({ where: { id } });
    res.status(200).json({ message: 'Eliminado.' });
  } catch (error) { res.status(500).json({ error: 'Error.' }); }
};

exports.toggleCommentLike = async (req, res) => { res.status(200).json({ message: 'Ok' }); };
exports.buyBoost = async (req, res) => { res.status(200).json({ message: 'Ok' }); };