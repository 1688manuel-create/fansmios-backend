const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// ==========================================
// 🔇 PROTOCOLO DE SILENCIO: EXTIRPADOR DE AUDIO
// ==========================================
exports.stripAudioFromVideo = (inputVideoPath) => {
  return new Promise((resolve, reject) => {
    // Creamos un nombre temporal para el nuevo video mudo
    const directory = path.dirname(inputVideoPath);
    const ext = path.extname(inputVideoPath);
    const baseName = path.basename(inputVideoPath, ext);
    const outputVideoPath = path.join(directory, `${baseName}-muted${ext}`);

    console.log(`🔪 Extirpando audio infractor de: ${baseName}...`);

    ffmpeg(inputVideoPath)
      .noAudio() // 🔥 LA MAGIA: Esta línea borra la pista de audio por completo
      .outputOptions('-c:v copy') // Copiamos el video exacto sin perder calidad ni tardar horas
      .save(outputVideoPath)
      .on('end', () => {
        console.log(`✅ Video silenciado con éxito: ${outputVideoPath}`);
        
        // Borramos el video original que tiene la música ilegal
        fs.unlinkSync(inputVideoPath); 
        
        // Renombramos el video mudo para que tome el lugar del original
        fs.renameSync(outputVideoPath, inputVideoPath);
        
        resolve(inputVideoPath);
      })
      .on('error', (err) => {
        console.error(`🚨 Error al silenciar el video:`, err);
        reject(err);
      });
  });
};