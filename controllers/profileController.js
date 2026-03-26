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
// 2. ACTUALIZAR EL PERFIL PÚBLICO (HIERRO MACIZO + UPSERT 🛡️)
// ==========================================
exports.updateProfile = async (req, res) => {
  try {
    // Definimos a quién editamos (Soporte para Modo Dios)
    const targetUserId = (req.user.role === 'ADMIN' && req.body.targetUserId) 
                          ? req.body.targetUserId 
                          : req.user.userId;

    const { username, bio, monthlyPrice, category, welcomeMessage, hideStats, blockedCountries, instagram, twitter, website } = req.body; 

    // Verificación y actualización de Username
    if (username) {
      const cleanUsername = username.toLowerCase().replace(/\s+/g, '');
      const existingUser = await prisma.user.findUnique({ where: { username: cleanUsername } });
      if (existingUser && existingUser.id !== targetUserId) {
        return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
      }
      await prisma.user.update({
        where: { id: targetUserId },
        data: { username: cleanUsername } 
      });
    }

    // Preparamos el paquete de datos del perfil
    const profileData = {
      bio: bio || null,
      monthlyPrice: monthlyPrice ? parseFloat(monthlyPrice) : 0,
      category: category || 'General',
      welcomeMessage: welcomeMessage || null,
      hideStats: hideStats === 'true' || hideStats === true,
      blockedCountries: blockedCountries || null,
      instagram: instagram || null,
      twitter: twitter || null,
      website: website || null
    };

    // PROCESAMIENTO DE IMÁGENES (Blindado contra bucles)
    if (req.files) {
      let profileImagePath = null;
      if (req.files.profileImage) {
        if (Array.isArray(req.files.profileImage) && req.files.profileImage.length > 0) {
          profileImagePath = req.files.profileImage.path;
        } else if (req.files.profileImage.path) {
          profileImagePath = req.files.profileImage.path;
        }
      }
      if (profileImagePath) {
        const result = await cloudinary.uploader.upload(profileImagePath, { folder: "fansmio_profiles" });
        profileData.profileImage = result.secure_url;
      }

      let coverImagePath = null;
      if (req.files.coverImage) {
        if (Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
          coverImagePath = req.files.coverImage.path;
        } else if (req.files.coverImage.path) {
          coverImagePath = req.files.coverImage.path;
        }
      }
      if (coverImagePath) {
        const result = await cloudinary.uploader.upload(coverImagePath, { folder: "fansmio_profiles" });
        profileData.coverImage = result.secure_url;
      }
    }

    // UPSERT: Si existe lo actualiza, si es Admin/Nuevo lo crea
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
      // Obtenemos la IP real del visitante
      const clientIp = (req.headers['x-forwarded-for'] || '').split(',').trim() || req.socket.remoteAddress;
      
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