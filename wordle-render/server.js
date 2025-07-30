const express = require('express');
const cors = require('cors');
const wordleService = require('./lib/wordleService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta principal de la API
app.all('/api/wordle', async (req, res) => {
  // Logging temporal para debug
  console.log('=== REQUEST DEBUG ===');
  console.log('Method:', req.method);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Query:', req.query);
  console.log('Body:', req.body);
  console.log('====================');

  // Obtener parámetros de query o body
  const params = { ...req.query, ...req.body };
  const { action, userId, guess } = params;
  
  let result = { success: false, error: 'Acción no válida' };
  
  try {
    switch (action) {
      case 'start':
        if (userId) {
          result = await wordleService.startGame(userId);
        } else {
          result = { success: false, error: 'Se requiere userId' };
        }
        break;
      
      case 'guess':
        if (userId && guess) {
          result = await wordleService.guessWord(userId, guess);
        } else {
          result = { success: false, error: 'Se requiere userId y guess' };
        }
        break;
      
      case 'current':
        if (userId) {
          result = await wordleService.getCurrentGame(userId);
        } else {
          result = { success: false, error: 'Se requiere userId' };
        }
        break;
      
      case 'reset':
        if (userId) {
          result = await wordleService.resetGame(userId);
        } else {
          result = { success: false, error: 'Se requiere userId' };
        }
        break;
      
      case 'stats':
        if (userId) {
          result = await wordleService.getUserStats(userId);
        } else {
          result = { success: false, error: 'Se requiere userId' };
        }
        break;
      
      case 'health':
        result = {
          success: true,
          message: 'API Wordle funcionando correctamente en Render',
          timestamp: new Date().toISOString(),
          version: '2.0.0',
          environment: 'Render',
          features: ['Historial de juegos', 'Estadísticas mejoradas', 'API REST', 'Alexa Skills Compatible']
        };
        break;
      
      case 'palabras':
        await wordleService.loadPalabrasFromFirestore();
        const palabras = await wordleService.loadPalabrasFromFirestore();
        result = {
          success: true,
          totalPalabras: palabras.length,
          ejemplos: palabras.slice(0, 10),
          message: `Se cargaron ${palabras.length} palabras desde Firestore`
        };
        break;
        
      default:
        result = { 
          success: false, 
          error: 'Acción no válida. Acciones disponibles: start, guess, current, reset, stats, health, palabras',
          usage: {
            examples: [
              '?action=health - Verificar estado',
              '?action=palabras - Ver palabras cargadas',
              '?action=start&userId=usuario123 - Iniciar juego',
              '?action=guess&userId=usuario123&guess=PLATO - Hacer intento',
              '?action=current&userId=usuario123 - Obtener juego actual',
              '?action=reset&userId=usuario123 - Reiniciar juego',
              '?action=stats&userId=usuario123 - Obtener estadísticas'
            ]
          }
        };
    }
  } catch (error) {
    console.error('Error en API:', error);
    result = { 
      success: false, 
      error: error.message || 'Error interno del servidor'
    };
  }
  
  res.json(result);
});

// Ruta de health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API Wordle en Render funcionando correctamente',
    timestamp: new Date().toISOString(),
    endpoints: ['/api/wordle']
  });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});