// backend/controllers/userController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcryptjs'); // Asegúrate de que esto esté arriba del archivo si no lo tienes
const { cloudinary } = require('../utils/cloudinaryConfig');

// ==========================================
// 1. FAN: Convertirse en Creador
// ==========================================
exports.becomeCreator = async (req, res) => {
  try {
    const userId = req.user.userId; 

    // 1. Cambiamos su rol en la base de datos a CREATOR
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role: 'CREATOR' }
    });

    // 2. Le creamos su "Perfil Público" vacío para que lo llene después
    await prisma.creatorProfile.create({
      data: {
        userId: userId,
        bio: "¡Hola! Soy un nuevo creador en FansMio.",
        monthlyPrice: 5.00
      }
    });

    res.status(200).json({ 
      message: '¡Felicidades! Ahora eres un Creador 🔵', 
      user: { email: updatedUser.email, role: updatedUser.role } 
    });

  } catch (error) {
    console.error('Error al cambiar de rol:', error);
    res.status(500).json({ error: 'Error interno del servidor o el usuario ya tiene un perfil.' });
  }
};

// ==========================================
// 2. CREADOR (Y ADMIN): Editar Perfil Público (CON RADARES 🚨)
// ==========================================
exports.updateProfile = async (req, res) => {
  try {
    const targetUserId = (req.user.role === 'ADMIN' && req.body.targetUserId) 
                          ? req.body.targetUserId 
                          : req.user.userId;

    console.log("====================================");
    console.log("📥 DATOS RECIBIDOS DESDE EL FRONTEND:");
    console.log(req.body); // Esto nos dejará ver si los datos están llegando
    console.log("====================================");

    // Extraemos la info (incluyendo Privacidad)
    const { bio, monthlyPrice, name, category, welcomeMessage, hideStats, blockedCountries } = req.body;

    // 1. Guardamos el Nombre Real/Artístico
    if (name !== undefined) {
      await prisma.user.update({
        where: { id: targetUserId },
        data: { name: name }
      });
    }

    // 2.🔥 CÓDIGO CORREGIDO (DEJA PASAR LOS LINKS)
    const profileData = {
      bio: req.body.bio || null,
      monthlyPrice: req.body.monthlyPrice ? parseFloat(req.body.monthlyPrice) : 0,
      category: req.body.category || 'General',
      welcomeMessage: req.body.welcomeMessage || null,
      hideStats: req.body.hideStats === 'true',
      blockedCountries: req.body.blockedCountries || null,
      
      // 🚀 INYECTA ESTAS 3 LÍNEAS AQUÍ:
      instagram: req.body.instagram || null,
      twitter: req.body.twitter || null,
      website: req.body.website || null
    };

    console.log("💾 DATOS LISTOS PARA GUARDARSE EN LA BD:", profileData);

    // 3. Atrapamos las IMÁGENES y las subimos a Cloudinary
    if (req.files) {
      if (req.files.profileImage && req.files.profileImage.length > 0) {
        const result = await cloudinary.uploader.upload(req.files.profileImage[0].path, { folder: "fansmio_profiles" });
        profileData.profileImage = result.secure_url;
      }
      if (req.files.coverImage && req.files.coverImage.length > 0) {
        const result = await cloudinary.uploader.upload(req.files.coverImage[0].path, { folder: "fansmio_profiles" });
        profileData.coverImage = result.secure_url;
      }
    }

    // 4. Inyectamos los datos
    const updatedProfile = await prisma.creatorProfile.update({
      where: { userId: targetUserId },
      data: profileData
    });

    res.status(200).json({ message: 'Perfil actualizado exitosamente', profile: updatedProfile });

  } catch (error) {
    console.error('🚨 Error crítico al actualizar perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor al guardar configuraciones' });
  }
};

// ==========================================
// 3. ADMIN: Ver absolutamente todos los usuarios
// ==========================================
exports.getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        creatorProfile: true
      }
    });

    res.status(200).json({ 
      message: '🔴 Acceso Total de Administrador concedido', 
      totalUsers: users.length,
      users: users 
    });

  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ==========================================
// 4. OBTENER PERFIL DEL USUARIO
// ==========================================
exports.getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { creatorProfile: true }
    });
    res.status(200).json({ user });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// 5. SEGUIR / DEJAR DE SEGUIR A UN USUARIO (FOLLOW)
// ==========================================
exports.toggleFollow = async (req, res) => {
  try {
    const followerId = req.user.userId;
    const followingId = req.params.id;

    if (followerId === followingId) {
      return res.status(400).json({ error: "No puedes seguirte a ti mismo" });
    }

    // Buscamos si ya lo sigue
    const existingFollow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId }
      }
    });

    if (existingFollow) {
      // Si ya lo sigue, lo eliminamos (Unfollow)
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      return res.status(200).json({ message: "Has dejado de seguir a este creador", isFollowing: false });
    } else {
      // Si no lo sigue, lo creamos (Follow)
      await prisma.follow.create({
        data: { followerId, followingId }
      });
      return res.status(200).json({ message: "Ahora sigues a este creador", isFollowing: true });
    }
  } catch (error) {
    console.error('Error en toggleFollow:', error);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ==========================================
// 🔥 NUEVO: ACTUALIZAR EMAIL
// ==========================================
exports.updateEmail = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user.userId;

    if (!newEmail) return res.status(400).json({ error: 'Debes proporcionar un nuevo email.' });

    // 1. Verificamos si el email ya está tomado por otra persona
    const existingUser = await prisma.user.findUnique({ where: { email: newEmail } });
    if (existingUser) return res.status(400).json({ error: 'Este correo ya está en uso por otra cuenta.' });

    // 2. Guardamos el nuevo correo
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { email: newEmail }
    });

    res.status(200).json({ message: '✅ Email actualizado correctamente.', user: { email: updatedUser.email } });
  } catch (error) {
    console.error("Error al actualizar email:", error);
    res.status(500).json({ error: 'Error interno al actualizar el email.' });
  }
};

// ==========================================
// 🔥 NUEVO: ACTUALIZAR CONTRASEÑA
// ==========================================
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan campos obligatorios.' });

    // 1. Buscamos al usuario en la BD
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // 2. Comparamos si la contraseña actual es correcta
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'La contraseña actual es incorrecta. 🛑' });

    // 3. Encriptamos la nueva contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // 4. Guardamos
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    res.status(200).json({ message: '✅ Contraseña actualizada correctamente. (Tu seguridad ha mejorado).' });
  } catch (error) {
    console.error("Error al actualizar contraseña:", error);
    res.status(500).json({ error: 'Error interno al actualizar la contraseña.' });
  }
};

// ==========================================
// 🔥 NUEVO: ACTUALIZAR PREFERENCIAS DE NOTIFICACIONES
// ==========================================
exports.updateNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emailPromotions, emailNewMessages, emailSales } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        emailPromotions: emailPromotions,
        emailNewMessages: emailNewMessages,
        emailSales: emailSales
      }
    });

    // Devolvemos el usuario actualizado para que el Frontend lo guarde
    res.status(200).json({ 
      message: '✅ Preferencias de notificaciones guardadas.',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        role: updatedUser.role,
        emailPromotions: updatedUser.emailPromotions,
        emailNewMessages: updatedUser.emailNewMessages,
        emailSales: updatedUser.emailSales
      }
    });
  } catch (error) {
    console.error("Error al guardar notificaciones:", error);
    res.status(500).json({ error: 'Error interno al guardar preferencias.' });
  }
};

// ==========================================
// 🔔 1. OBTENER MIS NOTIFICACIONES (IN-APP)
// ==========================================
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Traemos las últimas 50 notificaciones del usuario
    const notifications = await prisma.notification.findMany({
      where: { userId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50 
    });

    // Contamos cuántas están sin leer para poner el numerito rojo
    const unreadCount = await prisma.notification.count({
      where: { userId: userId, isRead: false }
    });

    res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    console.error("Error al obtener notificaciones:", error);
    res.status(500).json({ error: 'Error al cargar el centro de notificaciones.' });
  }
};

// ==========================================
// 🔔 2. MARCAR TODAS COMO LEÍDAS
// ==========================================
exports.markNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    await prisma.notification.updateMany({
      where: { userId: userId, isRead: false },
      data: { isRead: true }
    });

    res.status(200).json({ message: 'Todas las notificaciones marcadas como leídas ✅' });
  } catch (error) {
    console.error("Error al marcar como leídas:", error);
    res.status(500).json({ error: 'Error al actualizar notificaciones.' });
  }
};

// ==========================================
// 📱 GUARDAR TOKEN PUSH (FIREBASE)
// ==========================================
exports.savePushToken = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fcmToken } = req.body;

    if (!fcmToken) return res.status(400).json({ error: 'Falta el token' });

    await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: fcmToken }
    });

    res.status(200).json({ message: '✅ Dispositivo vinculado para notificaciones Push.' });
  } catch (error) {
    console.error("Error al guardar token Push:", error);
    res.status(500).json({ error: 'Error interno.' });
  }
};

// ==========================================
// OBTENER CREADORES EN TENDENCIA (TRENDING VIP)
// ==========================================
exports.getTrendingCreators = async (req, res) => {
  try {
    // Buscamos a los usuarios que son Creadores o Admins
    const trendingCreators = await prisma.user.findMany({
      where: {
        role: { in: ['CREATOR', 'ADMIN'] }
      },
      take: 5, // Traemos máximo 5 para que la barra no se haga gigante
      orderBy: {
        createdAt: 'desc' // Por ahora traemos a los más nuevos
      },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        creatorProfile: {
          select: {
            profileImage: true
          }
        }
      }
    });

    // Le damos el formato exacto que espera tu Frontend
    const formattedTrending = trendingCreators.map(creator => ({
      id: creator.id,
      username: creator.username,
      name: creator.name || creator.username, // Si no tiene nombre, usamos su @usuario
      isOnline: Math.random() > 0.5, // Le ponemos el puntito verde de "En línea" al azar para darle realismo
      creatorProfile: creator.creatorProfile
    }));

    res.status(200).json({ trending: formattedTrending });
  } catch (error) {
    console.error('Error al obtener Trending VIP:', error);
    res.status(500).json({ error: 'Error interno al cargar la barra VIP' });
  }
};

// OBTENER AL CREADOR CON EL BOOST NIVEL DIOS (HISTORIA DORADA)
exports.getVipCreator = async (req, res) => {
  try {
    // Buscamos a alguien que haya pagado el paquete 'GOD' y su tiempo no haya expirado
    const activeGodPromo = await prisma.promotion.findFirst({
      where: {
        package: 'GOD',
        active: true,
        expiresAt: { gt: new Date() } // Que la fecha de vencimiento sea mayor a hoy
      },
      orderBy: { createdAt: 'desc' }, // Si hay varios, mostramos al más reciente
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            creatorProfile: { select: { profileImage: true } }
          }
        }
      }
    });

    // Si hay alguien que pagó, enviamos sus datos. Si no, enviamos null y el aro VIP no sale.
    res.status(200).json({ vip: activeGodPromo ? activeGodPromo.creator : null });
  } catch (error) {
    console.error('Error fetching VIP Creator:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};