// backend/controllers/authController.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); 
const crypto = require('crypto'); 
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { sendEmail } = require('../utils/emailService');

const prisma = new PrismaClient();

exports.register = async (req, res) => {
  try {
    // Agregamos username para recibirlo desde el frontend
    const { username, email, password, role, referralCode } = req.body;

    // 1. Validar que no falten datos
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'El usuario, email y contraseña son obligatorios.' });
    }

    // ==========================================
    // 🛡️ ESCUDO ANTI-CORREOS TEMPORALES (LISTA BLANCA)
    // ==========================================
    const emailDomain = email.split('@')?.toLowerCase();
    
    // Aquí pones los únicos proveedores que confías
    const allowedDomains = [
      'gmail.com', 
      'yahoo.com', 
      'outlook.com', 
      'hotmail.com', 
      'icloud.com',   // Usuarios de Apple
      'live.com', 
      'msn.com'
    ];

    if (!emailDomain || !allowedDomains.includes(emailDomain)) {
      return res.status(403).json({ 
        error: 'Por seguridad, solo aceptamos correos de Gmail, Outlook, Yahoo o iCloud. No se permiten correos temporales ni empresariales genéricos. 🛑' 
      });
    }
    // ==========================================

    // 2. Verificar si el correo ya existe
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'Este correo ya está registrado.' });

    // 3. Verificar si el nombre de usuario ya está ocupado
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) return res.status(400).json({ error: 'Este nombre de usuario ya está en uso. Elige otro.' });

    // 4. Encriptar contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 5. Sistema de referidos (Si aplica)
    let referrerId = null;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode } });
      if (referrer) referrerId = referrer.id;
    }

    // 6. Generar el Token Mágico de Verificación
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    // 7. Crear el usuario en la Base de Datos
    const newUser = await prisma.user.create({
      data: {
        username: username.toLowerCase().replace(/\s+/g, ''), // Guardamos el username sin espacios
        email,
        passwordHash: hashedPassword,
        role: role === 'CREATOR' ? 'CREATOR' : 'FAN',
        referredById: referrerId,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: tokenExpires
      }
    });

    // 💌 8. ENVIAR CORREO CON EL BOTÓN DE VERIFICACIÓN
    const verifyLink = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
    await sendEmail(
      newUser.email, 
      'Verifica tu correo en FansMio 🔐', 
      `¡Hola @${newUser.username}!\n\nEstás a un paso de entrar al imperio. Por favor, verifica tu correo haciendo clic en el siguiente enlace (es válido por 24 horas):\n\n${verifyLink}\n\nSi tú no creaste esta cuenta, ignora este mensaje.`
    );

    // 9. Crear perfil vacío si eligió ser creador (KYC pendiente)
    if (newUser.role === 'CREATOR') {
      await prisma.creatorProfile.create({ 
        data: { 
          userId: newUser.id,
          kycStatus: 'PENDING' // Lo mandamos directo a revisión por seguridad
        } 
      });
    }

    // ==========================================
    // 🔥 10. MOTOR DE BIENVENIDA AUTOMÁTICA
    // ==========================================
    try {
      console.log("🚀 [MOTOR BIENVENIDA] Iniciando protocolo para:", newUser.email);
      
      const adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
        orderBy: { createdAt: 'asc' }
      });

      console.log("👑 [MOTOR BIENVENIDA] Admin encontrado:", adminUser ? adminUser.email : "⚠️ NINGUNO (Abortando)");

      if (adminUser) {
        console.log("📖 [MOTOR BIENVENIDA] Buscando textos en la BD...");
        const creatorSetting = await prisma.systemSetting.findUnique({ where: { key: 'WELCOME_CREATOR' } });
        const fanSetting = await prisma.systemSetting.findUnique({ where: { key: 'WELCOME_FAN' } });
        
        console.log("✅ [MOTOR BIENVENIDA] Textos encontrados, enviando mensaje...");

        // Asignamos el texto real o un fallback...
        const welcomeText = newUser.role === 'CREATOR' 
          ? (creatorSetting?.value || "¡Bienvenido a FansMio, Creador! ⚡")
          : (fanSetting?.value || "¡Bienvenido a FansMio! ⚡");

        // Creamos el buzón...
        const newConv = await prisma.conversation.create({
          data: { creatorId: adminUser.id, fanId: newUser.id }
        });

        // Inyectamos el mensaje...
        await prisma.message.create({
          data: {
            conversationId: newConv.id, senderId: adminUser.id, receiverId: newUser.id,
            content: welcomeText, isPPV: false, price: 0
          }
        });

        // Notificación...
        await prisma.notification.create({
          data: { userId: newUser.id, type: 'MESSAGE', content: `¡Bienvenido! Tienes un mensaje del Equipo FansMio ⚡`, link: '/dashboard/messages' }
        });
        
        console.log("🎯 [MOTOR BIENVENIDA] ¡Misión Cumplida!");
      }
    } catch (welcomeError) {
      console.error("🚨 [MOTOR BIENVENIDA] ERROR CRÍTICO:", welcomeError);
    }
    // ==========================================

    res.status(201).json({ 
      message: 'Usuario registrado exitosamente. Por favor, verifica tu correo. 📩', 
      user: { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role } 
    });

  } catch (error) { 
    console.error('Error en registro:', error);
    res.status(500).json({ error: 'Error interno del servidor.' }); 
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

    const user = await prisma.user.findUnique({ 
      where: { email },
      include: { 
        creatorProfile: true,
        wallet: true // 👈 ¡NUEVO! Traemos la bóveda del usuario
      } 
    });
    
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' }); 

    // 🔥 BLINDAJE 1: Revisar el estado ANTES de dejarlo entrar
    if (user.status === 'BANNED') {
      return res.status(403).json({ error: 'Tu cuenta ha sido baneada permanentemente por violar las políticas de la plataforma.' });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Tu cuenta se encuentra suspendida temporalmente. Contacta a soporte.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(401).json({ error: 'Credenciales inválidas' });

    // 🔥 BLINDAJE 2: LA PUERTA DE HIERRO (Verificación de Email)
    if (!user.isEmailVerified) {
      return res.status(403).json({ 
        error: 'Tu correo aún no está verificado. Revisa tu bandeja de entrada o spam para activar tu cuenta.',
        needsVerification: true,
        email: user.email // Lo mandamos para que el Frontend pueda mostrar el botón "Reenviar correo"
      });
    }

    // 🔥 CAMBIO DE '15m' a '7d' (7 DÍAS DE BATERÍA PARA LA SESIÓN)
    const accessToken = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const refreshToken = jwt.sign({ userId: user.id, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

    const deviceInfo = req.headers['user-agent'] || 'Dispositivo Desconocido';
    const ipAddress = req.ip || req.socket.remoteAddress || 'IP Desconocida';

    await prisma.session.create({
      data: { userId: user.id, refreshToken: refreshToken, deviceInfo: deviceInfo, ipAddress: ipAddress, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
    });

    res.status(200).json({
      message: 'Login exitoso',
      token: accessToken, 
      refreshToken,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role, 
        username: user.username,
        walletBalance: user.wallet?.balance || 0, // 👈 ¡NUEVO! Enviamos el saldo real o 0 si no tiene bóveda
        creatorProfile: user.creatorProfile 
      }
    });

  } catch (error) { 
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' }); 
  }
};

exports.logoutGlobal = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Se requiere el email para cerrar las sesiones' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    await prisma.session.deleteMany({ where: { userId: user.id } });
    res.status(200).json({ message: 'Has cerrado sesión en todos tus dispositivos correctamente 🔒' });

  } catch (error) { res.status(500).json({ error: 'Error interno del servidor' }); }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.status(200).json({ message: 'Si el correo existe, se ha enviado un enlace de recuperación.' });

    const resetToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const emailText = `Hola ${user.username || 'Usuario'},\n\nHaz clic en el siguiente enlace para recuperar tu contraseña. Este enlace expira en 15 minutos:\n\n${resetLink}\n\nSi no solicitaste esto, ignora este mensaje.`;

    await sendEmail(user.email, 'Recuperación de Contraseña - FansMio', emailText);
    res.status(200).json({ message: 'Si el correo existe, se ha enviado un enlace de recuperación.' });
  } catch (error) { res.status(500).json({ error: 'Error interno del servidor' }); }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({ where: { id: decoded.userId }, data: { passwordHash: newPasswordHash } });
    res.status(200).json({ message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.' });
  } catch (error) { res.status(400).json({ error: 'El enlace es inválido o ha expirado.' }); }
};

exports.generate2FA = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const secret = speakeasy.generateSecret({ name: `FansMio (${user.email})` });
    await prisma.user.update({ where: { email }, data: { twoFactorSecret: secret.base32 } });
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.status(200).json({ message: 'Escanea este QR', qrCodeUrl: qrCodeUrl, secret: secret.base32 });
  } catch (error) { res.status(500).json({ error: 'Error interno' }); }
};

exports.verify2FA = async (req, res) => {
  try {
    const { email, token } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.twoFactorSecret) return res.status(400).json({ error: 'El 2FA no está configurado' });

    const isVerified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: token });
    if (!isVerified) return res.status(400).json({ error: 'Código 2FA incorrecto' });

    await prisma.user.update({ where: { email }, data: { twoFactorEnabled: true } });
    res.status(200).json({ message: '2FA activado exitosamente 🛡️' });
  } catch (error) { res.status(500).json({ error: 'Error interno' }); }
};

// ==========================================
// 🔥 VERIFICAR EL CORREO ELECTRÓNICO
// ==========================================
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token no proporcionado.' });

    const user = await prisma.user.findUnique({ where: { emailVerificationToken: token } });
    
    if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ error: 'El enlace de verificación es inválido o ha expirado.' });
    }

    // Activamos la cuenta y destruimos el token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null
      }
    });

    res.status(200).json({ message: '¡Cuenta verificada con éxito! Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error verificando email:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// ==========================================
// ♻️ REENVIAR EL CORREO DE VERIFICACIÓN
// ==========================================
exports.resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Se requiere un correo electrónico.' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.isEmailVerified) return res.status(400).json({ error: 'Esta cuenta ya está verificada.' });

    // Generar un nuevo token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: tokenExpires
      }
    });

    const verifyLink = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
    await sendEmail(
      user.email, 
      'Nuevo enlace de verificación - FansMio 🔐', 
      `¡Hola @${user.username}!\n\nAquí tienes un nuevo enlace para verificar tu cuenta:\n\n${verifyLink}\n\nEs válido por 24 horas.`
    );

    res.status(200).json({ message: 'Nuevo enlace de verificación enviado a tu correo.' });
  } catch (error) {
    console.error('Error reenviando verificación:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};