// backend/utils/muxService.js

const Mux = require('@mux/mux-node');

// Inicializar Mux correctamente
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

/**
 * Crea un Live Stream en Mux y devuelve la Clave RTMP para OBS
 */
exports.createLiveStream = async (isPPV) => {
  try {

    // ===============================
    // 🛡️ MODO SIMULACIÓN (SIN LLAVES)
    // ===============================
    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
      console.log('⚠️ MUX en modo SIMULACIÓN (sin llaves reales en .env)');

      const uniqueTimestamp = Date.now();

      return {
        streamId: `simulated_stream_${uniqueTimestamp}`,
        streamKey: `rtmp_secret_key_${uniqueTimestamp}`,
        playbackId: `simulated_playback_${uniqueTimestamp}`
      };
    }

    // ===============================
    // 🔥 CREACIÓN REAL EN MUX CLOUD
    // ===============================
    const stream = await mux.video.liveStreams.create({
      playback_policy: isPPV ? ['signed'] : ['public'],
      new_asset_settings: {
        playback_policy: isPPV ? ['signed'] : ['public']
      },
      reconnect_window: 60,
    });

    if (!stream.playback_ids || stream.playback_ids.length === 0) {
      throw new Error('Mux no devolvió playback_id');
    }

    return {
      streamId: stream.id,
      streamKey: stream.stream_key,
      playbackId: stream.playback_ids[0].id
    };

  } catch (error) {
    console.error('❌ Error creando Live Stream en Mux:', error.message);
    throw new Error('No se pudo inicializar el servidor de video.');
  }
};