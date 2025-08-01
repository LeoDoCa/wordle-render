const { db } = require('./firebase');

let PALABRAS_CACHE = [];
let PALABRAS_LOADED = false;

class WordleService {

  // ===== Palabras =====
  async loadPalabrasFromFirestore() {
    if (PALABRAS_LOADED && PALABRAS_CACHE.length > 0) return PALABRAS_CACHE;
    try {
      console.log('Cargando palabras desde Firestore...');
      const palabrasRef = db.collection('palabras');
      const snapshot = await palabrasRef.get();

      PALABRAS_CACHE = snapshot.docs
        .map(doc => doc.data().palabra?.toUpperCase())
        .filter(p => p && p.length === 5);

      PALABRAS_LOADED = true;
      console.log(`Cargadas ${PALABRAS_CACHE.length} palabras`);
      return PALABRAS_CACHE;
    } catch (error) {
      console.error('Error cargando palabras:', error);
      PALABRAS_CACHE = ["PLATO", "PRADO", "PLACA", "BRAZO", "CAMPO"];
      return PALABRAS_CACHE;
    }
  }

  async getRandomWord() {
    const palabras = await this.loadPalabrasFromFirestore();
    return palabras[Math.floor(Math.random() * palabras.length)];
  }

  async isValidWord(word) {
    const palabras = await this.loadPalabrasFromFirestore();
    return palabras.includes(word.toUpperCase());
  }

  // ===== Lógica juego =====
  generateFeedback(guess, targetWord) {
    const feedback = [];
    const target = targetWord.toUpperCase();
    const attempt = guess.toUpperCase();
    const usedPositions = Array(5).fill(false);

    // posiciones correctas
    for (let i = 0; i < 5; i++) {
      if (attempt[i] === target[i]) {
        feedback[i] = { letter: attempt[i], status: 'correct_pos' };
        usedPositions[i] = true;
      }
    }
    // letras correctas en lugar incorrecto
    for (let i = 0; i < 5; i++) {
      if (feedback[i]) continue;
      let found = false;
      for (let j = 0; j < 5; j++) {
        if (!usedPositions[j] && attempt[i] === target[j] && i !== j) {
          feedback[i] = { letter: attempt[i], status: 'correct_wrong_pos' };
          usedPositions[j] = true;
          found = true;
          break;
        }
      }
      if (!found) feedback[i] = { letter: attempt[i], status: 'not_in_word' };
    }
    return feedback;
  }

  async saveGameToHistory(gameData) {
    try {
      const historyRef = db.collection('gameHistory');
      const historyData = {
        uid: gameData.uid,
        alexaUserId: gameData.alexaUserId || null,
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

  async startGame(uid, alexaUserId = null) {
    try {
      const gameRef = db.collection('games').doc(uid);
      const gameDoc = await gameRef.get();

      if (gameDoc.exists) {
        const gameData = gameDoc.data();
        if (!gameData.isWon && !gameData.isLost) {
          return { success: true, game: gameData, message: 'Juego actual recuperado' };
        }
      }

      const randomWord = await this.getRandomWord();
      const newGame = {
        uid,
        alexaUserId,
        targetWord: randomWord,
        attempts: [],
        attemptsLeft: 6,
        isWon: false,
        isLost: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await gameRef.set(newGame);
      const responseGame = { ...newGame };
      delete responseGame.targetWord;

      return { success: true, game: responseGame, message: 'Nuevo juego iniciado' };
    } catch (error) {
      console.error('Error starting game:', error);
      return { success: false, error: 'Error al iniciar el juego' };
    }
  }

  async guessWord(uid, guess) {
    try {
      if (!guess || guess.length !== 5) {
        return { success: false, error: 'La palabra debe tener exactamente 5 letras' };
      }
      if (!await this.isValidWord(guess)) {
        return { success: false, error: 'Palabra no válida' };
      }

      const gameRef = db.collection('games').doc(uid);
      const gameDoc = await gameRef.get();
      if (!gameDoc.exists) return { success: false, error: 'No hay juego activo.' };

      const gameData = gameDoc.data();
      if (gameData.isWon || gameData.isLost) return { success: false, error: 'El juego ya ha terminado' };
      if (gameData.attemptsLeft <= 0) return { success: false, error: 'No quedan intentos' };

      const feedback = this.generateFeedback(guess, gameData.targetWord);
      const isWon = guess.toUpperCase() === gameData.targetWord.toUpperCase();
      const newAttemptsLeft = gameData.attemptsLeft - 1;
      const isLost = !isWon && newAttemptsLeft <= 0;

      const updatedGame = {
        ...gameData,
        attempts: [...gameData.attempts, { guess: guess.toUpperCase(), feedback }],
        attemptsLeft: newAttemptsLeft,
        isWon,
        isLost,
        updatedAt: new Date()
      };
      await gameRef.update(updatedGame);

      if (isWon || isLost) await this.saveGameToHistory(updatedGame);

      const response = {
        success: true,
        feedback,
        attemptsLeft: newAttemptsLeft,
        isWon,
        isLost,
        attempts: updatedGame.attempts,
        message: isWon ? `¡Ganaste! Palabra: ${gameData.targetWord}` :
                 isLost ? `¡Perdiste! Palabra: ${gameData.targetWord}` :
                 `Te quedan ${newAttemptsLeft} intentos`,
        gameStatus: isWon ? 'won' : isLost ? 'lost' : 'playing'
      };
      if (isWon || isLost) response.targetWord = gameData.targetWord;
      return response;

    } catch (error) {
      console.error('Error processing guess:', error);
      return { success: false, error: 'Error al procesar el intento' };
    }
  }

  async getCurrentGame(uid) {
    try {
      const gameRef = db.collection('games').doc(uid);
      const gameDoc = await gameRef.get();
      if (!gameDoc.exists) return { success: false, error: 'No hay juego activo' };

      const gameData = gameDoc.data();
      const responseGame = { ...gameData };

      if (gameData.isWon) {
        responseGame.message = `¡Juego ganado! La palabra era: ${gameData.targetWord}`;
        responseGame.gameStatus = 'won';
      } else if (gameData.isLost) {
        responseGame.message = `¡Juego perdido! La palabra era: ${gameData.targetWord}`;
        responseGame.gameStatus = 'lost';
      } else {
        responseGame.message = `Juego en progreso. Intentos restantes: ${gameData.attemptsLeft}`;
        responseGame.gameStatus = 'playing';
        delete responseGame.targetWord;
      }
      return { success: true, game: responseGame };

    } catch (error) {
      console.error('Error getting current game:', error);
      return { success: false, error: 'Error al obtener el juego actual' };
    }
  }

  async resetGame(uid) {
    try {
      const gameRef = db.collection('games').doc(uid);
      await gameRef.delete();
      return await this.startGame(uid);
    } catch (error) {
      console.error('Error resetting game:', error);
      return { success: false, error: 'Error al reiniciar el juego' };
    }
  }

  // ===== Estadísticas =====
  async calculateCurrentStreak(uid) {
    try {
      const historyRef = db.collection('gameHistory').where('uid', '==', uid).orderBy('completedAt', 'desc');
      const snapshot = await historyRef.get();
      let currentStreak = 0;
      for (const doc of snapshot.docs) {
        const game = doc.data();
        if (game.isWon) currentStreak++;
        else break;
      }
      return currentStreak;
    } catch (error) {
      console.error('Error calculating current streak:', error);
      return 0;
    }
  }

  async calculateMaxStreak(uid) {
    try {
      const historyRef = db.collection('gameHistory').where('uid', '==', uid).orderBy('completedAt', 'asc');
      const snapshot = await historyRef.get();
      let maxStreak = 0, currentStreak = 0;
      for (const doc of snapshot.docs) {
        const game = doc.data();
        if (game.isWon) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else currentStreak = 0;
      }
      return maxStreak;
    } catch (error) {
      console.error('Error calculating max streak:', error);
      return 0;
    }
  }

  async getUserStats(uid) {
    try {
      const historyRef = db.collection('gameHistory').where('uid', '==', uid);
      const historySnapshot = await historyRef.get();

      let totalGames = 0, wins = 0;
      const attemptDistribution = [0, 0, 0, 0, 0, 0];

      historySnapshot.forEach(doc => {
        const game = doc.data();
        totalGames++;
        if (game.isWon) {
          wins++;
          const attemptsUsed = game.attemptsUsed || (6 - game.attemptsLeft);
          if (attemptsUsed >= 1 && attemptsUsed <= 6) attemptDistribution[attemptsUsed - 1]++;
        }
      });

      const currentStreak = await this.calculateCurrentStreak(uid);
      const maxStreak = await this.calculateMaxStreak(uid);

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
          averageAttempts: wins > 0
            ? Math.round(attemptDistribution.reduce((sum, count, index) => sum + (count * (index + 1)), 0) / wins * 10) / 10
            : 0
        }
      };
    } catch (error) {
      console.error('Error getting user stats:', error);
      return { success: false, error: 'Error al obtener estadísticas: ' + error.message };
    }
  }
}

module.exports = new WordleService();
