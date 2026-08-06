// =============================================================================
//  Historico de telemetria — buffers circulares colunares
//
//  PORQUE NAO UM ARRAY NO ESTADO DO REACT:
//  A 5 Hz, uma prova de 30 minutos gera 9.000 quadros. Guardar isso como
//  `useState<Sample[]>` significa alocar um array novo a cada 200 ms e disparar
//  uma re-renderizacao de toda a arvore — o gargalo que a Diretriz manda
//  eliminar.
//
//  Aqui os dados vivem FORA do React, em Float64Array pre-alocados (um por
//  serie). Nada e alocado no caminho quente: cada quadro so escreve em um
//  indice. A UI e notificada por um contador de versao que o store incrementa
//  em uma cadencia visual (~4 Hz), nao a cada quadro.
//
//  O layout colunar tambem e exatamente o que o uPlot espera
//  (`[xs, serie1, serie2, ...]`), entao os graficos leem sem copiar nada.
// =============================================================================

import type { ProcessedSample } from "@/types/telemetry";
import { toKnots } from "./contract";
import { computePower } from "@/lib/math/hydrodynamics";

/** Capacidade do buffer de alta taxa: 6.000 quadros = 20 min a 5 Hz. */
export const HISTORY_CAPACITY = 6000;

/** Capacidade do log de sessao decimado a 1 Hz: 2 h de prova. */
export const SESSION_CAPACITY = 7200;

/** Series mantidas em alta taxa. A ordem define o indice das colunas. */
export const SERIES = [
  "t", // epoch segundos (uPlot usa segundos, nao ms)
  "knots",
  "temp_c", // estator, sensor fisico (DS18B20)
  "virtual_c", // estator, gemeo digital termico
  "ambient_c", // interior do casco (DHT22)
  "current_a",
  "voltage_v",
  "rudder_deg",
  "power_w",
  "sec", // consumo especifico (W/no); NaN quando parado
  "roll",
  "pitch",
  // Posicao ja suavizada pelo Filtro de Kalman. Fica aqui, e nao num array
  // proprio do mapa, para que a trilha sobreviva a desmontagem da aba e para
  // que a exportacao leia a mesma fonte que a tela.
  "lat_f",
  "lng_f",
] as const;

export type SeriesName = (typeof SERIES)[number];

/**
 * Buffer circular colunar. Escrita O(1) sem alocacao; leitura devolve as
 * colunas ja em ordem cronologica, prontas para o uPlot.
 */
export class TelemetryHistory {
  private readonly capacity: number;
  private readonly columns: Float64Array[];
  /** Proxima posicao de escrita. */
  private head = 0;
  /** Quantidade de amostras validas (satura na capacidade). */
  private count = 0;

  /** Buffers de saida reaproveitados — evita alocar a cada leitura. */
  private readonly outColumns: Float64Array[];
  private outLength = 0;

  constructor(capacity = HISTORY_CAPACITY) {
    this.capacity = capacity;
    this.columns = SERIES.map(() => new Float64Array(capacity));
    this.outColumns = SERIES.map(() => new Float64Array(capacity));
  }

  get length(): number {
    return this.count;
  }

  /** Escreve um quadro processado. Caminho quente: zero alocacao. */
  push(s: ProcessedSample, virtualCoreTemp: number): void {
    const i = this.head;
    const knots = toKnots(s.gps.speed_kmh);
    const { power_w, sec_w_per_knot } = computePower(
      s.sensors.voltage_v,
      s.sensors.current_a,
      knots,
    );

    this.columns[0][i] = s.t / 1000; // uPlot trabalha em segundos
    this.columns[1][i] = knots;
    this.columns[2][i] = s.sensors.temp_c;
    this.columns[3][i] = virtualCoreTemp;
    this.columns[4][i] = s.ambient.temp_c;
    this.columns[5][i] = s.sensors.current_a;
    this.columns[6][i] = s.sensors.voltage_v;
    this.columns[7][i] = s.sensors.rudder_deg;
    this.columns[8][i] = power_w;
    // uPlot desenha lacuna em NaN — exatamente o que queremos quando o barco
    // esta parado e o consumo especifico nao tem significado fisico.
    this.columns[9][i] = sec_w_per_knot ?? NaN;
    this.columns[10][i] = s.imu.roll;
    this.columns[11][i] = s.imu.pitch;
    // Sem fix valido gravamos NaN: assim a trilha do mapa abre uma lacuna em
    // vez de tracar uma reta ate a coordenada (0,0) no golfo da Guine.
    this.columns[12][i] = s.gps.fix ? s.lat_f : NaN;
    this.columns[13][i] = s.gps.fix ? s.lng_f : NaN;

    this.head = (i + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * Devolve as ultimas `maxPoints` amostras em ordem cronologica, no formato
   * colunar do uPlot: `[xs, y1, y2, ...]`.
   *
   * Os arrays retornados sao REAPROVEITADOS entre chamadas — copie se precisar
   * reter. O uPlot consome de imediato em setData(), entao nao ha problema.
   */
  read(maxPoints = this.capacity): Float64Array[] {
    const n = Math.min(this.count, maxPoints);
    // Indice da primeira amostra da janela dentro do buffer circular.
    const start = (this.head - n + this.capacity * 2) % this.capacity;

    for (let c = 0; c < this.columns.length; c++) {
      const src = this.columns[c];
      const dst = this.outColumns[c];
      if (start + n <= this.capacity) {
        dst.set(src.subarray(start, start + n), 0);
      } else {
        // A janela cruza a emenda do buffer: duas copias contiguas.
        const firstPart = this.capacity - start;
        dst.set(src.subarray(start, this.capacity), 0);
        dst.set(src.subarray(0, n - firstPart), firstPart);
      }
    }

    this.outLength = n;
    return this.outColumns.map((col) => col.subarray(0, n));
  }

  /** Valor mais recente de uma serie, ou NaN se o buffer estiver vazio. */
  latest(series: SeriesName): number {
    if (this.count === 0) return NaN;
    const idx = SERIES.indexOf(series);
    const pos = (this.head - 1 + this.capacity) % this.capacity;
    return this.columns[idx][pos];
  }

  /** Maximo de uma serie em toda a janela retida (ignora NaN). */
  max(series: SeriesName): number {
    const idx = SERIES.indexOf(series);
    const col = this.columns[idx];
    let m = -Infinity;
    const n = this.count;
    const start = (this.head - n + this.capacity * 2) % this.capacity;
    for (let k = 0; k < n; k++) {
      const v = col[(start + k) % this.capacity];
      if (Number.isFinite(v) && v > m) m = v;
    }
    return m === -Infinity ? NaN : m;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.outLength = 0;
    for (const col of this.columns) col.fill(0);
  }

  get windowLength(): number {
    return this.outLength;
  }
}

/**
 * Log da sessao decimado a 1 Hz, usado pelo Athenas Log (xlsx/csv/pdf).
 * Guarda os quadros completos porque a exportacao precisa de todos os campos,
 * mas a taxa baixa mantem o custo de memoria irrelevante.
 */
export class SessionLog {
  private readonly buffer: ProcessedSample[] = [];
  private readonly virtual: number[] = [];
  private lastAt = 0;

  /** @returns true se a amostra foi de fato registrada (passou a decimacao). */
  push(s: ProcessedSample, virtualCoreTemp: number): boolean {
    if (s.t - this.lastAt < 1000) return false;
    this.lastAt = s.t;
    if (this.buffer.length >= SESSION_CAPACITY) {
      this.buffer.shift();
      this.virtual.shift();
    }
    this.buffer.push(s);
    this.virtual.push(virtualCoreTemp);
    return true;
  }

  get samples(): readonly ProcessedSample[] {
    return this.buffer;
  }

  get virtualTemps(): readonly number[] {
    return this.virtual;
  }

  get length(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer.length = 0;
    this.virtual.length = 0;
    this.lastAt = 0;
  }
}

/** Instancias unicas do processo (o app tem uma sessao de telemetria por vez). */
export const history = new TelemetryHistory();
export const sessionLog = new SessionLog();
