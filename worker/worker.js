/**
 * ⚙️ TIMING PRO WORKER - ALERTAS 24/7
 * Executa via Cron Trigger no Cloudflare Workers
 * Suporte multiativo: BTC, SOL, BNB, etc.
 * NÃO coloque tokens aqui. Use Environment Variables.
 */

export default {
  async scheduled(event, env, ctx) {
    // Configuração via variáveis de ambiente do Cloudflare
    const symbolsRaw = env.SYMBOLS || 'BTCUSDT,SOLUSDT,BNBUSDT';
    const symbols = symbolsRaw.split(',').map(s => s.trim().toUpperCase());
    const token = env.TG_TOKEN;
    const chat = env.TG_CHAT;

    if (!token || !chat) {
      console.warn('⚠️ Telegram não configurado. Adicione TG_TOKEN e TG_CHAT nas variáveis.');
      return;
    }

    console.log(`🔄 Iniciando análise para: ${symbols.join(', ')}`);

    for (const sym of symbols) {
      try {
        // Buscar dados em paralelo (15m e 1h)
        const [k15m, k1h] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=100`).then(r => r.json()),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=100`).then(r => r.json())
        ]);

        if (!k15m?.length || !k1h?.length) {
          console.warn(`⚠️ Dados insuficientes para ${sym}`);
          continue;
        }

        // Calcular tendências
        const trend15 = getTrend(k15m, 9, 21);
        const trend1h = getTrend(k1h, 9, 21);
        
        // Só alerta se ambos timeframes estiverem alinhados
        if (trend15 === trend1h && trend15) {
          const price = parseFloat(k15m[k15m.length - 1][4]);
          const rsi = getRSI(k15m, 14);
          const volRatio = getVolumeRatio(k15m, 20);
          const direction = trend15 === 'up' ? '🟢 ALTA' : '🔴 BAIXA';

          // Filtros de qualidade para evitar alertas falsos
          const isRSIOK = rsi >= 25 && rsi <= 75;
          const isVolOK = volRatio >= 0.8; // Volume não está morto

          if (isRSIOK && isVolOK) {
            const msg = `<b>🔗 ALINHAMENTO 15m ⇄ 1h</b>\n\n` +
                        `📊 <b>${sym}</b>\n` +
                        `📈 Direção: ${direction}\n` +
                        `💰 Preço: $${price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}\n` +
                        `📉 RSI: ${rsi.toFixed(1)} | Vol Rel: ${volRatio.toFixed(2)}x\n` +
                        `⏰ ${new Date().toLocaleString('pt-BR')}\n\n` +
                        `<i>✅ Timeframes alinhados. Alta probabilidade de continuidade do movimento.</i>`;
            
            await sendTelegram(token, chat, msg);
            console.log(`✅ Alerta enviado para ${sym}`);
          } else {
            console.log(`⏳ Alinhamento ${sym}, mas filtros não atendidos (RSI:${rsi.toFixed(1)}, Vol:${volRatio.toFixed(2)})`);
          }
        }
      } catch (error) {
        console.error(`❌ Erro ao processar ${sym}: ${error.message}`);
        // Opcional: alertar falha crítica no Telegram
        await sendTelegram(token, chat, `❌ <b>Falha no Worker</b>\n📊 ${sym}\n🔧 ${error.message}\n⏰ ${new Date().toLocaleString('pt-BR')}`);
      }
      
      // Pequeno delay para respeitar limites da Binance
      await new Promise(res => setTimeout(res, 800));
    }
    console.log('✅ Análise concluída.');
  }
};

// === FUNÇÕES AUXILIARES ===
function getTrend(data, fast, slow) {
  const maF = getMA(data, fast);
  const maS = getMA(data, slow);
  return maF > maS ? 'up' : 'down';
}

function getMA(data, period) {
  const slice = data.slice(-period);
  return slice.reduce((sum, k) => sum + parseFloat(k[4]), 0) / period;
}

function getRSI(data, period = 14) {
  let gains = 0, losses = 0;
  for (let i = data.length - period; i < data.length; i++) {
    const diff = parseFloat(data[i][4]) - parseFloat(data[i - 1][4]);
    diff >= 0 ? gains += diff : losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function getVolumeRatio(data, period = 20) {
  if (data.length < period + 1) return 1;
  const vols = data.map(k => parseFloat(k[5]));
  const current = vols[vols.length - 1];
  const avg = vols.slice(-period).reduce((a, b) => a + b, 0) / period;
  return avg === 0 ? 1 : current / avg;
}

async function sendTelegram(token, chat, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
}
