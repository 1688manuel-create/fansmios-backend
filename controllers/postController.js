// backend/controllers/postController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { containsForbiddenWords } = require('../utils/contentFilter');

exports.createPost = async (req, res) => {
  try {
    const { content, isPPV, price } = req.body;
    const userId = req.user.userId;
    const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const mediaType = req.file ? 'IMAGE' : 'TEXT';

    if (!content && !mediaUrl) return res.status(400).json({ error: 'El post debe tener texto o imagen.' });

    // 🛡️ 1. FILTRO DE TEXTO AUTOMÁTICO
    if (containsForbiddenWords(content)) {
      if (req.file) fs.unlinkSync(req.file.path); 
      return res.status(403).json({ error: 'Tu publicación contiene palabras prohibidas. 🛑' });
    }

    // 🤖 2. RADAR ANTI-IA
    if (req.file && req.file.mimetype.startsWith('image/')) {
      const data = new FormData();
      data.append('media', fs.createReadStream(req.file.path));
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

        if (response.data && response.data.type && response.data.type.ai_generated > 0.8) {
          const probability = (response.data.type.ai_generated * 100).toFixed(2);
          fs.unlinkSync(req.file.path); 
          return res.status(403).json({ error: `Imagen IA Detectada (${probability}%). Fansmios solo permite contenido real. 🤖🚫` });
        }
      } catch (apiError) {
        console.error("⚠️ Error conectando con Sightengine. Dejando pasar por seguridad.");
      }
    }

    const newPost = await prisma.post.create({
      data: { content: content || null, mediaUrl, mediaType, isPPV: isPPV === 'true' || isPPV === true, price: price ? parseFloat(price) : 0, userId },
      include: { user: { select: { email: true, username: true } } }
    });

    res.status(201).json({ message: 'Post publicado con éxito', post: newPost });
  } catch (error) { 
    res.status(500).json({ error: 'Error al guardar.' }); 
  }
};

// 🌟 ALGORITMO VIP EN EL FEED
exports.getAllPosts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = currentUser?.role === 'ADMIN';

    // 1. Obtenemos TODOS los posts y miramos quién tiene promociones
    const posts = await prisma.post.findMany({
      where: { OR: [{ user: { status: 'ACTIVE' } }, { userId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { 
          select: { 
            id: true, email: true, username: true, 
            creatorProfile: { select: { profileImage: true } },
            subscribers: { where: { fanId: userId } },
            // 🔥 EL RADAR VIP
            promotions: {
              where: { active: true, expiresAt: { gt: new Date() } },
              select: { package: true }
            }
          } 
        },
        _count: { select: { likes: true, comments: true } },
        purchases: { where: { fanId: userId } },
        likes: { where: { userId: userId }, select: { id: true, emoji: true } },
        comments: { include: { _count: true } } // Simplificado por velocidad
      }
    });

    let promotedPosts = [];
    let organicPosts = [];
    const seenPromotedCreators = new Set();

    posts.forEach(post => {
      // Validar acceso al contenido
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

      // 👑 Lógica de peso VIP
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

      // Si es promovido, NO es tu propio post, y es el primero que vemos de este creador
      if (activePromo && post.user.id !== userId && !seenPromotedCreators.has(post.user.id)) {
        promotedPosts.push(formattedPost);
        seenPromotedCreators.add(post.user.id); // Solo permitimos 1 anuncio por creador para no spamear
      } else {
        organicPosts.push({ ...formattedPost, isPromoted: false, promoTier: null });
      }
    });

    // Ordenar los VIP: GOD primero, luego PRO, luego BASIC
    promotedPosts.sort((a, b) => b.weight - a.weight);

    // Mezclar: Los VIP hasta arriba, los orgánicos abajo
    const finalFeed = [...promotedPosts, ...organicPosts];

    res.status(200).json({ posts: finalFeed });
  } catch (error) { 
    console.error(error);
    res.status(500).json({ error: 'Error al obtener muro.' }); 
  }
};

// ... Mantén el resto de tus funciones iguales (getCreatorPosts, toggleLike, addComment, deletePost, etc.)