// Motor de regras agronômicas: compara cada leitura com a faixa ideal da cultura.

const MESSAGES = {
  soilMoisture: {
    low: ['Solo seco', 'Acionar irrigação e verificar o sistema de gotejamento'],
    high: ['Solo encharcado', 'Suspender irrigação e verificar drenagem'],
  },
  soilTemp: {
    low: ['Solo frio', 'Avaliar cobertura plástica (mulching)'],
    high: ['Solo superaquecido', 'Aplicar cobertura morta e irrigar nas horas frescas'],
  },
  airTemp: {
    low: ['Temperatura baixa', 'Monitorar risco de geada'],
    high: ['Calor excessivo', 'Monitorar estresse térmico e reforçar irrigação'],
  },
  airHumidity: {
    low: ['Ar muito seco', 'Aumentar frequência de irrigação'],
    high: ['Umidade alta — risco de fungos', 'Aplicar tratamento fúngico preventivo'],
  },
  ph: {
    low: ['Solo ácido', 'Realizar calagem (calcário dolomítico)'],
    high: ['Solo alcalino', 'Incorporar matéria orgânica / enxofre'],
  },
  ec: {
    low: ['Deficiência de nutrientes', 'Programar fertirrigação NPK'],
    high: ['Excesso de sais no solo', 'Realizar lavagem do perfil do solo'],
  },
  ndvi: {
    low: ['Baixo vigor vegetativo', 'Inspeção visual da lavoura em campo'],
    high: null, // NDVI alto não é problema
  },
  pests: {
    low: null,
    high: ['Pressão de pragas', 'Inspeção e controle integrado de pragas (MIP)'],
  },
};

const PENALTY = { ok: 0, warn: 12, crit: 30 };
const RANK = { ok: 0, warn: 1, crit: 2 };

function worst(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

function fmt(value, meta) {
  return `${Number(value).toFixed(meta.decimals)}${meta.unit ? ' ' + meta.unit : ''}`;
}

/**
 * @param crop     definição da cultura (farm.json)
 * @param metrics  leituras (já suavizadas)
 * @param meta     metadados de métricas (rótulo, unidade, tolerância)
 */
function evaluate(crop, metrics, meta) {
  const checks = {};
  const issues = [];
  let status = 'ok';
  let score = 100;

  for (const [key, value] of Object.entries(metrics)) {
    const range = crop.ranges[key];
    const m = meta[key];
    if (!range || !m) continue;
    const [lo, hi] = range;
    let s = 'ok';
    let dir = null;
    if (value < lo && MESSAGES[key].low) {
      dir = 'low';
      s = value < lo - m.tolerance ? 'crit' : 'warn';
    } else if (value > hi && MESSAGES[key].high) {
      dir = 'high';
      s = value > hi + m.tolerance ? 'crit' : 'warn';
    }
    checks[key] = { value, range, status: s };
    if (s !== 'ok') {
      const [title, recommendation] = MESSAGES[key][dir];
      issues.push({
        metric: key,
        severity: s,
        title,
        message: `${m.label}: ${fmt(value, m)} (ideal ${lo}–${hi}${m.unit ? ' ' + m.unit : ''})`,
        recommendation,
      });
      status = worst(status, s);
      score -= PENALTY[s];
    }
  }
  issues.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  return { status, score: Math.max(0, score), checks, issues };
}

module.exports = { evaluate, RANK };
