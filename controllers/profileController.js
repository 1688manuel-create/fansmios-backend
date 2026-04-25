// backend/controllers/profileController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const geoip = require('geoip-lite'); // 🌍 NUESTRA LIBRERÍA DE RASTREO IP
const cloudinary = require('cloudinary').v2; // ☁️ NUBE PARA LAS IMÁGENES

// ==========================================
// 1. OBTENER EL PERFIL DEL USUARIO (Privado - BLINDADO 🛡️)
// ==========================================
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 🔥 REPARACIÓN MAESTRA: Usamos 'include' en lugar de 'select'.
    // Esto trae TODOS los datos originales del usuario, más las dos tablas conectadas. ¡Cero riesgo de romper algo!
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        creatorProfile: true, // Mantiene intactos a los Creadores y Admins
        wallet: true          // Trae la bóveda para Covra Pay
      }
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // 🎯 ADAPTADOR COVRA PAY
    user.walletBalance = user.wallet ? (user.wallet.balance || 0) : 0;
    delete user.wallet;

    // 🛡️ ESCUDO ANTI-COLAPSO
    if (!user.creatorProfile) {
      user.creatorProfile = {
        bio: "",
        monthlyPrice: 0,
        category: "General",
        welcomeMessage: "",
        hideStats: false,
        blockedCountries: "",
        instagram: "",
        twitter: "",
        website: "",
        profileImage: null,
        coverImage: null
      };
    }

    res.status(200).json({ user });
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// ==========================================
// 2. ACTUALIZAR EL PERFIL PÚBLICO (BASE 64 + UPSERT 🛡️)
// ==========================================
exports.updateProfile = async (req, res) => {
  try {
    // Definimos a quién editamos (Soporte para Modo Dios)
    const targetUserId = (req.user.role === 'ADMIN' && req.body.targetUserId) 
                          ? req.body.targetUserId 
                          : req.user.userId;

    const { 
      username, name, bio, monthlyPrice, category, welcomeMessage, 
      hideStats, blockedCountries, instagram, twitter, website,
      profileImageBase64, coverImageBase64 
    } = req.body; 

    // ACTUALIZAR TABLA PRINCIPAL (USER)
    const userUpdateData = {};
    if (name !== undefined) userUpdateData.name = name;

    // Verificación y actualización de Username
    if (username) {
      const cleanUsername = username.toLowerCase().replace(/\s+/g, '');
      const existingUser = await prisma.user.findUnique({ where: { username: cleanUsername } });
      if (existingUser && existingUser.id !== targetUserId) {
        return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
      }
      userUpdateData.username = cleanUsername;
    }

    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({
        where: { id: targetUserId },
        data: userUpdateData
      });
    }

    // PREPARAR DATOS DEL PERFIL
    const profileData = {};
    if (bio !== undefined) profileData.bio = bio;
    if (monthlyPrice !== undefined) profileData.monthlyPrice = parseFloat(monthlyPrice);
    if (category !== undefined) profileData.category = category;
    if (welcomeMessage !== undefined) profileData.welcomeMessage = welcomeMessage;
    if (hideStats !== undefined) profileData.hideStats = hideStats === 'true' || hideStats === true;
    if (blockedCountries !== undefined) profileData.blockedCountries = blockedCountries;
    if (instagram !== undefined) profileData.instagram = instagram;
    if (twitter !== undefined) profileData.twitter = twitter;
    if (website !== undefined) profileData.website = website;

    // ☢️ PROCESAMIENTO DE IMÁGENES VIA BASE64 (BYPASS DEFINITIVO)
    if (profileImageBase64) {
      console.log("📸 Procesando Foto de Perfil en texto Base64...");
      const result = await cloudinary.uploader.upload(profileImageBase64, { 
        folder: "fansmio_profiles",
        // 🔥 ESTE ES EL AVISO PARA CLOUDINARY: Le decimos que lo procese como archivo
        resource_type: "auto" 
      });
      profileData.profileImage = result.secure_url;
    }

    if (coverImageBase64) {
      console.log("🖼️ Procesando Foto de Portada en texto Base64...");
      const result = await cloudinary.uploader.upload(coverImageBase64, { 
        folder: "fansmio_profiles",
        // 🔥 ESTE ES EL AVISO PARA CLOUDINARY
        resource_type: "auto" 
      });
      profileData.coverImage = result.secure_url;
    }

    // UPSERT CORREGIDO: Si existe lo actualiza, si es Admin/Nuevo lo crea
    const updatedProfile = await prisma.creatorProfile.upsert({
      where: { userId: targetUserId },
      update: profileData,
      create: {
        userId: targetUserId,
        ...profileData
      }
    });

    res.status(200).json({ message: 'Perfil actualizado con éxito', profile: updatedProfile });
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.status(500).json({ error: 'Error interno al guardar los cambios.' });
  }
};

// ==========================================
// 3. OBTENER EL PERFIL PÚBLICO (Con Geo-Bloqueo 🌍🚫 y Soporte FAN 🌟)
// ==========================================
exports.getPublicProfile = async (req, res) => {
  try {
    const { username } = req.params; 
    
    // Traemos al usuario
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        username: true,
        name: true, 
        role: true,
        creatorProfile: true, 
        _count: {
          select: { posts: true, followers: true }
        }
      }
    });

    // 👻 ELIMINAMOS EL FANTASMA 404
    // Ahora si el usuario existe (sea Fan o Creador), lo dejamos pasar.
    if (!user) {
      return res.status(404).json({ error: 'Perfil no encontrado' });
    }

    // 🌟 ESCUDO PARA FANS: Si es un FAN, le creamos un perfil "virtual" para que el frontend no colapse
    if (user.role === 'FAN' && !user.creatorProfile) {
       user.creatorProfile = {
         bio: "🌟 Verified Fan Supporter",
         profileImage: null,
         coverImage: null
       };
    }

    // 🌍 INICIO DEL ESCUDO DE FRONTERA (Solo aplica a Creadores con lista negra)
    if (user.creatorProfile && user.creatorProfile.blockedCountries) {
      const rawIps = req.headers['x-forwarded-for'] || '';
      const clientIp = rawIps ? rawIps.split(',').trim() : req.socket.remoteAddress;
      
      const geo = geoip.lookup(clientIp);
      const visitorCountry = geo ? geo.country : null; 
      
      if (visitorCountry) {
        const blockedList = user.creatorProfile.blockedCountries.split(',').map(c => c.trim().toUpperCase());
        if (blockedList.includes(visitorCountry)) {
          return res.status(403).json({ error: '🚫 Este perfil no está disponible en tu región.' });
        }
      }
    }
    // 🌍 FIN DEL ESCUDO

    let isFollowing = false;
    let isSubscribed = false; 
    
    if (req.user) {
      const followRecord = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: req.user.userId, followingId: user.id } }
      });
      if (followRecord) isFollowing = true;

      const subscriptionRecord = await prisma.subscription.findUnique({
        where: { fanId_creatorId: { fanId: req.user.userId, creatorId: user.id } }
      });
      if (subscriptionRecord && (subscriptionRecord.status === 'ACTIVE' || subscriptionRecord.status === 'PAST_DUE')) {
        isSubscribed = true;
      }
    }

    res.status(200).json({ 
      profile: user,
      isFollowing: isFollowing,
      isSubscribed: isSubscribed
    });
    
  } catch (error) {
    console.error('Error al obtener perfil público:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// 🔥 PROTOCOLO DE AUTODESTRUCCIÓN (Eliminar Cuenta Blindado)
exports.deleteMyAccount = async (req, res) => {
  try {
    const userId = req.user.userId;

    console.log(`🚨 INICIANDO PROTOCOLO DE AUTODESTRUCCIÓN PARA USER_ID: ${userId}`);

    // 1. ELIMINAR OBSTÁCULOS MANUALMENTE (Cupones huérfanos)
    await prisma.coupon.deleteMany({
      where: { creatorId: userId }
    });

    // 2. DETONAR LA CUENTA (Prisma hará el 'Cascade' con todo lo demás)
    await prisma.user.delete({
      where: { id: userId }
    });

    res.status(200).json({ message: '💥 Cuenta eliminada de la faz de FansMio.' });
  } catch (error) {
    console.error("❌ Error al eliminar cuenta:", error);
    res.status(500).json({ error: 'Error al intentar eliminar la cuenta.' });
  }
};