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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { creatorProfile: true }
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // 🛡️ ESCUDO ANTI-COLAPSO PARA ADMINS Y NUEVOS
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
// 3. OBTENER EL PERFIL PÚBLICO DEL CREADOR/ADMIN (Con Geo-Bloqueo 🌍🚫)
// ==========================================
exports.getPublicProfile = async (req, res) => {
  try {
    const { username } = req.params; 
    
    // Traemos al usuario y su configuración
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

    // 🔥 EL BYPASS: Ahora permitimos que pasen tanto CREATOR como ADMIN
    if (!user || (user.role !== 'CREATOR' && user.role !== 'ADMIN')) {
      return res.status(404).json({ error: 'Perfil no encontrado' });
    }

    // 🌍 INICIO DEL ESCUDO DE FRONTERA (GEO-BLOCKING)
    if (user.creatorProfile && user.creatorProfile.blockedCountries) {
      // FIX de seguridad: Evitar error si hay proxy múltiple
      const rawIps = req.headers['x-forwarded-for'] || '';
      const clientIp = rawIps ? rawIps.split(',')[0].trim() : req.socket.remoteAddress;
      
      // Consultamos el país de esa IP
      const geo = geoip.lookup(clientIp);
      const visitorCountry = geo ? geo.country : null; 
      
      console.log(`📡 Visitante intentando entrar a @${username} | IP: ${clientIp} | País: ${visitorCountry || 'Local/Desconocido'}`);

      // Si detectamos de qué país viene, comparamos con la lista negra
      if (visitorCountry) {
        const blockedList = user.creatorProfile.blockedCountries
          .split(',')
          .map(country => country.trim().toUpperCase());

        if (blockedList.includes(visitorCountry)) {
          console.log(`🛑 Acceso bloqueado. El usuario bloqueó: ${visitorCountry}`);
          return res.status(403).json({ 
            error: '🚫 Este perfil no está disponible en tu región.' 
          });
        }
      }
    }
    // 🌍 FIN DEL ESCUDO

    res.status(200).json({ profile: user });
  } catch (error) {
    console.error('Error al obtener perfil público:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};