// backend/controllers/muxWebhookController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 🔥 Importamos tus servicios de notificaciones (Ajusta la ruta si es diferente)
const { sendPushNotification } = require('../utils/pushService'); 

/**
 * 🤖 MUX WEBHOOK PROCESSOR + MOTOR DE FOMO (FASE 5)
 */
exports.handleMuxWebhook = async (req, res) => {
  try {
    const { type, data } = req.body;

    if (!type || !data) return res.status(400).send("Bad Request: Missing data");

    const playbackId = data.playback_ids && data.playback_ids[0] ? data.playback_ids[0].id : null;
    if (!playbackId) return res.status(200).send("Ignored: No playback ID");

    console.log(`📡 [MUX WEBHOOK] Evento recibido: ${type} para PlaybackID: ${playbackId}`);

    const liveStream = await prisma.liveStream.findFirst({
      where: { playbackId: playbackId }
    });

    if (!liveStream) return res.status(200).send("Stream not found in DB");

    // 🧠 MÁQUINA DE ESTADOS AUTOMÁTICA
    switch (type) {
      
      case 'video.live_stream.connected':
      case 'video.live_stream.active':
        // 🔥 EL CREADOR ENCENDIÓ EL OBS
        if (liveStream.status !== 'LIVE') {
          await prisma.liveStream.update({
            where: { id: liveStream.id },
            data: { status: 'LIVE', startedAt: new Date() }
          });
          
          // ==========================================
          // 🔔 MOTOR DE ALERTAS MASIVAS (FOMO)
          // ==========================================
          const creator = await prisma.user.findUnique({
            where: { id: liveStream.creatorId },
            include: {
              // Traemos a los VIPs activos
              subscribers: { where: { status: 'ACTIVE' }, include: { fan: true } },
              // Traemos a los seguidores gratuitos
              followers: { include: { follower: true } }
            }
          });

          if (creator) {
            // Unificamos fans y seguidores en un solo mapa para no avisarle 2 veces a la misma persona
            const audienceMap = new Map();
            creator.subscribers.forEach(sub => audienceMap.set(sub.fan.id, sub.fan));
            creator.followers.forEach(f => audienceMap.set(f.follower.id, f.follower));
            
            const audience = Array.from(audienceMap.values());

            // 🚀 Disparar ráfaga de notificaciones
            const notificationPromises = audience.map(async (user) => {
              try {
                // A. Notificación In-App (La campanita roja en la web)
                await prisma.notification.create({
                  data: {
                    userId: user.id,
                    type: 'LIVE_STARTED',
                    content: `🔴 ¡@${creator.username} está transmitiendo EN VIVO! Únete ahora.`,
                    link: `/live/${liveStream.id}`
                  }
                });

                // B. Notificación Push (Si tienen la PWA o el celular vinculado)
                if (user.pushNotifications && sendPushNotification) {
                  await sendPushNotification(
                    user.id, 
                    `🔴 @${creator.username} está en vivo`, 
                    `Entra a ver: ${liveStream.title}`,
                    `/live/${liveStream.id}`
                  );
                }
              } catch (notifError) {
                // Ignoramos si falla uno para no detener la ráfaga
              }
            });

            await Promise.all(notificationPromises);
            console.log(`🔴 [FOMO-ENGINE] El Stream de ${creator.username} está EN VIVO. Se alertó a ${audience.length} usuarios.`);
          }
        }
        break;

      case 'video.live_stream.disconnected':
      case 'video.live_stream.idle':
        // 🛑 EL CREADOR APAGÓ EL OBS
        if (liveStream.status === 'LIVE') {
          await prisma.liveStream.update({
            where: { id: liveStream.id },
            data: { status: 'ENDED', endedAt: new Date() }
          });
          console.log(`🛑 [AUTO-END] El Stream de ${liveStream.creatorId} ha FINALIZADO automáticamente.`);
        }
        break;
    }

    return res.status(200).send("Webhook Processed");

  } catch (error) {
    console.error("❌ Error Crítico en Mux Webhook:", error);
    return res.status(500).send("Internal Server Error");
  }
};