// backend/utils/emailService.js
const { Resend } = require('resend');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🔥 Inicializamos la turbina de Resend con tu clave secreta
const resend = new Resend(process.env.RESEND_API_KEY);

// ⚠️ REGLA DE ORO DE RESEND (FASE DE PRUEBAS)
// Mientras no verifiques tu dominio real (fansmio.com) en su panel, 
// Resend te obliga a usar este correo de remitente por seguridad:
const fromEmail = 'onboarding@resend.dev';

// =========================================================
// 1. FUNCIÓN ORIGINAL (Verificación y Recuperar Contraseña)
// =========================================================
const sendEmail = async (to, subject, text) => {
  try {
    const data = await resend.emails.send({
      from: `FansMio Soporte <${fromEmail}>`,
      to: to,
      subject: subject,
      html: `<p>${text.replace(/\n/g, '<br>')}</p>`, // Resend prefiere formato HTML
    });
    console.log(`✅ Correo enviado exitosamente con Resend a: ${to}`);
  } catch (error) {
    console.error('❌ Error enviando correo con Resend:', error);
    throw error;
  }
};

// =========================================================
// 2. NUEVA FUNCIÓN INTELIGENTE (Notificaciones)
// =========================================================
const sendNotificationEmail = async (userId, type, subject, text) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailPromotions: true, emailNewMessages: true, emailSales: true }
    });

    if (!user) return;

    if (type === 'sale' && !user.emailSales) return; 
    if (type === 'message' && !user.emailNewMessages) return; 
    if (type === 'promotion' && !user.emailPromotions) return; 

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    const htmlTemplate = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #050505; color: #ffffff; border-radius: 15px; overflow: hidden; border: 1px solid #333;">
        <div style="background: linear-gradient(90deg, #6b21a8, #2563eb); padding: 20px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 24px;">FansMio 🌟</h1>
        </div>
        <div style="padding: 30px; background-color: #111;">
          <h2 style="color: #fff; margin-top: 0;">¡Tienes novedades!</h2>
          <p style="font-size: 16px; color: #ccc; line-height: 1.5;">${text}</p>
          <div style="text-align: center; margin-top: 30px;">
            <a href="${frontendUrl}/dashboard/notifications" style="background-color: #2563eb; color: white; padding: 12px 25px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block;">Ir a mi cuenta</a>
          </div>
        </div>
        <div style="padding: 15px; text-align: center; font-size: 12px; color: #666; background-color: #0a0a0a;">
          Puedes cambiar tus preferencias de correo en la Configuración de tu cuenta.
        </div>
      </div>
    `;

    await resend.emails.send({
      from: `FansMio Notificaciones <${fromEmail}>`,
      to: user.email,
      subject: subject,
      html: htmlTemplate,
    });

    console.log(`📧 Correo de notificación enviado a ${user.email} (Tipo: ${type})`);

  } catch (error) {
    console.error("❌ Error al enviar correo inteligente con Resend:", error);
  }
};

module.exports = sendEmail;
module.exports.sendEmail = sendEmail;
module.exports.sendNotificationEmail = sendNotificationEmail;