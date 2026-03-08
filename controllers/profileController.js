// backend/controllers/profileController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const geoip = require('geoip-lite'); // 🌍 NUESTRA LIBRERÍA DE RASTREO IP

// ==========================================
// 1. OBTENER EL PERFIL DEL USUARIO (Privado)
// ==========================================
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { creatorProfile: true }
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.status(200).json({ user });
  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// ==========================================
// 2. ACTUALIZAR EL PERFIL PÚBLICO
// ==========================================
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, bio, monthlyPrice, profileImage, coverImage, instagram, twitter, website } = req.body; 

    if (username) {
      const existingUser = await prisma.user.findUnique({ where: { username } });
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { username: username.toLowerCase().replace(/\s+/g, '') } 
      });
    }

    const updatedProfile = await prisma.creatorProfile.upsert({
      where: { userId: userId },
      update: {
        bio: bio || null,
        monthlyPrice: monthlyPrice ? parseFloat(monthlyPrice) : 0,
        instagram: instagram || null,
        twitter: twitter || null,
        website: website || null,
        ...(profileImage !== undefined && { profileImage }),
        ...(coverImage !== undefined && { coverImage })
      },
      create: {
        userId: userId,
        bio: bio || null,
        monthlyPrice: monthlyPrice ? parseFloat(monthlyPrice) : 0,
        instagram: instagram || null,
        twitter: twitter || null,
        website: website || null,
        profileImage: profileImage || null,
        coverImage: coverImage || null
      }
    });

    res.status(200).json({ message: 'Perfil actualizado con éxito', profile: updatedProfile });
  } catch (error) {
    console.error('Error al actualizar perfil:', error);
    res.status(500).json({ error: 'Error interno al guardar los cambios.' });
  }
};

// ==========================================
// 3. OBTENER EL PERFIL PÚBLICO DEL CREADOR (Con Geo-Bloqueo 🌍🚫)
// ==========================================
exports.getPublicProfile = async (req, res) => {
  try {
    const { username } = req.params; 
    
    // Traemos al creador y su configuración
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: {
        id: true,
        username: true,
        role: true,
        creatorProfile: true, 
        _count: {
          select: { posts: true } 
        }
      }
    });

    if (!user || user.role !== 'CREATOR') {
      return res.status(404).json({ error: 'Creador no encontrado' });
    }

    // 🌍 INICIO DEL ESCUDO DE FRONTERA (GEO-BLOCKING)
    if (user.creatorProfile && user.creatorProfile.blockedCountries) {
      // Obtenemos la IP real del visitante
      const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      
      // Consultamos el país de esa IP
      const geo = geoip.lookup(clientIp);
      const visitorCountry = geo ? geo.country : null; 
      
      console.log(`📡 Visitante intentando entrar a @${username} | IP: ${clientIp} | País: ${visitorCountry || 'Local/Desconocido'}`);

      // Si detectamos de qué país viene, comparamos con la lista negra del creador
      if (visitorCountry) {
        // Transformamos "MX, CO, AR" en un array limpio ['MX', 'CO', 'AR']
        const blockedList = user.creatorProfile.blockedCountries
          .split(',')
          .map(country => country.trim().toUpperCase());

        if (blockedList.includes(visitorCountry)) {
          console.log(`🛑 Acceso bloqueado. El creador bloqueó: ${visitorCountry}`);
          return res.status(403).json({ 
            error: '🚫 Este perfil no está disponible en tu región por decisión del creador.' 
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