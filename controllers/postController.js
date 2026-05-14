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

// 🔥 RADAR ESTRICTO (IA Moderation) - CALIBRADO ULTRA-SENSIBLE 🎬
const scanContentStrict = async (filePath, mimetype) => {
  if (!process.env.SIGHTENGINE_USER || !process.env.SIGHTENGINE_SECRET) return { isSafe: true, reason: null };
  try {
    const isVideo = mimetype && mimetype.startsWith('video/');
    const isUrl = filePath.startsWith('http');
    const endpoint = 'https://api.sightengine.com/1.0/check.json';
    const activeModels = 'gore,wad,genai'; 

    let targetUrl = filePath;
    if (isVideo && isUrl) {
      // Truco Francotirador: Mitad del video, calidad máxima
      targetUrl = filePath.replace(/\.(mp4|mov|webm)$/i, '.jpg').replace('/upload/', '/upload/so_50p,q_100/');
      console.log(`📸 [Radar] Analizando fotograma del video: ${targetUrl}`);
    }

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
    
    // 🔥 SENSORES DIVIDIDOS:
    const standardThreshold = 0.6; // 60% para Armas y Gore
    const aiThreshold = 0.3;       // 30% ULTRA-SENSIBLE para IA / Deepfakes
    
    const aiScore = result.type?.ai_generated || 0;
    console.log(`🤖 [Radar] Nivel de IA detectado: ${aiScore}`);
    
    if ((result.wad?.weapon || 0) > standardThreshold) return { isSafe: false, reason: "Armas detectadas" };
    if ((result.gore?.prob || 0) > standardThreshold) return { isSafe: false, reason: "Violencia detectada" };
    
    // APLICAMOS LA GUILLOTINA ULTRA-SENSIBLE:
    if (aiScore > aiThreshold) return { isSafe: false, reason: "IA / Deepfake detectado" };

    return { isSafe: true, reason: null };
  } catch (error) { 
    console.error("🚨 SIGHTENGINE ERROR:", error.response ? error.response.data : error.message);
    return { isSafe: true, reason: null }; 
  }
};

// ==========================================
// 1. CREAR PUBLICACIÓN (Soporta 5 imágenes o 1 video) BLINDADO 🛡️
// ==========================================
exports.createPost = async (req, res) => {
  try {
    // 🌍 NUEVO: Atrapamos la variable isPublic del frontend
    const { content, isPPV, price, isPublic } = req.body;
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
        const isVideo = file.mimetype.startsWith('video/');
        let cloudUrl = '';

        if (!isVideo) {
          // 🛑 1. IMÁGENES: Escaneamos el archivo LOCAL crudo (100% Precisión contra IAs)
          const scanResult = await scanContentStrict(file.path, file.mimetype); 
          if (!scanResult.isSafe) {
            files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            return res.status(403).json({ error: `Bloqueado: ${scanResult.reason}` });
          }
          // Subimos después de aprobar
          const uploadResult = await cloudinary.uploader.upload(file.path, { folder: 'fansmio_uploads', resource_type: 'image' });
          cloudUrl = uploadResult.secure_url;
        } else {
          // 🎬 2. VIDEOS: Subimos primero para obtener URL
          const uploadResult = await cloudinary.uploader.upload(file.path, { folder: 'fansmio_uploads', resource_type: 'video' });
          cloudUrl = uploadResult.secure_url;

          // Escaneamos la URL usando el Truco del .JPG en Alta Calidad
          const scanResult = await scanContentStrict(cloudUrl, file.mimetype); 
          if (!scanResult.isSafe) {
            await cloudinary.uploader.destroy(uploadResult.public_id, { resource_type: 'video' });
            files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            return res.status(403).json({ error: `Bloqueado: ${scanResult.reason}` });
          }
        }

        mediaUrls.push(cloudUrl);
        if(fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    if (!content && mediaUrls.length === 0) return res.status(400).json({ error: 'El post está vacío.' });
    if (content && containsForbiddenWords(content)) return res.status(403).json({ error: 'Contenido prohibido.' });

    // 🔥 FIX BLINDADO DEFINITIVO: Todo se guarda como un String JSON
    let finalMediaUrl = null;
    if (mediaUrls.length > 0) {
      finalMediaUrl = JSON.stringify(mediaUrls); 
    }

    const newPost = await prisma.post.create({
      data: { 
        content: content || null, 
        mediaUrl: finalMediaUrl, 
        mediaType, 
        isPPV: isPPV === 'true' || isPPV === true, 
        price: price ? parseFloat(price) : 0, 
        isPublic: isPublic === 'true' || isPublic === true, // 🌍 NUEVO: Guardamos si es público
        userId 
      },
      include: { user: { select: { username: true } } }
    });
    
    res.status(201).json({ message: 'Publicado exitosamente ⚡', post: newPost });
  } catch (error) { 
    console.error("🔥 ERROR CRÍTICO AL PUBLICAR:", error); 
    res.status(500).json({ error: 'Fallo al publicar.' }); 
  }
};

// ==========================================
// 2. OBTENER MURO (ALGORITMO DE JERARQUÍA VIP 👑) - ACTUALIZADO 🛡️
// ==========================================
exports.getAllPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = currentUser?.role === 'ADMIN';

    const posts = await prisma.post.findMany({
      where: { OR: [{ user: { status: 'ACTIVE' } }, { userId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 15, 
      include: {
        user: { 
          select: { 
            id: true, 
            username: true, 
            role: true, 
            creatorProfile: { 
              select: { 
                profileImage: true,
                isVerified: true 
              } 
            }, 
            subscribers: { where: { fanId: userId } },
            promotions: { where: { active: true, expiresAt: { gt: new Date() } }, take: 1, orderBy: { package: 'desc' } }
          } 
        },
        _count: { select: { comments: true } },
        purchases: { where: { fanId: userId } },
        likes: { select: { emoji: true, userId: true } }, 
        comments: { 
          where: {
            user: {
              blockedBy: {
                none: { blockerId: userId }
              }
            }
          },
          include: { 
            user: { 
              select: { 
                username: true, 
                id: true, 
                role: true, 
                creatorProfile: { select: { profileImage: true, isVerified: true } } 
              } 
            } 
          }, 
          orderBy: { createdAt: 'asc' } 
        } 
      }
    });

    let promotedPosts = [];
    let organicPosts = [];

    posts.forEach(post => {
      // 🌍 NUEVO: Control de acceso evalúa si el post es público
      let hasAccess = isAdmin || post.user.id === userId || post.purchases.length > 0 || post.isPublic;
      if (!hasAccess && !post.isPPV) {
        const sub = post.user.subscribers?.[0];
        if (sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE')) hasAccess = true;
        else hasAccess = false; // 🔒 BÓVEDA CERRADA
      }

      // 🔥 MOTOR DE PESOS (Jerarquía de Pago)
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

      // Clasificación para el ordenamiento VIP
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
    console.error("🚨 Error en el algoritmo del feed:", error);
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
    
    let isSubscribed = false; 

    const formattedPosts = posts.map(post => {
      // 🔥 EVALUAMOS SUSCRIPCIÓN ANTES DE REVISAR ACCESO
      if (post.user?.subscribers?.length > 0) isSubscribed = true;
      
      // 🌍 NUEVO: Añadimos post.isPublic a la regla de acceso del perfil
      const hasAccess = post.userId === userId || post.purchases?.length > 0 || post.isPublic || (isSubscribed && !post.isPPV);
      const myReactionObj = post.likes.find(l => l.userId === userId);
      const reactionCounts = { '❤️': 0, '❤️‍🔥': 0, '🤤': 0, '🫦': 0 };
      post.likes.forEach(l => { if (reactionCounts[l.emoji] !== undefined) reactionCounts[l.emoji]++; });
      
      return { ...post, hasAccess, myReaction: myReactionObj ? myReactionObj.emoji : null, reactionCounts, content: hasAccess ? post.content : null };
    });

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

// ==========================================
// 8. ELIMINAR POST (Dueño o Admin) 🛡️
// ==========================================
exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role; 

    const post = await prisma.post.findUnique({ where: { id } });

    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });

    const isOwner = post.userId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'No tienes autorización para eliminar este contenido.' });
    }

    if (post.mediaUrl && post.mediaUrl.includes('cloudinary.com')) {
       let urls = [];
       try { 
         urls = JSON.parse(post.mediaUrl); 
         if(!Array.isArray(urls)) urls = [post.mediaUrl]; 
       } catch(e) { 
         urls = [post.mediaUrl]; 
       }

       for (const url of urls) {
         try {
           const parts = url.split('/');
           const fileName = parts[parts.length - 1].split('.'); 
           const publicId = `fansmio_uploads/${fileName}`;
           
           await cloudinary.uploader.destroy(publicId);
           console.log(`☁️ Archivo borrado en Cloudinary: ${publicId}`);
         } catch (cloudErr) {
           console.error("⚠️ No se pudo borrar el asset en Cloudinary, procediendo con la BD...");
         }
       }
    }

    await prisma.post.delete({ where: { id } });

    res.status(200).json({ 
      message: isAdmin && !isOwner 
        ? 'Post eliminado por moderación administrativa 🚫' 
        : 'Contenido eliminado exitosamente ✅' 
    });

  } catch (error) { 
    console.error("🚨 Error crítico al eliminar post:", error);
    res.status(500).json({ error: 'Fallo interno al procesar la eliminación.' }); 
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { id } = req.params; 
    const userId = req.user.userId; 

    const comment = await prisma.comment.findUnique({ 
      where: { id },
      include: { post: true } 
    });

    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado.' });

    const isAuthor = comment.userId === userId; 
    const isPostOwner = comment.post.userId === userId; 
    const isAdmin = req.user.role === 'ADMIN'; 

    if (!isAuthor && !isPostOwner && !isAdmin) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este comentario.' });
    }

    await prisma.comment.delete({ where: { id } });

    res.status(200).json({ 
      message: isPostOwner && !isAuthor ? 'Comentario grosero eliminado por el Creador.' : 'Eliminado.' 
    });

  } catch (error) { 
    console.error("🚨 Error al moderar comentario:", error);
    res.status(500).json({ error: 'Error interno del servidor.' }); 
  }
};

exports.toggleCommentLike = async (req, res) => { res.status(200).json({ message: 'Ok' }); };
exports.buyBoost = async (req, res) => { res.status(200).json({ message: 'Ok' }); };