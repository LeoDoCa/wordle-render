const { db } = require('./firebase');

// Cache para las palabras
let PALABRAS_CACHE = [];
let PALABRAS_LOADED = false;

class WordleService {
  
  // Cargar palabras desde Firestore
  async loadPalabrasFromFirestore() {
    if (PALABRAS_LOADED && PALABRAS_CACHE.length > 0) {
      return PALABRAS_CACHE;
    }
    
    try {
      console.log('Cargando palabras desde Firestore...');
      const palabrasRef = db.collection('palabras');
      const snapshot = await palabrasRef.get();
      
      PALABRAS_CACHE = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.palabra && data.palabra.length === 5) {
          PALABRAS_CACHE.push(data.palabra.toUpperCase());
        }
      });
      
      PALABRAS_LOADED = true;
      console.log(`Cargadas ${PALABRAS_CACHE.length} palabras desde Firestore`);
      
      return PALABRAS_CACHE;
    } catch (error) {
      console.error('Error cargando palabras desde Firestore:', error);
      // Fallback a una lista mínima si falla
      PALABRAS_CACHE = ["PLATO", "PRADO", "PLACA", "BRAZO", "CAMPO"];
      return PALABRAS_CACHE;
    }
  }

  // Obtener palabra aleatoria
  async getRandomWord() {
    const palabras = await this.loadPalabrasFromFirestore();
    return palabras[Math.floor(Math.random() * palabras.length)];
  }

  // Validar palabra
  async isValidWord(word) {
    const palabras = await this.loadPalabrasFromFirestore();
    return palabras.includes(word.toUpperCase());
  }

  // Generar feedback para el intento
  generateFeedback(guess, targetWord) {
    const feedback = [];
    const target = targetWord.toUpperCase();
    const attempt = guess.toUpperCase();
    
    // Primera pasada: marcar posiciones correctas
    const targetLetters = target.split('');
    const usedPositions = new Array(5).fill(false);
    
    for (let i = 0; i < 5; i++) {
      if (attempt[i] === target[i]) {
        feedback[i] = { letter: attempt[i], status: 'correct_pos' };
        usedPositions[i] = true;
      }
    }
    
    // Segunda pasada: marcar letras correctas en posición incorrecta
    for (let i = 0; i < 5; i++) {
      if (feedback[i]) continue; // Ya procesada
      
      let found = false;
      for (let j = 0; j < 5; j++) {
        if (!usedPositions[j] && attempt[i] === target[j] && i !== j) {
          feedback[i] = { letter: attempt[i], status: 'correct_wrong_pos' };
          usedPositions[j] = true;
          found = true;
          break;
        }
      }
      
      if (!found) {
        feedback[i] = { letter: attempt[i], status: 'not_in_word' };
      }
    }
    
    return feedback;
  }

  // Guardar juego completado en el historial
  async saveGameToHistory(gameData) {
    try {
      const historyRef = db.collection('gameHistory');
      const historyData = {
        userId: gameData.userId,
        targetWord: gameData.targetWord,
        isWon: gameData.isWon,
        isLost: gameData.isLost,
        attemptsUsed: 6 - gameData.attemptsLeft,
        totalAttempts: gameData.attempts.length,
        attempts: gameData.attempts,
        completedAt: new Date(),
        gameStartedAt: gameData.createdAt
      };
      
      await historyRef.add(historyData);
      console.log('Juego guardado en historial:', historyData);
    } catch (error) {
      console.error('Error guardando juego en historial:', error);
    }
  }

  // Iniciar juego
  async startGame(userId) {
    try {
      // Buscar juego actual
      const gameRef = db.collection('games').doc(userId);
      const gameDoc = await gameRef.get();
      
      if (gameDoc.exists) {
        const gameData = gameDoc.data();
        // Si el juego no ha terminado, devolverlo
        if (!gameData.isWon && !gameData.isLost) {
          return {
            success: true,
            game: gameData,
            message: 'Juego actual recuperado'
          };
        }
      }
      
      // Crear nuevo juego
      const randomWord = await this.getRandomWord();
      const newGame = {
        userId: userId,
        targetWord: randomWord,
        attempts: [],
        attemptsLeft: 6,
        isWon: false,
        isLost: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await gameRef.set(newGame);
      
      // No devolver la palabra objetivo
      const responseGame = { ...newGame };
      delete responseGame.targetWord;
      
      return {
        success: true,
        game: responseGame,
        message: 'Nuevo juego iniciado'
      };
      
    } catch (error) {
      console.error('Error starting game:', error);
      return {
        success: false,
        error: 'Error al iniciar el juego'
      };
    }
  }

  // Procesar intento
  async guessWord(userId, guess) {
    try {
      if (!guess || guess.length !== 5) {
        return {
          success: false,
          error: 'La palabra debe tener exactamente 5 letras'
        };
      }

      if (!await this.isValidWord(guess)) {
        return {
          success: false,
          error: 'Palabra no válida'
        };
      }

      const gameRef = db.collection('games').doc(userId);
      const gameDoc = await gameRef.get();
      
      if (!gameDoc.exists) {
        return {
          success: false,
          error: 'No hay juego activo. Inicia un nuevo juego.'
        };
      }
      
      const gameData = gameDoc.data();
      
      if (gameData.isWon || gameData.isLost) {
        return {
          success: false,
          error: 'El juego ya ha terminado'
        };
      }
      
      if (gameData.attemptsLeft <= 0) {
        return {
          success: false,
          error: 'No quedan intentos'
        };
      }
      
      // Generar feedback
      const feedback = this.generateFeedback(guess, gameData.targetWord);
      const isWon = guess.toUpperCase() === gameData.targetWord.toUpperCase();
      const newAttemptsLeft = gameData.attemptsLeft - 1;
      const isLost = !isWon && newAttemptsLeft <= 0;
      
      // Actualizar juego
      const updatedGame = {
        ...gameData,
        attempts: [...gameData.attempts, { guess: guess.toUpperCase(), feedback }],
        attemptsLeft: newAttemptsLeft,
        isWon: isWon,
        isLost: isLost,
        updatedAt: new Date()
      };
      
      await gameRef.update(updatedGame);
      
      // Si el juego terminó, guardarlo en el historial
      if (isWon || isLost) {
        await this.saveGameToHistory(updatedGame);
      }
      
      // Preparar respuesta
      const response = {
        success: true,
        feedback: feedback,
        attemptsLeft: newAttemptsLeft,
        isWon: isWon,
        isLost: isLost,
        attempts: updatedGame.attempts
      };
      
      if (isWon) {
        response.message = `¡Felicidades! Has ganado el juego. La palabra era: ${gameData.targetWord}`;
        response.gameStatus = 'won';
      } else if (isLost) {
        response.message = `¡Game Over! Se acabaron los intentos. La palabra era: ${gameData.targetWord}`;
        response.gameStatus = 'lost';
      } else {
        response.message = `Te quedan ${newAttemptsLeft} intentos`;
        response.gameStatus = 'playing';
      }
      
      if (isWon || isLost) {
        response.targetWord = gameData.targetWord;
      }
      
      return response;
      
    } catch (error) {
      console.error('Error processing guess:', error);
      return {
        success: false,
        error: 'Error al procesar el intento'
      };
    }
  }

  // Obtener juego actual
  async getCurrentGame(userId) {
    try {
      const gameRef = db.collection('games').doc(userId);
      const gameDoc = await gameRef.get();
      
      if (!gameDoc.exists) {
        return {
          success: false,
          error: 'No hay juego activo'
        };
      }
      
      const gameData = gameDoc.data();
      const responseGame = { ...gameData };
      
      if (gameData.isWon) {
        responseGame.message = `¡Juego ganado! La palabra era: ${gameData.targetWord}`;
        responseGame.gameStatus = 'won';
      } else if (gameData.isLost) {
        responseGame.message = `¡Juego perdido! La palabra era: ${gameData.targetWord}`;
        responseGame.gameStatus = 'lost';
      } else {
        responseGame.message = `Juego en progreso. Te quedan ${gameData.attemptsLeft} intentos`;
        responseGame.gameStatus = 'playing';
        delete responseGame.targetWord;
      }
      
      return {
        success: true,
        game: responseGame
      };
      
    } catch (error) {
      console.error('Error getting current game:', error);
      return {
        success: false,
        error: 'Error al obtener el juego actual'
      };
    }
  }

  // Reiniciar juego
  async resetGame(userId) {
    try {
      const gameRef = db.collection('games').doc(userId);
      await gameRef.delete();
      
      return await this.startGame(userId);
      
    } catch (error) {
      console.error('Error resetting game:', error);
      return {
        success: false,
        error: 'Error al reiniciar el juego'
      };
    }
  }

  // Calcular rachas y estadísticas
  async calculateCurrentStreak(userId) {
    try {
      const historyRef = db.collection('gameHistory')
        .where('userId', '==', userId)
        .orderBy('completedAt', 'desc');
      
      const snapshot = await historyRef.get();
      let currentStreak = 0;
      
      snapshot.forEach(doc => {
        const game = doc.data();
        if (game.isWon) {
          currentStreak++;
        } else {
          return false; // Romper el bucle
        }
      });
      
      return currentStreak;
    } catch (error) {
      console.error('Error calculating current streak:', error);
      return 0;
    }
  }

  async calculateMaxStreak(userId) {
    try {
      const historyRef = db.collection('gameHistory')
        .where('userId', '==', userId)
        .orderBy('completedAt', 'asc');
      
      const snapshot = await historyRef.get();
      let maxStreak = 0;
      let currentStreak = 0;
      
      snapshot.forEach(doc => {
        const game = doc.data();
        if (game.isWon) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
      });
      
      return maxStreak;
    } catch (error) {
      console.error('Error calculating max streak:', error);
      return 0;
    }
  }

  // Obtener estadísticas del usuario
  async getUserStats(userId) {
    try {
      const historyRef = db.collection('gameHistory').where('userId', '==', userId);
      const historySnapshot = await historyRef.get();
      
      let totalGames = 0;
      let wins = 0;
      const attemptDistribution = [0, 0, 0, 0, 0, 0];
      
      historySnapshot.forEach(doc => {
        const game = doc.data();
        totalGames++;
        
        if (game.isWon) {
          wins++;
          const attemptsUsed = game.attemptsUsed || (6 - game.attemptsLeft);
          if (attemptsUsed >= 1 && attemptsUsed <= 6) {
            attemptDistribution[attemptsUsed - 1]++;
          }
        }
      });
      
      const currentStreak = await this.calculateCurrentStreak(userId);
      const maxStreak = await this.calculateMaxStreak(userId);
      
      return {
        success: true,
        stats: {
          totalGames,
          wins,
          losses: totalGames - wins,
          winPercentage: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
          currentStreak,
          maxStreak,
          attemptDistribution,
          averageAttempts: wins > 0 ? Math.round(attemptDistribution.reduce((sum, count, index) => sum + (count * (index + 1)), 0) / wins * 10) / 10 : 0
        }
      };
      
    } catch (error) {
      console.error('Error getting user stats:', error);
      return {
        success: false,
        error: 'Error al obtener estadísticas: ' + error.message
      };
    }
  }
}

module.exports = new WordleService();